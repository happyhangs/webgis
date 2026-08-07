import { fromArrayBuffer } from 'geotiff';
import area from '@turf/area';
import JSZip from 'jszip';
import type { GeoJSONFeature, Layer } from '../types';

export type ManualDatasetSource = 'upload' | 'amap';

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ManualYoloDatasetOptions {
  layers: Layer[];
  features: GeoJSONFeature[];
  boundsLayerId: string;
  labelLayerId: string;
  imageBounds?: Bounds | null;
  sourceMode: ManualDatasetSource;
  uploadFile?: File | null;
  tileSize?: number;
}

export interface ManualYoloDatasetResult {
  fileName: string;
  annotationCount: number;
  imageIncluded: boolean;
  warnings: string[];
}

const DATASET_NAME = 'farmland_manual_yolo';
const IMAGE_BASENAME = 'farmland_manual_001';

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function createZip(entries: ZipEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.data, { binary: true });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function getLayerBounds(features: GeoJSONFeature[], layerId: string): Bounds | null {
  const bounds = features
    .filter((feature) => feature.properties.layerId === layerId)
    .map(getFeatureBounds)
    .filter((item): item is Bounds => item !== null);
  if (bounds.length === 0) return null;
  return mergeBounds(bounds);
}

export function getManualLabelFeatures(
  features: GeoJSONFeature[],
  labelLayerId: string,
): GeoJSONFeature[] {
  return features.filter((feature) =>
    feature.properties.layerId === labelLayerId &&
    (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
  );
}

export function buildManualLabelUpdates(
  features: GeoJSONFeature[],
): Array<{ id: string; updates: Partial<GeoJSONFeature['properties']> }> {
  return features.map((feature, index) => {
    const parcelIndex = index + 1;
    const areaProps = getAreaProps(feature);
    return {
      id: feature.properties.id,
      updates: {
        parcelCode: feature.properties.parcelCode || `MAN-${String(parcelIndex).padStart(3, '0')}`,
        parcelIndex,
        parcelGroup: feature.properties.parcelGroup || '人工标定',
        parcelAreaMu: feature.properties.parcelAreaMu || areaProps.parcelAreaMu,
        parcelAreaSquareMeters: feature.properties.parcelAreaSquareMeters || areaProps.parcelAreaSquareMeters,
        parcelRole: 'parcel',
        source: 'manual-farmland-label',
      },
    };
  });
}

export async function exportManualYoloDataset(
  options: ManualYoloDatasetOptions,
): Promise<ManualYoloDatasetResult> {
  const tileSize = options.tileSize || 640;
  const warnings: string[] = [];
  const labelBounds = getLayerBounds(options.features, options.boundsLayerId);
  const bounds = options.imageBounds || labelBounds;
  if (!bounds) throw new Error('缺少影像覆盖范围，无法计算导出范围。');
  if (!isValidBounds(bounds)) throw new Error('影像覆盖范围无效，请检查坐标。');

  const labelFeatures = getManualLabelFeatures(options.features, options.labelLayerId);
  if (labelFeatures.length === 0) {
    throw new Error('标定图层中没有面状农田标注，请先绘制 Polygon/Rectangle。');
  }

  const annotations = buildYoloAnnotations(labelFeatures, bounds, warnings);
  if (annotations.lines.length === 0) {
    throw new Error('标定图层没有落在选区范围内的有效多边形。');
  }

  const entries: ZipEntry[] = [];
  const imageName = `${IMAGE_BASENAME}.jpg`;
  const labelName = `${IMAGE_BASENAME}.txt`;
  let imageIncluded = false;

  try {
    const imageBlob = options.sourceMode === 'upload'
      ? await createUploadedImageBlob(options.uploadFile, tileSize)
      : null;
    if (imageBlob) {
      entries.push({
        name: `images/train/${imageName}`,
        data: new Uint8Array(await imageBlob.arrayBuffer()),
      });
      imageIncluded = true;
    } else if (options.sourceMode === 'amap') {
      warnings.push('高德选区底图仅作为人工标定底图，本次不写入训练图片；建议上传自有或授权影像生成完整训练集。');
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '训练图片生成失败。');
  }

  if (!imageIncluded) {
    warnings.push('未写入训练图片；已导出标签、GeoJSON 和清单，可补齐图片后再训练。');
  }

  entries.push(
    {
      name: `labels/train/${labelName}`,
      data: textBytes(`${annotations.lines.join('\n')}\n`),
    },
    {
      name: 'data.yaml',
      data: textBytes([
        'path: .',
        'train: images/train',
        'val: images/train',
        'names:',
        '  0: farmland',
        '',
      ].join('\n')),
    },
    {
      name: 'annotations.geojson',
      data: textBytes(JSON.stringify({
        type: 'FeatureCollection',
        name: 'manual-farmland-labels',
        features: annotations.features,
      }, null, 2)),
    },
    {
      name: 'meta.json',
      data: textBytes(JSON.stringify({
        generatedAt: new Date().toISOString(),
        sourceMode: options.sourceMode,
        imageBounds: bounds,
        labelBounds,
        boundsLayer: options.layers.find((layer) => layer.id === options.boundsLayerId)?.name || '',
        labelLayer: options.layers.find((layer) => layer.id === options.labelLayerId)?.name || '',
        classes: ['farmland'],
        image: imageIncluded ? `images/train/${imageName}` : null,
        label: `labels/train/${labelName}`,
        annotationCount: annotations.lines.length,
        warnings,
      }, null, 2)),
    },
  );

  const zip = await createZip(entries);
  const fileName = `${DATASET_NAME}_${new Date().toISOString().slice(0, 10)}.zip`;
  downloadBlob(zip, fileName);
  return {
    fileName,
    annotationCount: annotations.lines.length,
    imageIncluded,
    warnings,
  };
}

/** Same as exportManualYoloDataset but returns the Blob instead of downloading. */
export async function exportManualYoloDatasetToBlob(
  options: ManualYoloDatasetOptions,
): Promise<Blob> {
  const tileSize = options.tileSize || 640;
  const warnings: string[] = [];
  const labelBounds = getLayerBounds(options.features, options.boundsLayerId);
  const bounds = options.imageBounds || labelBounds;
  if (!bounds) throw new Error('缺少影像覆盖范围，无法计算导出范围。');
  if (!isValidBounds(bounds)) throw new Error('影像覆盖范围无效，请检查坐标。');

  const labelFeatures = getManualLabelFeatures(options.features, options.labelLayerId);
  if (labelFeatures.length === 0) {
    throw new Error('标定图层中没有面状农田标注，请先绘制 Polygon/Rectangle。');
  }

  const annotations = buildYoloAnnotations(labelFeatures, bounds, warnings);
  if (annotations.lines.length === 0) {
    throw new Error('标定图层没有落在选区范围内的有效多边形。');
  }

  const entries: ZipEntry[] = [];
  const imageName = `${IMAGE_BASENAME}.jpg`;
  const labelName = `${IMAGE_BASENAME}.txt`;
  let imageIncluded = false;

  try {
    const imageBlob = options.sourceMode === 'upload'
      ? await createUploadedImageBlob(options.uploadFile, tileSize)
      : null;
    if (imageBlob) {
      entries.push({
        name: `images/train/${imageName}`,
        data: new Uint8Array(await imageBlob.arrayBuffer()),
      });
      imageIncluded = true;
    } else if (options.sourceMode === 'amap') {
      warnings.push('高德选区底图仅作为人工标定底图，本次不写入训练图片；建议上传自有或授权影像生成完整训练集。');
    }
  } catch {
    // no image — labels only
  }

  entries.push(
    { name: `labels/train/${labelName}`, data: textBytes(`${annotations.lines.join('\n')}\n`) },
    {
      name: 'data.yaml',
      data: textBytes(['path: .', 'train: images/train', 'val: images/train', 'names:', '  0: farmland', '', ''].join('\n')),
    },
    {
      name: 'annotations.geojson',
      data: textBytes(JSON.stringify({
        type: 'FeatureCollection',
        name: 'manual-farmland-labels',
        features: annotations.features,
      }, null, 2)),
    },
    {
      name: 'meta.json',
      data: textBytes(JSON.stringify({
        generatedAt: new Date().toISOString(),
        sourceMode: options.sourceMode,
        imageBounds: bounds,
        labelBounds,
        boundsLayer: options.layers.find((layer) => layer.id === options.boundsLayerId)?.name || '',
        labelLayer: options.layers.find((layer) => layer.id === options.labelLayerId)?.name || '',
        classes: ['farmland'],
        image: imageIncluded ? `images/train/${imageName}` : null,
        label: `labels/train/${labelName}`,
        annotationCount: annotations.lines.length,
        warnings,
      }, null, 2)),
    },
  );

  return createZip(entries);
}

export async function buildYoloDatasetZipFromImage(
  imageBlob: Blob,
  labelFeatures: GeoJSONFeature[],
  bounds: Bounds,
  filePrefix = IMAGE_BASENAME,
): Promise<Blob> {
  const warnings: string[] = [];
  if (!isValidBounds(bounds)) throw new Error('影像覆盖范围无效，请检查坐标。');

  const polygons = labelFeatures.filter((feature) =>
    feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
  );
  if (polygons.length === 0) {
    throw new Error('YOLO 分割训练需要至少一个面标注，请先用“面”工具圈出地块。');
  }

  const annotations = buildYoloAnnotations(polygons, bounds, warnings);
  if (annotations.lines.length === 0) {
    throw new Error('地图草图中没有落在当前视图范围内的有效面标注。');
  }

  const safePrefix = (filePrefix || IMAGE_BASENAME)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || IMAGE_BASENAME;
  const imageExt = imageBlob.type.includes('png') ? 'png' : 'jpg';
  const imageName = `${safePrefix}.${imageExt}`;
  const labelName = `${safePrefix}.txt`;
  const labelBounds = mergeBounds(
    annotations.features
      .map(getFeatureBounds)
      .filter((item): item is Bounds => item !== null),
  );

  return createZip([
    {
      name: `images/train/${imageName}`,
      data: new Uint8Array(await imageBlob.arrayBuffer()),
    },
    {
      name: `labels/train/${labelName}`,
      data: textBytes(`${annotations.lines.join('\n')}\n`),
    },
    {
      name: 'data.yaml',
      data: textBytes(['path: .', 'train: images/train', 'val: images/train', 'names:', '  0: farmland', '', ''].join('\n')),
    },
    {
      name: 'annotations.geojson',
      data: textBytes(JSON.stringify({
        type: 'FeatureCollection',
        name: 'map-draft-farmland-labels',
        features: annotations.features,
      }, null, 2)),
    },
    {
      name: 'meta.json',
      data: textBytes(JSON.stringify({
        generatedAt: new Date().toISOString(),
        sourceMode: 'map-draft',
        imageBounds: bounds,
        labelBounds,
        classes: ['farmland'],
        image: `images/train/${imageName}`,
        label: `labels/train/${labelName}`,
        annotationCount: annotations.lines.length,
        warnings,
      }, null, 2)),
    },
  ]);
}

function buildYoloAnnotations(
  labelFeatures: GeoJSONFeature[],
  bounds: Bounds,
  warnings: string[],
): { lines: string[]; features: GeoJSONFeature[] } {
  const lines: string[] = [];
  let clippedCount = 0;
  const annotationFeatures = labelFeatures.flatMap((feature, featureIndex) => {
    const featureBounds = getFeatureBounds(feature);
    if (!featureBounds || !intersects(bounds, featureBounds)) return [];
    const areaProps = getAreaProps(feature);

    const updatedFeature: GeoJSONFeature = {
      ...feature,
      properties: {
        ...feature.properties,
        parcelCode: feature.properties.parcelCode || `MAN-${String(featureIndex + 1).padStart(3, '0')}`,
        parcelIndex: feature.properties.parcelIndex || featureIndex + 1,
        parcelGroup: feature.properties.parcelGroup || '人工标定',
        parcelAreaMu: feature.properties.parcelAreaMu || areaProps.parcelAreaMu,
        parcelAreaSquareMeters: feature.properties.parcelAreaSquareMeters || areaProps.parcelAreaSquareMeters,
        parcelRole: 'parcel',
        source: 'manual-farmland-label',
      },
    };

    for (const ring of getExteriorRings(feature)) {
      const clean = dedupeClosedRing(ring);
      if (clean.length < 3) continue;
      if (clean.some(([lng, lat]) => lng < bounds.west || lng > bounds.east || lat < bounds.south || lat > bounds.north)) {
        clippedCount += 1;
      }
      const normalized = clean
        .map((point) => normalizePoint(point, bounds))
        .filter((point, index, arr) =>
          index === 0 || Math.abs(point[0] - arr[index - 1][0]) > 1e-7 || Math.abs(point[1] - arr[index - 1][1]) > 1e-7,
        );
      if (normalized.length < 3) continue;
      lines.push(`0 ${normalized.flatMap(([x, y]) => [x.toFixed(6), y.toFixed(6)]).join(' ')}`);
    }

    return [updatedFeature];
  });

  if (clippedCount > 0) {
    warnings.push(`${clippedCount} 个多边形超出选区边界，导出时已将坐标裁切到 0-1 范围。`);
  }
  return { lines, features: annotationFeatures };
}

function getAreaProps(feature: GeoJSONFeature): {
  parcelAreaMu?: number;
  parcelAreaSquareMeters?: number;
} {
  try {
    const areaSquareMeters = area(feature);
    if (!Number.isFinite(areaSquareMeters) || areaSquareMeters <= 0) return {};
    return {
      parcelAreaSquareMeters: Number(areaSquareMeters.toFixed(2)),
      parcelAreaMu: Number((areaSquareMeters / 666.667).toFixed(2)),
    };
  } catch {
    return {};
  }
}

function getFeatureBounds(feature: GeoJSONFeature): Bounds | null {
  const coords = flattenCoordinates(feature.geometry.coordinates)
    .filter(([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90,
    );
  if (coords.length === 0) return null;
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function mergeBounds(bounds: Bounds[]): Bounds {
  return {
    west: Math.min(...bounds.map((item) => item.west)),
    south: Math.min(...bounds.map((item) => item.south)),
    east: Math.max(...bounds.map((item) => item.east)),
    north: Math.max(...bounds.map((item) => item.north)),
  };
}

function isValidBounds(bounds: Bounds): boolean {
  return bounds.east > bounds.west && bounds.north > bounds.south;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function getExteriorRings(feature: GeoJSONFeature): number[][][] {
  const coords = feature.geometry.coordinates as any;
  if (feature.geometry.type === 'Polygon' && Array.isArray(coords?.[0])) return [coords[0]];
  if (feature.geometry.type === 'MultiPolygon' && Array.isArray(coords)) {
    return coords.flatMap((polygon: any) => Array.isArray(polygon?.[0]) ? [polygon[0]] : []);
  }
  return [];
}

function dedupeClosedRing(ring: number[][]): number[][] {
  const points = ring
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
      points.pop();
    }
  }
  return points;
}

function normalizePoint([lng, lat]: number[], bounds: Bounds): [number, number] {
  const x = clamp01((lng - bounds.west) / (bounds.east - bounds.west));
  const y = clamp01((bounds.north - lat) / (bounds.north - bounds.south));
  return [x, y];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function flattenCoordinates(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [[Number(value[0]), Number(value[1])]];
  }
  return value.flatMap((item) => flattenCoordinates(item));
}

export async function createUploadedImageBlob(file: File | null | undefined, tileSize: number): Promise<Blob | null> {
  if (!file) throw new Error('上传影像模式需要先选择一张影像文件。');
  if (/\.(tif|tiff)$/i.test(file.name)) {
    return createGeoTiffJpegBlob(file, tileSize);
  }
  return createRasterImageBlob(file, tileSize);
}

export async function readGeoTiffBounds(file: File): Promise<Bounds | null> {
  if (!/\.(tif|tiff)$/i.test(file.name)) return null;
  const tiff = await fromArrayBuffer(await file.arrayBuffer());
  const image = await tiff.getImage();
  const geoKeys = image.getGeoKeys();
  const geographicCode = Number(Array.isArray(geoKeys?.GeographicTypeGeoKey)
    ? geoKeys.GeographicTypeGeoKey[0]
    : geoKeys?.GeographicTypeGeoKey);
  if (geographicCode !== 4326 && geographicCode !== 4490) return null;
  const [west, south, east, north] = image.getBoundingBox().map(Number);
  if (!(west >= -180 && west < east && east <= 180 && south >= -90 && south < north && north <= 90)) {
    return null;
  }
  return { west, south, east, north };
}

async function createRasterImageBlob(file: File, tileSize: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建图片画布。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tileSize, tileSize);
  ctx.drawImage(bitmap, 0, 0, tileSize, tileSize);
  bitmap.close();
  return canvasToBlob(canvas);
}

async function createGeoTiffJpegBlob(file: File, tileSize: number): Promise<Blob> {
  const tiff = await fromArrayBuffer(await file.arrayBuffer());
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const rasters = await image.readRasters();
  const samples = image.getSamplesPerPixel();
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('浏览器无法创建 GeoTIFF 画布。');
  const imageData = sourceCtx.createImageData(width, height);
  const first = rasters[0] as any;
  const bitsPerSample = image.getBitsPerSample ? (image.getBitsPerSample() as any)[0] : (first instanceof Uint16Array ? 16 : first instanceof Float32Array ? 32 : 8);
  const maxValue = first instanceof Float32Array ? 1 : (1 << bitsPerSample) - 1;
  const r = rasters[0] as any;
  const g = (samples >= 3 ? rasters[1] : rasters[0]) as any;
  const b = (samples >= 3 ? rasters[2] : rasters[0]) as any;
  for (let i = 0; i < width * height; i += 1) {
    imageData.data[i * 4] = Math.round((Number(r[i]) / maxValue) * 255);
    imageData.data[i * 4 + 1] = Math.round((Number(g[i]) / maxValue) * 255);
    imageData.data[i * 4 + 2] = Math.round((Number(b[i]) / maxValue) * 255);
    imageData.data[i * 4 + 3] = 255;
  }
  sourceCtx.putImageData(imageData, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建训练图片画布。');
  ctx.drawImage(source, 0, 0, tileSize, tileSize);
  return canvasToBlob(canvas);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('训练图片编码失败。'));
    }, 'image/jpeg', 0.92);
  });
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
