import { describe, expect, it } from 'vitest';
import { adoptRecognitionAsLabels } from '../preAnnotation';
import { polygonAreaSquareMeters } from '../geoBounds';
import type { GeoJSONFeature } from '../../types';

/** 生成一个矩形面要素。 */
function makeRect(
  west: number,
  south: number,
  east: number,
  north: number,
  properties: Record<string, unknown> = {},
): GeoJSONFeature {
  const coordinates = [[
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]];
  const area = polygonAreaSquareMeters(coordinates);
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates },
    properties: {
      id: `feat-${west}-${south}`,
      name: 'x',
      parcelAreaSquareMeters: Number(area.toFixed(2)),
      ...properties,
    } as any,
  };
}

describe('adoptRecognitionAsLabels', () => {
  it('converts recognition polygons into numbered MAN labels', () => {
    const recognition = [makeRect(86.0, 44.5, 86.001, 44.501)];
    const { features, skipped } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: [],
      labelLayerId: 'layer-label',
    });

    expect(skipped).toBe(0);
    expect(features).toHaveLength(1);
    const label = features[0];
    expect(label.properties.parcelCode).toBe('MAN-001');
    expect(label.properties.parcelIndex).toBe(1);
    expect(label.properties.layerId).toBe('layer-label');
    expect(label.properties.source).toBe('manual-farmland-label');
    expect(label.properties.parcelRole).toBe('parcel');
    expect(label.properties.parcelGroup).toBe('人工标定');
    expect(label.properties.shapeType).toBe('Polygon');
    expect(label.properties.parcelAreaMu).toBeGreaterThan(0);
    expect(label.geometry.type).toBe('Polygon');
    // 新要素 id 不与源要素相同
    expect(label.properties.id).not.toBe(recognition[0].properties.id);
  });

  it('continues numbering from existing labels (parcelIndex 与 MAN 代码双来源)', () => {
    const existing = [
      makeRect(86.0, 44.5, 86.001, 44.501, { parcelCode: 'MAN-007', parcelIndex: 7, source: 'manual-farmland-label' }),
      makeRect(86.002, 44.5, 86.003, 44.501, { parcelCode: 'MAN-012', parcelIndex: 12, source: 'manual-farmland-label' }),
    ];
    const recognition = [makeRect(86.01, 44.5, 86.011, 44.501)];
    const { features } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: existing,
      labelLayerId: 'layer-label',
    });

    expect(features[0].properties.parcelCode).toBe('MAN-013');
  });

  it('skips recognition results overlapping existing labels', () => {
    const existing = [makeRect(86.0, 44.5, 86.002, 44.502, { parcelCode: 'MAN-001', parcelIndex: 1 })];
    // 与已有标定几乎完全重叠
    const recognition = [makeRect(86.0001, 44.5001, 86.0021, 44.5021)];
    const { features, skipped } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: existing,
      labelLayerId: 'layer-label',
    });

    expect(features).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('dedupes within the same recognition batch', () => {
    const recognition = [
      makeRect(86.0, 44.5, 86.001, 44.501),
      makeRect(86.00005, 44.50005, 86.00105, 44.50105), // 与上一块几乎重合
      makeRect(86.01, 44.5, 86.011, 44.501), // 独立地块
    ];
    const { features, skipped } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: [],
      labelLayerId: 'layer-label',
    });

    expect(features).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(features.map((f) => f.properties.parcelCode)).toEqual(['MAN-001', 'MAN-002']);
  });

  it('keeps distant parcels and preserves confidence in description', () => {
    const recognition = [
      makeRect(86.0, 44.5, 86.001, 44.501, { parcelConfidence: 0.42 }),
      makeRect(86.05, 44.55, 86.051, 44.551, { parcelConfidence: 0.9 }),
    ];
    const { features } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: [],
      labelLayerId: 'layer-label',
    });

    expect(features).toHaveLength(2);
    expect(features[0].properties.parcelConfidence).toBe(0.42);
    expect(String(features[0].properties.description)).toContain('42%');
    expect(String(features[1].properties.description)).toContain('90%');
  });

  it('reports low-confidence count among converted blocks only', () => {
    const existing = [makeRect(86.0, 44.5, 86.002, 44.502, { parcelCode: 'MAN-001', parcelIndex: 1 })];
    const recognition = [
      makeRect(86.0001, 44.5001, 86.0021, 44.5021, { parcelConfidence: 0.2 }), // 与已有标定重复且低置信 → 应跳过且不计入
      makeRect(86.01, 44.5, 86.011, 44.501, { parcelConfidence: 0.3 }),
      makeRect(86.02, 44.5, 86.021, 44.501, { parcelConfidence: 0.49 }),
      makeRect(86.03, 44.5, 86.031, 44.501, { parcelConfidence: 0.8 }),
    ];
    const { features, skipped, lowConfidence } = adoptRecognitionAsLabels({
      recognitionFeatures: recognition,
      existingLabels: existing,
      labelLayerId: 'layer-label',
    });

    expect(features).toHaveLength(3);
    expect(skipped).toBe(1);
    expect(lowConfidence).toBe(2);
  });

  it('ignores non-polygon geometries', () => {
    const point: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [86, 44.5] },
      properties: { id: 'p1' } as any,
    };
    const { features, skipped } = adoptRecognitionAsLabels({
      recognitionFeatures: [point],
      existingLabels: [],
      labelLayerId: 'layer-label',
    });

    expect(features).toHaveLength(0);
    expect(skipped).toBe(0);
  });
});
