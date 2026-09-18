/**
 * 「用现有标注训练」数据集构建（浏览器端）。
 *
 * 背景：旧实现把所有标注拟合进一张 640px 影像——标注范围越大每块像素越少
 * （几十公里范围下每块只剩几个像素，模型学不到形状）。这里移植 CLI 脚本
 * scripts/build-xinjiang-training-dataset.ts 的逐地块取样：
 *  - 每个地块取一张以它为中心、四周外扩 20% 的 640px 高德卫星影像（自动选缩放，通常 z15-17）；
 *  - 影像范围内的所有标注经 Sutherland–Hodgman 裁切到画面内后写入该样本的 YOLO 标签；
 *  - 样本写入 images/train + labels/train，验证集由后端按影像内容哈希稳定切分。
 *
 * 可取消：shouldCancel() 返回 true 时停止取样，已完成样本照常打包
 * （对齐识别批处理的停止契约，不浪费已完成的取图）。
 */
import JSZip from 'jszip';
import { fitAmapStaticToWgsBounds } from './amapStatic';
import { DEFAULT_BACKEND_URL } from '../backendUrl';
import type { Bounds } from './yoloDataset';
import type { GeoJSONFeature } from '../types';

type Point = [number, number];

export interface AmapSample {
  /** 目标地块 id（样本以它为中心）。 */
  targetId: string;
  /** 影像覆盖范围（WGS-84，已含 padding）。 */
  bounds: Bounds;
  /** 静态图请求中心（GCJ-02 [lng, lat]）。 */
  amapCenter: [number, number];
  zoom: number;
}

export interface AmapDatasetProgress {
  done: number;
  total: number;
}

export interface BuildAmapDatasetOptions {
  backendUrl?: string;
  /** 并发取图数（默认 3）。 */
  workers?: number;
  onProgress?: (progress: AmapDatasetProgress) => void;
  /** 返回 true 时停止取样（已完成样本照常打包）。 */
  shouldCancel?: () => boolean;
}

export interface BuildAmapDatasetResult {
  blob: Blob;
  plannedCount: number;
  sampleCount: number;
  /** 取图失败被跳过的样本数（单样本失败不中断整批）。 */
  failedCount: number;
  cancelled: boolean;
}

function exteriorRings(feature: GeoJSONFeature): number[][][] {
  if (feature.geometry.type === 'Polygon') {
    const rings = feature.geometry.coordinates as number[][][];
    return Array.isArray(rings) ? [rings[0] ?? []] : [];
  }
  if (feature.geometry.type === 'MultiPolygon') {
    const polygons = feature.geometry.coordinates as unknown as number[][][][];
    return Array.isArray(polygons) ? polygons.map((polygon) => polygon?.[0] ?? []) : [];
  }
  return [];
}

/** 面要素的 WGS-84 包围盒；无有效坐标返回 null。 */
export function getPolygonBounds(feature: GeoJSONFeature): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = false;
  for (const ring of exteriorRings(feature)) {
    for (const point of ring) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      seen = true;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return seen ? { west, south, east, north } : null;
}

/** 取样边距：四周外扩 ratio（默认 20%）；极小的地块保底外扩 ~40m，避免贴边。 */
export function padSampleBounds(bounds: Bounds, ratio = 0.2): Bounds {
  const lngPad = Math.max(bounds.east - bounds.west, 0.0004) * ratio;
  const latPad = Math.max(bounds.north - bounds.south, 0.0004) * ratio;
  return {
    west: bounds.west - lngPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    north: bounds.north + latPad,
  };
}

/** 逐地块规划取样：每个面一个样本（以它为中心的 640px 影像）。 */
export function planAmapDatasetSamples(features: GeoJSONFeature[]): AmapSample[] {
  const samples: AmapSample[] = [];
  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
    const bounds = getPolygonBounds(feature);
    // 跳过坐标无效或退化（宽/高为 0）的面
    if (!bounds || bounds.east - bounds.west <= 0 || bounds.north - bounds.south <= 0) continue;
    const fit = fitAmapStaticToWgsBounds(padSampleBounds(bounds));
    samples.push({
      targetId: String(feature.properties.id || feature.properties.parcelCode || `sample-${samples.length + 1}`),
      bounds: fit.bounds,
      amapCenter: fit.amapCenter,
      zoom: fit.zoom,
    });
  }
  return samples;
}

function pointDistance(left: Point, right: Point): number {
  const meanLat = ((left[1] + right[1]) / 2) * Math.PI / 180;
  return Math.hypot(
    (left[0] - right[0]) * 111320 * Math.cos(meanLat),
    (left[1] - right[1]) * 110540,
  );
}

/** 去重闭合点与相邻重复点（<1cm 视为同一点）。 */
function cleanRing(values: number[][]): Point[] {
  const points = values
    .map((value) => [Number(value?.[0]), Number(value?.[1])] as Point)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  while (points.length > 1 && pointDistance(points[0], points[points.length - 1]) < 0.01) points.pop();
  return points.filter(
    (point, index) => index === 0 || pointDistance(point, points[index - 1]) >= 0.01,
  );
}

function clipEdge(
  points: Point[],
  inside: (point: Point) => boolean,
  intersect: (left: Point, right: Point) => Point,
): Point[] {
  if (points.length === 0) return [];
  const output: Point[] = [];
  let previous = points[points.length - 1];
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
  return (
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0),
    ) / 2
  );
}

/**
 * 生成某张样本影像的 YOLO 标签行：
 * 所有与该影像相交的标注面外环 → 归一化到 0-1 → 裁到画面内 → `0 x y ...`。
 * 画面外的块与过小残片（面积 <0.01% 画面）直接跳过。
 */
export function buildSampleLabelLines(features: GeoJSONFeature[], sampleBounds: Bounds): string[] {
  const spanX = sampleBounds.east - sampleBounds.west;
  const spanY = sampleBounds.north - sampleBounds.south;
  if (!(spanX > 0) || !(spanY > 0)) return [];

  const lines: string[] = [];
  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
    for (const ring of exteriorRings(feature)) {
      const clean = cleanRing(ring);
      if (clean.length < 3) continue;
      const normalized = clean.map(([lng, lat]) => [
        (lng - sampleBounds.west) / spanX,
        (sampleBounds.north - lat) / spanY,
      ] as Point);
      let clipped = clipEdge(normalized, (point) => point[0] >= 0, (left, right) => intersectVertical(left, right, 0));
      clipped = clipEdge(clipped, (point) => point[0] <= 1, (left, right) => intersectVertical(left, right, 1));
      clipped = clipEdge(clipped, (point) => point[1] >= 0, (left, right) => intersectHorizontal(left, right, 0));
      clipped = clipEdge(clipped, (point) => point[1] <= 1, (left, right) => intersectHorizontal(left, right, 1));
      if (clipped.length < 3 || normalizedArea(clipped) < 0.0001) continue;
      lines.push(
        `0 ${clipped.flat().map((value) => Math.min(1, Math.max(0, value)).toFixed(6)).join(' ')}`,
      );
    }
  }
  return lines;
}

async function fetchAmapSample(url: string): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) throw new Error(`返回类型不是影像：${contentType}`);
      return await response.blob();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`影像下载失败（重试 3 次）：${detail}`);
}

/** 逐地块取样并打包为训练集 zip（images/train + labels/train + data.yaml + meta.json）。 */
export async function buildAmapDataset(
  features: GeoJSONFeature[],
  options: BuildAmapDatasetOptions = {},
): Promise<BuildAmapDatasetResult> {
  const polygons = features.filter(
    (feature) => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
  );
  if (polygons.length === 0) throw new Error('标定图层没有面状标注，无法生成训练集。');
  const samples = planAmapDatasetSamples(polygons);
  if (samples.length === 0) throw new Error('标注坐标无效，无法生成训练影像。');

  const backendUrl = (options.backendUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  const workers = Math.max(1, Math.min(4, Math.round(options.workers ?? 3)));
  const zip = new JSZip();
  const metaSamples: Array<Record<string, unknown>> = [];
  let cursor = 0;
  let done = 0;
  let sampleCount = 0;
  let failedCount = 0;
  let cancelled = false;

  const runWorker = async () => {
    for (;;) {
      if (options.shouldCancel?.()) {
        cancelled = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= samples.length) return;

      const sample = samples[index];
      const labels = buildSampleLabelLines(polygons, sample.bounds);
      done += 1;
      if (labels.length > 0) {
        try {
          const [lng, lat] = sample.amapCenter;
          const url = `${backendUrl}/amap-static?location=${lng.toFixed(6)},${lat.toFixed(6)}&zoom=${sample.zoom}&size=640*640&style=satellite`;
          const imageBlob = await fetchAmapSample(url);
          const stem = `sample_${String(index + 1).padStart(3, '0')}`;
          zip.file(`images/train/${stem}.jpg`, new Uint8Array(await imageBlob.arrayBuffer()));
          zip.file(`labels/train/${stem}.txt`, `${labels.join('\n')}\n`);
          metaSamples.push({
            name: stem,
            targetId: sample.targetId,
            zoom: sample.zoom,
            bounds: sample.bounds,
            labelCount: labels.length,
          });
          sampleCount += 1;
        } catch {
          // 单样本取图失败不中断整批（与识别批处理的容错一致）
          failedCount += 1;
        }
      }
      options.onProgress?.({ done, total: samples.length });
    }
  };
  await Promise.all(Array.from({ length: workers }, runWorker));

  if (sampleCount === 0) {
    throw new Error('没有生成任何训练样本，请检查后端服务与网络后重试。');
  }

  zip.file(
    'data.yaml',
    ['path: .', 'train: images/train', 'val: images/val', 'nc: 1', 'names: [farmland]', ''].join('\n'),
  );
  zip.file(
    'meta.json',
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      sourceMode: 'amap-per-parcel',
      imageSize: [640, 640],
      plannedCount: samples.length,
      sampleCount,
      failedCount,
      cancelled,
      samples: metaSamples,
    }, null, 2),
  );

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob, plannedCount: samples.length, sampleCount, failedCount, cancelled };
}
