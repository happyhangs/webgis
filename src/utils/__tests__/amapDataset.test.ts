import { describe, expect, it } from 'vitest';
import {
  buildAmapDataset,
  buildSampleLabelLines,
  getPolygonBounds,
  padSampleBounds,
  planAmapDatasetSamples,
} from '../amapDataset';
import type { GeoJSONFeature } from '../../types';

function makeRect(
  west: number,
  south: number,
  east: number,
  north: number,
  id = `rect-${west}-${south}`,
): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
    properties: { id, name: id } as any,
  };
}

describe('planAmapDatasetSamples', () => {
  it('creates one sample per parcel, centered and padded', () => {
    // 两个相距约 5km 的地块
    const a = makeRect(86.0, 44.5, 86.002, 44.5015);
    const b = makeRect(86.06, 44.53, 86.062, 44.5315);
    const samples = planAmapDatasetSamples([a, b]);

    expect(samples).toHaveLength(2);
    for (const [feature, sample] of [[a, samples[0]], [b, samples[1]]] as const) {
      const own = getPolygonBounds(feature)!;
      const padded = padSampleBounds(own);
      // 样本影像范围必须覆盖（含边距的）地块
      expect(sample.bounds.west).toBeLessThanOrEqual(padded.west + 1e-9);
      expect(sample.bounds.south).toBeLessThanOrEqual(padded.south + 1e-9);
      expect(sample.bounds.east).toBeGreaterThanOrEqual(padded.east - 1e-9);
      expect(sample.bounds.north).toBeGreaterThanOrEqual(padded.north - 1e-9);
      // 高清取样：数百米级地块应达到 z15 以上
      expect(sample.zoom).toBeGreaterThanOrEqual(15);
      expect(sample.zoom).toBeLessThanOrEqual(17);
    }
    // 中心落在各自地块附近（GCJ 偏移量级 <0.01°）
    expect(Math.abs(samples[0].amapCenter[0] - 86.001)).toBeLessThan(0.01);
    expect(Math.abs(samples[1].amapCenter[0] - 86.061)).toBeLessThan(0.01);
  });

  it('skips invalid geometry', () => {
    const empty = makeRect(86, 44.5, 86, 44.5);
    const point: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [86, 44.5] },
      properties: { id: 'p' } as any,
    };
    expect(planAmapDatasetSamples([empty, point])).toHaveLength(0);
  });
});

describe('buildSampleLabelLines', () => {
  const sampleBounds = { west: 86.0, south: 44.5, east: 86.001, north: 44.501 };

  it('normalizes an inside parcel to 0-1 with the class prefix', () => {
    const inside = makeRect(86.0002, 44.5002, 86.0008, 44.5008);
    const lines = buildSampleLabelLines([inside], sampleBounds);

    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('0 ')).toBe(true);
    const values = lines[0].split(' ').slice(1).map(Number);
    expect(values.length).toBeGreaterThanOrEqual(6);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // 归一化位置正确：x ≈ (86.0002-86)/0.001 = 0.2
    expect(Math.min(...values.filter((_, i) => i % 2 === 0))).toBeCloseTo(0.2, 4);
  });

  it('clips a half-outside neighbor into the frame', () => {
    // 跨越西边界的矩形：可见部分 x∈[0,0.5]
    const crossing = makeRect(85.9995, 44.5002, 86.0005, 44.5008);
    const lines = buildSampleLabelLines([crossing], sampleBounds);

    expect(lines).toHaveLength(1);
    const values = lines[0].split(' ').slice(1).map(Number);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const xs = values.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 4);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
  });

  it('skips parcels fully outside the frame', () => {
    const outside = makeRect(86.01, 44.51, 86.02, 44.52);
    expect(buildSampleLabelLines([outside], sampleBounds)).toHaveLength(0);
  });

  it('drops corner slivers below the minimum visible area', () => {
    // 只有 0.02×0.004 的角部可见（面积 0.00008 < 0.0001）
    const sliver = makeRect(86.00098, 44.500996, 86.00102, 44.501004);
    expect(buildSampleLabelLines([sliver], sampleBounds)).toHaveLength(0);
  });

  it('emits one line per polygon part of a MultiPolygon', () => {
    const multi: GeoJSONFeature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[86.0001, 44.5001], [86.0003, 44.5001], [86.0003, 44.5003], [86.0001, 44.5001]]],
          [[[86.0005, 44.5005], [86.0007, 44.5005], [86.0007, 44.5007], [86.0005, 44.5005]]],
        ] as any,
      },
      properties: { id: 'multi' } as any,
    };
    expect(buildSampleLabelLines([multi], sampleBounds)).toHaveLength(2);
  });
});

describe('buildAmapDataset（取图容错与取消）', () => {
  const features = [
    makeRect(86.0, 44.5, 86.001, 44.501),
    makeRect(86.01, 44.5, 86.011, 44.501),
    makeRect(86.02, 44.5, 86.021, 44.501),
  ];

  function okImageResponse() {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      blob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
    } as any;
  }
  function failResponse() {
    return {
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'application/json' }),
      blob: async () => new Blob([]),
    } as any;
  }

  it('skips failed samples and keeps the rest', async () => {
    const originalFetch = globalThis.fetch;
    // 用第 2 个样本的实际请求中心来判定失败，确保 3 次重试全部失败
    const samples = planAmapDatasetSamples(features);
    const badLng = samples[1].amapCenter[0].toFixed(6);
    let failedCalls = 0;
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes(`location=${badLng}`)) {
        failedCalls += 1;
        return failResponse();
      }
      return okImageResponse();
    }) as any;
    try {
      const result = await buildAmapDataset(features, { workers: 1, backendUrl: 'http://127.0.0.1:9' });
      expect(result.plannedCount).toBe(3);
      expect(result.sampleCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.cancelled).toBe(false);
      expect(failedCalls).toBe(3); // 重试 3 次后跳过
      expect(result.blob.size).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it('throws when every sample fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => failResponse()) as any;
    try {
      await expect(buildAmapDataset(features, { workers: 1, backendUrl: 'http://127.0.0.1:9' }))
        .rejects.toThrow(/没有生成任何训练样本/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it('stops early when cancelled and keeps finished samples', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return okImageResponse();
    }) as any;
    try {
      const result = await buildAmapDataset(features, {
        workers: 1,
        backendUrl: 'http://127.0.0.1:9',
        shouldCancel: () => calls >= 1,
      });
      expect(result.cancelled).toBe(true);
      expect(result.sampleCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);
});
