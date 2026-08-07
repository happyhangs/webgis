import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { gcj2wgs, wgs2gcj } from '../src/utils/coord.ts';

type Point = [number, number];

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface Parcel {
  id: string;
  source: 'manual' | 'kml';
  region: string;
  split: 'train' | 'val';
  points: Point[];
  aliases: string[];
}

interface StaticMapFit {
  amapCenter: Point;
  zoom: number;
  bounds: Bounds;
}

const rootDir = path.resolve(import.meta.dirname, '..');
const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(rootDir, args.output ?? 'backend/datasets/xinjiang_multiregion_v1');
const backendUrl = (args.backend ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const dryRun = args['dry-run'] === true;
const resume = args.resume === true;
const limit = args.limit ? Number(args.limit) : undefined;

const annotationPaths = args.annotations
  ? String(args.annotations).split(',').map((file) => path.resolve(rootDir, file.trim()))
  : findAnnotationFiles(path.join(rootDir, 'backend', 'datasets'));
const manualParcels = loadManualParcels(annotationPaths);
const kmlParcels = loadKmlParcels(path.join(rootDir, 'webgis'));
const parcels = [...manualParcels, ...kmlParcels];
const selectedParcels = Number.isFinite(limit) ? parcels.slice(0, Math.max(1, limit!)) : parcels;

validatePlan(parcels);
printInventory(parcels, annotationPaths);
if (dryRun) process.exit(0);
if (fs.existsSync(outputDir)) {
  if (!resume) throw new Error(`输出目录已存在，请换一个 --output 路径：${outputDir}`);
} else {
  fs.mkdirSync(outputDir, { recursive: true });
}

await buildDataset(selectedParcels, parcels, outputDir, backendUrl, resume);

function parseArgs(values: string[]): Record<string, string | true> {
  const parsed: Record<string, string | true> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function findAnnotationFiles(datasetsDir: string): string[] {
  if (!fs.existsSync(datasetsDir)) throw new Error(`未找到数据集目录：${datasetsDir}`);
  const candidates = fs.readdirSync(datasetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(datasetsDir, entry.name, 'annotations.geojson'))
    .filter((file) => fs.existsSync(file));
  if (candidates.length === 0) throw new Error('未找到 annotations.geojson，请使用 --annotations 指定。');
  return candidates.sort((left, right) => left.localeCompare(right));
}

function loadManualParcels(files: string[]): Parcel[] {
  const candidates: Array<{ points: Point[]; aliases: string[] }> = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const datasetName = path.basename(path.dirname(file));
    for (const feature of data.features ?? []) {
      if (feature.geometry?.type !== 'Polygon') continue;
      const points = cleanRing(feature.geometry.coordinates?.[0] ?? []);
      if (points.length < 3) continue;
      const alias = String(feature.properties?.parcelCode ?? feature.id ?? '未命名');
      // ponytail: O(n²) is fine below a few hundred parcels; add a spatial index only if this grows.
      const duplicate = candidates.find((known) => canonicalRing(known.points) === canonicalRing(points) || isNearDuplicate(known.points, points));
      if (duplicate) duplicate.aliases.push(`${datasetName}/${alias}`);
      else candidates.push({ points, aliases: [`${datasetName}/${alias}`] });
    }
  }
  return candidates.map((item, index) => {
    const center = ringCenter(item.points);
    const isNorth = center[1] >= 44.6;
    const region = isNorth ? 'shihezi_manual_north' : center[0] < 86 ? 'shihezi_manual_west' : 'shihezi_manual_south';
    return {
      id: `manual_${String(index + 1).padStart(3, '0')}`,
      source: 'manual',
      region,
      split: isNorth ? 'train' : 'val',
      points: item.points,
      aliases: item.aliases,
    };
  });
}

function loadKmlParcels(kmlDir: string): Parcel[] {
  if (!fs.existsSync(kmlDir)) throw new Error(`未找到 KML 目录：${kmlDir}`);
  const exact = new Map<string, { points: Point[]; aliases: string[] }>();
  const files = fs.readdirSync(kmlDir).filter((name) => name.toLowerCase().endsWith('.kml')).sort(localeNumericSort);
  for (const file of files) {
    const rings = extractKmlRings(fs.readFileSync(path.join(kmlDir, file), 'utf8'));
    for (const points of rings) {
      const key = canonicalRing(points);
      const known = exact.get(key);
      if (known) known.aliases.push(file);
      else exact.set(key, { points, aliases: [file] });
    }
  }

  const deduplicated: Array<{ points: Point[]; aliases: string[] }> = [];
  for (const candidate of exact.values()) {
    const duplicate = deduplicated.find((known) => isNearDuplicate(known.points, candidate.points));
    if (duplicate) duplicate.aliases.push(...candidate.aliases);
    else deduplicated.push(candidate);
  }

  return deduplicated.map((item, index) => {
    const center = ringCenter(item.points);
    const region = classifyKmlRegion(center);
    return {
      id: `kml_${String(index + 1).padStart(3, '0')}`,
      source: 'kml',
      region,
      split: region === 'beitun' || region === 'xinyuan' ? 'val' : 'train',
      points: item.points,
      aliases: item.aliases,
    };
  });
}

function extractKmlRings(text: string): Point[][] {
  const rings: Point[][] = [];
  let offset = 0;
  while (offset < text.length) {
    const start = text.indexOf('<coordinates>', offset);
    if (start < 0) break;
    const end = text.indexOf('</coordinates>', start);
    if (end < 0) break;
    const points = cleanRing(text.slice(start + 13, end).trim().split(/\s+/).map((value) => {
      const [lng, lat] = value.split(',').map(Number);
      return [lng, lat] as Point;
    }));
    if (points.length >= 3) rings.push(points);
    offset = end + 14;
  }
  return rings;
}

function cleanRing(values: any[]): Point[] {
  const points = values
    .map((value) => [Number(value?.[0]), Number(value?.[1])] as Point)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  while (points.length > 1 && pointDistance(points[0], points.at(-1)!) < 0.01) points.pop();
  return points.filter((point, index) => index === 0 || pointDistance(point, points[index - 1]) >= 0.01);
}

function canonicalRing(points: Point[]): string {
  const rounded = points.map(([lng, lat]) => [round(lng, 6), round(lat, 6)] as Point);
  const variants: string[] = [];
  for (const ring of [rounded, [...rounded].reverse()]) {
    for (let index = 0; index < ring.length; index += 1) {
      variants.push([...ring.slice(index), ...ring.slice(0, index)].flat().join(','));
    }
  }
  return variants.sort()[0] ?? '';
}

function isNearDuplicate(left: Point[], right: Point[]): boolean {
  const distance = pointDistance(ringCenter(left), ringCenter(right));
  const areaRatio = polygonAreaMeters(left) / polygonAreaMeters(right);
  return distance <= 20 && areaRatio >= 0.8 && areaRatio <= 1.25;
}

function classifyKmlRegion([lng, lat]: Point): string {
  if (lng > 87 && lng < 88.5 && lat > 46) return 'beitun';
  if (lng > 88.5 && lng < 90 && lat > 43.5) return 'qitai';
  if (lng > 85 && lng < 87 && lat > 44) return 'shihezi_kml';
  if (lng > 82 && lng < 84 && lat > 43) return 'xinyuan';
  return 'other';
}

function printInventory(parcels: Parcel[], annotations: string[]): void {
  const groups = new Map<string, number>();
  for (const parcel of parcels) groups.set(`${parcel.split}/${parcel.region}`, (groups.get(`${parcel.split}/${parcel.region}`) ?? 0) + 1);
  console.log(`人工标注：${parcels.filter((item) => item.source === 'manual').length} 个（${annotations.map((file) => path.relative(rootDir, file)).join('、')}）`);
  console.log(`KML 去重：${parcels.filter((item) => item.source === 'kml').length} 个`);
  console.log(`训练/验证：${parcels.filter((item) => item.split === 'train').length}/${parcels.filter((item) => item.split === 'val').length}`);
  for (const [group, count] of [...groups].sort()) console.log(`  ${group}: ${count}`);
}

function validatePlan(parcels: Parcel[]): void {
  assert(parcels.some((parcel) => parcel.split === 'train'), '训练集不能为空');
  assert(parcels.some((parcel) => parcel.split === 'val'), '验证集不能为空');
  for (const parcel of parcels) {
    const padded = padBounds(ringBounds(parcel.points), 0.2);
    const fit = fitAmapStaticToWgsBounds(padded);
    assert(fit.zoom >= 3 && fit.zoom <= 17, `${parcel.id} 缩放级别无效`);
    assert(fit.bounds.west <= padded.west && fit.bounds.south <= padded.south, `${parcel.id} 影像未覆盖西南边界`);
    assert(fit.bounds.east >= padded.east && fit.bounds.north >= padded.north, `${parcel.id} 影像未覆盖东北边界`);
    assert(clipToYolo(parcel.points, fit.bounds), `${parcel.id} 无法生成 YOLO 标签`);
  }
}

async function buildDataset(targets: Parcel[], allParcels: Parcel[], destination: string, serverUrl: string, resume: boolean): Promise<void> {
  const directories = ['images/train', 'images/val', 'labels/train', 'labels/val'];
  for (const directory of directories) fs.mkdirSync(path.join(destination, directory), { recursive: true });
  const zip = new JSZip();
  const metadata: any = {
    name: '新疆多区域农田地块分割数据集',
    createdAt: new Date().toISOString(),
    sourceCount: allParcels.length,
    sampleCount: targets.length,
    imageSize: [640, 640],
    splitPolicy: '石河子北部人工标注、石河子 KML、奇台用于训练；石河子南/西部、北屯、新源用于空间隔离验证。',
    samples: [],
  };
  const yaml = 'path: .\ntrain: images/train\nval: images/val\nnc: 1\nnames: [farmland]\n';
  fs.writeFileSync(path.join(destination, 'data.yaml'), yaml);
  zip.file('data.yaml', yaml);

  let cursor = 0;
  if (resume) {
    const done = directories
      .filter((directory) => directory.startsWith('images/'))
      .reduce((sum, directory) => sum + fs.readdirSync(path.join(destination, directory)).filter((file) => file.endsWith('.jpg')).length, 0);
    cursor = done;
    for (const directory of directories) {
      const absolute = path.join(destination, directory);
      if (!fs.existsSync(absolute)) continue;
      for (const file of fs.readdirSync(absolute)) {
        if (file.startsWith('.')) continue;
        zip.file(`${directory}/${file}`, fs.readFileSync(path.join(absolute, file)));
      }
    }
  }
  const workers = Array.from({ length: Math.min(2, targets.length) }, async () => {
    while (cursor < targets.length) {
      const targetIndex = cursor;
      cursor += 1;
      const target = targets[targetIndex];
      const padded = padBounds(ringBounds(target.points), 0.2);
      const fit = fitAmapStaticToWgsBounds(padded);
      const labels = allParcels
        .filter((parcel) => parcel.split === target.split)
        .map((parcel) => clipToYolo(parcel.points, fit.bounds))
        .filter((line): line is string => Boolean(line));
      if (labels.length === 0) throw new Error(`样本 ${target.id} 没有可用标签。`);

      const fileStem = `${target.split}_${target.region}_${String(targetIndex + 1).padStart(3, '0')}`;
      const image = await fetchImage(`${serverUrl}/amap-static?location=${fit.amapCenter[0].toFixed(6)},${fit.amapCenter[1].toFixed(6)}&zoom=${fit.zoom}&size=640*640&style=satellite`);
      const labelText = `${labels.join('\n')}\n`;
      const imageRelative = `images/${target.split}/${fileStem}.jpg`;
      const labelRelative = `labels/${target.split}/${fileStem}.txt`;
      fs.writeFileSync(path.join(destination, imageRelative), image);
      fs.writeFileSync(path.join(destination, labelRelative), labelText);
      zip.file(imageRelative, image);
      zip.file(labelRelative, labelText);
      metadata.samples[targetIndex] = {
        id: target.id,
        split: target.split,
        source: target.source,
        region: target.region,
        aliases: target.aliases,
        zoom: fit.zoom,
        bounds: fit.bounds,
        labelCount: labels.length,
      };
      console.log(`[${targetIndex + 1}/${targets.length}] ${fileStem} z${fit.zoom}，标签 ${labels.length}`);
    }
  });
  await Promise.all(workers);

  if (resume) {
    for (let index = 0; index < cursor; index += 1) {
      const target = targets[index];
      const padded = padBounds(ringBounds(target.points), 0.2);
      const fit = fitAmapStaticToWgsBounds(padded);
      const stem = `${target.split}_${target.region}_${String(index + 1).padStart(3, '0')}`;
      const labelPath = path.join(destination, 'labels', target.split, `${stem}.txt`);
      if (!fs.existsSync(labelPath)) continue;
      const labelCount = fs.readFileSync(labelPath, 'utf8').trim().split('\n').filter(Boolean).length;
      metadata.samples[index] = {
        id: target.id,
        split: target.split,
        source: target.source,
        region: target.region,
        aliases: target.aliases,
        zoom: fit.zoom,
        bounds: fit.bounds,
        labelCount,
      };
    }
  }

  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  fs.writeFileSync(path.join(destination, 'metadata.json'), metadataText);
  zip.file('metadata.json', metadataText);
  const zipPath = `${destination}.zip`;
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  console.log(`数据集目录：${destination}`);
  console.log(`训练 ZIP：${zipPath}`);
}

async function fetchImage(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) throw new Error(`返回类型不是影像：${contentType}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

function fitAmapStaticToWgsBounds(bounds: Bounds): StaticMapFit {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const [gcjLat, gcjLng] = wgs2gcj(centerLat, centerLng);
  const amapCenter: Point = [gcjLng, gcjLat];
  for (let zoom = 17; zoom >= 3; zoom -= 1) {
    const candidate = staticAmapBoundsToWgs(amapCenter, zoom);
    if (candidate.west <= bounds.west && candidate.south <= bounds.south && candidate.east >= bounds.east && candidate.north >= bounds.north) {
      return { amapCenter, zoom, bounds: candidate };
    }
  }
  return { amapCenter, zoom: 3, bounds: staticAmapBoundsToWgs(amapCenter, 3) };
}

function staticAmapBoundsToWgs(amapCenter: Point, zoom: number): Bounds {
  const scale = 256 * 2 ** zoom;
  const center = lngLatToWorldPixel(amapCenter[0], amapCenter[1], scale);
  const corners = [
    worldPixelToLngLat(center.x - 320, center.y + 320, scale),
    worldPixelToLngLat(center.x - 320, center.y - 320, scale),
    worldPixelToLngLat(center.x + 320, center.y - 320, scale),
    worldPixelToLngLat(center.x + 320, center.y + 320, scale),
  ].map(([lng, lat]) => gcj2wgs(lat, lng));
  const lngs = corners.map(([, lng]) => lng);
  const lats = corners.map(([lat]) => lat);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

function lngLatToWorldPixel(lng: number, lat: number, scale: number): { x: number; y: number } {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sinLat = Math.sin(safeLat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldPixelToLngLat(x: number, y: number, scale: number): Point {
  const lng = x / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / scale;
  return [lng, 180 / Math.PI * Math.atan(Math.sinh(n))];
}

function clipToYolo(points: Point[], bounds: Bounds): string | null {
  const normalized = points.map(([lng, lat]) => [
    (lng - bounds.west) / (bounds.east - bounds.west),
    (bounds.north - lat) / (bounds.north - bounds.south),
  ] as Point);
  let clipped = clipEdge(normalized, ([x]) => x >= 0, (left, right) => intersectVertical(left, right, 0));
  clipped = clipEdge(clipped, ([x]) => x <= 1, (left, right) => intersectVertical(left, right, 1));
  clipped = clipEdge(clipped, ([, y]) => y >= 0, (left, right) => intersectHorizontal(left, right, 0));
  clipped = clipEdge(clipped, ([, y]) => y <= 1, (left, right) => intersectHorizontal(left, right, 1));
  if (clipped.length < 3 || normalizedArea(clipped) < 0.0001) return null;
  return `0 ${clipped.flat().map((value) => Math.max(0, Math.min(1, value)).toFixed(6)).join(' ')}`;
}

function clipEdge(points: Point[], inside: (point: Point) => boolean, intersect: (left: Point, right: Point) => Point): Point[] {
  if (points.length === 0) return [];
  const output: Point[] = [];
  let previous = points.at(-1)!;
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) output.push(intersect(previous, current));
    if (currentInside) output.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function intersectVertical(left: Point, right: Point, x: number): Point {
  const ratio = right[0] === left[0] ? 0 : (x - left[0]) / (right[0] - left[0]);
  return [x, left[1] + ratio * (right[1] - left[1])];
}

function intersectHorizontal(left: Point, right: Point, y: number): Point {
  const ratio = right[1] === left[1] ? 0 : (y - left[1]) / (right[1] - left[1]);
  return [left[0] + ratio * (right[0] - left[0]), y];
}

function normalizedArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

function ringBounds(points: Point[]): Bounds {
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

function padBounds(bounds: Bounds, ratio: number): Bounds {
  const lngPad = Math.max(bounds.east - bounds.west, 0.0004) * ratio;
  const latPad = Math.max(bounds.north - bounds.south, 0.0004) * ratio;
  return { west: bounds.west - lngPad, south: bounds.south - latPad, east: bounds.east + lngPad, north: bounds.north + latPad };
}

function ringCenter(points: Point[]): Point {
  const bounds = ringBounds(points);
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

function polygonAreaMeters(points: Point[]): number {
  const centerLat = ringCenter(points)[1] * Math.PI / 180;
  const projected = points.map(([lng, lat]) => [lng * 111320 * Math.cos(centerLat), lat * 110540] as Point);
  return normalizedArea(projected);
}

function pointDistance(left: Point, right: Point): number {
  const meanLat = (left[1] + right[1]) / 2 * Math.PI / 180;
  return Math.hypot((left[0] - right[0]) * 111320 * Math.cos(meanLat), (left[1] - right[1]) * 110540);
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function localeNumericSort(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true });
}
