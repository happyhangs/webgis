import type { GeoJSONFeature, Layer } from '../types';
import { getDefaultFeatureStyle } from './featureStyle';

export const SHIHEZI_FARMLAND_LAYER_NAME = '石河子农田识别';
export const SHIHEZI_CENTER: [number, number] = [44.3061, 86.0806];

interface ParcelSeed {
  cluster: string;
  east: number;
  north: number;
  width: number;
  height: number;
  angle: number;
  confidence: number;
}

export function createShiheziFarmlandSegmentation(): {
  layer: Layer;
  features: GeoJSONFeature[];
  center: [number, number];
  parcelCount: number;
  totalAreaMu: number;
} {
  const layerId = crypto.randomUUID();
  const seeds = buildParcelSeeds();
  const parcelFeatures = seeds.map((seed, index) =>
    buildParcelFeature(seed, index + 1, layerId),
  );
  const boundary = buildBoundaryFeature(layerId, seeds);

  return {
    layer: { id: layerId, name: SHIHEZI_FARMLAND_LAYER_NAME, visible: true },
    features: [boundary, ...parcelFeatures],
    center: SHIHEZI_CENTER,
    parcelCount: parcelFeatures.length,
    totalAreaMu: Math.round(
      seeds.reduce((sum, seed) => sum + seed.width * seed.height / 666.7, 0),
    ),
  };
}

function buildParcelSeeds(): ParcelSeed[] {
  const clusters = [
    { name: '北部连片耕地', baseEast: -6200, baseNorth: 4800, rows: 4, cols: 6, angle: 4 },
    { name: '西侧灌区地块', baseEast: -9600, baseNorth: -1000, rows: 4, cols: 5, angle: -7 },
    { name: '东南条田区', baseEast: 2800, baseNorth: -4200, rows: 4, cols: 6, angle: 8 },
  ];

  const seeds: ParcelSeed[] = [];
  for (const cluster of clusters) {
    for (let row = 0; row < cluster.rows; row += 1) {
      for (let col = 0; col < cluster.cols; col += 1) {
        const n = seeds.length + 1;
        const width = 520 + Math.round(noise(n * 3) * 190);
        const height = 350 + Math.round(noise(n * 5) * 150);
        const east =
          cluster.baseEast + col * 760 + (noise(n * 7) - 0.5) * 90;
        const north =
          cluster.baseNorth - row * 560 + (noise(n * 11) - 0.5) * 80;
        const confidence = 0.82 + noise(n * 13) * 0.12;
        seeds.push({
          cluster: cluster.name,
          east,
          north,
          width,
          height,
          angle: cluster.angle + (noise(n * 17) - 0.5) * 3,
          confidence,
        });
      }
    }
  }
  return seeds;
}

function buildParcelFeature(seed: ParcelSeed, index: number, layerId: string): GeoJSONFeature {
  const areaMu = seed.width * seed.height / 666.7;
  const confidenceText = `${Math.round(seed.confidence * 100)}%`;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [rotatedRect(seed.east, seed.north, seed.width, seed.height, seed.angle)],
    },
    properties: {
      id: crypto.randomUUID(),
      name: `农田地块 ${String(index).padStart(3, '0')}`,
      description:
        `石河子农田地块识别示例\n` +
        `识别方式：前端模拟图像分割结果，后续可替换为遥感模型输出\n` +
        `分区：${seed.cluster}\n` +
        `置信度：${confidenceText}\n` +
        `估算面积：${areaMu.toFixed(1)} 亩`,
      ...getDefaultFeatureStyle('Polygon', '#2f7d32'),
      fillColor: confidenceColor(seed.confidence),
      fillEnabled: true,
      strokeStyle: 'solid',
      strokeWidth: 2,
      shapeType: 'Polygon',
      layerId,
    },
  };
}

function buildBoundaryFeature(layerId: string, seeds: ParcelSeed[]): GeoJSONFeature {
  const corners = seeds.flatMap((seed) =>
    rotatedRect(seed.east, seed.north, seed.width, seed.height, seed.angle).slice(0, 4),
  );
  const lngs = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  const padLng = 0.006;
  const padLat = 0.004;
  const minLng = Math.min(...lngs) - padLng;
  const maxLng = Math.max(...lngs) + padLng;
  const minLat = Math.min(...lats) - padLat;
  const maxLat = Math.max(...lats) + padLat;

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ]],
    },
    properties: {
      id: crypto.randomUUID(),
      name: '石河子识别范围',
      description:
        '示例识别范围：用于展示农田地块识别/划分工作流。真实生产识别需接入 Sentinel、无人机或本地正射影像，并由图像分割模型返回地块边界。',
      ...getDefaultFeatureStyle('Polygon', '#d99a20'),
      fillEnabled: false,
      strokeStyle: 'dashed',
      strokeWidth: 3,
      shapeType: 'Polygon',
      layerId,
    },
  };
}

function rotatedRect(
  centerEast: number,
  centerNorth: number,
  width: number,
  height: number,
  angleDeg: number,
): number[][] {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
  const coords = points.map(([x, y]) => {
    const east = centerEast + x * cos - y * sin;
    const north = centerNorth + x * sin + y * cos;
    return metersToLngLat(east, north);
  });
  return [...coords, coords[0]];
}

function metersToLngLat(eastMeters: number, northMeters: number): number[] {
  const [lat0, lng0] = SHIHEZI_CENTER;
  const lat = lat0 + northMeters / 111_320;
  const lng = lng0 + eastMeters / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#8fd17a';
  if (confidence >= 0.86) return '#b6d96b';
  return '#d6c95c';
}

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
