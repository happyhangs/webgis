import { describe, expect, it } from 'vitest';
import {
  formatLabelCode,
  planLabelUpdates,
  computeAreaProps,
  maxTrainingLabelIndex,
} from '../labelTools';
import type { GeoJSONFeature } from '../../types';

function makeFeature(
  id: string,
  props: Partial<GeoJSONFeature['properties']> = {},
  coords?: number[][],
): GeoJSONFeature {
  const ring = coords || [
    [86.0, 44.5],
    [86.001, 44.5],
    [86.001, 44.501],
    [86.0, 44.501],
    [86.0, 44.5],
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id,
      name: `要素-${id}`,
      description: '',
      color: '#3388ff',
      fillColor: '#3388ff',
      fillEnabled: true,
      strokeStyle: 'solid',
      strokeWidth: 2,
      shapeType: 'Polygon',
      layerId: 'L1',
      ...props,
    },
  };
}

function labelFeature(id: string, index: number): GeoJSONFeature {
  const code = formatLabelCode(index);
  return makeFeature(id, {
    parcelCode: code,
    parcelIndex: index,
    parcelGroup: '人工标定',
    parcelRole: 'parcel',
    source: 'manual-farmland-label',
    parcelAreaMu: 10,
    parcelAreaSquareMeters: 6666.67,
    name: `农田标定-${code}`,
  });
}

describe('formatLabelCode', () => {
  it('pads to three digits', () => {
    expect(formatLabelCode(7)).toBe('MAN-007');
    expect(formatLabelCode(85)).toBe('MAN-085');
    expect(formatLabelCode(1234)).toBe('MAN-1234');
  });
});

describe('planLabelUpdates', () => {
  it('returns nothing when all labels are complete', () => {
    const features = [labelFeature('a', 1), labelFeature('b', 2)];
    expect(planLabelUpdates(features)).toEqual([]);
  });

  it('numbers a new drawn block right after the current maximum', () => {
    const features = [labelFeature('a', 1), labelFeature('b', 2)];
    const fresh = makeFeature('new', { source: 'manual-farmland-label', parcelRole: 'parcel' });
    const updates = planLabelUpdates([...features, fresh]);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('new');
    expect(updates[0].updates.parcelCode).toBe('MAN-003');
    expect(updates[0].updates.parcelIndex).toBe(3);
    expect(updates[0].updates.name).toBe('农田标定-MAN-003');
    expect(updates[0].updates.parcelRole).toBe('parcel');
    expect(updates[0].updates.source).toBe('manual-farmland-label');
    expect(updates[0].updates.parcelAreaMu).toBeGreaterThan(0);
    expect(updates[0].updates.parcelAreaSquareMeters).toBeGreaterThan(0);
  });

  it('numbers several new blocks sequentially without gaps', () => {
    const features = [labelFeature('a', 1), makeFeature('n1'), makeFeature('n2')];
    const updates = planLabelUpdates(features);
    expect(updates.map((u) => u.updates.parcelCode)).toEqual(['MAN-002', 'MAN-003']);
  });

  it('never renumbers an existing code even when array order changes', () => {
    const features = [labelFeature('b', 2), labelFeature('a', 1)];
    expect(planLabelUpdates(features)).toEqual([]);
  });

  it('derives the next index from codes when parcelIndex is missing', () => {
    const weird = makeFeature('weird', {
      parcelCode: 'MAN-090',
      parcelRole: 'parcel',
      source: 'manual-farmland-label',
      parcelAreaMu: 5,
      parcelAreaSquareMeters: 3333.3,
    });
    const updates = planLabelUpdates([labelFeature('a', 1), weird, makeFeature('new')]);
    expect(updates).toHaveLength(1);
    expect(updates[0].updates.parcelCode).toBe('MAN-091');
  });

  it('skips over taken numbers instead of duplicating them', () => {
    // 0001~0003 存在，但 maxIndex 声称为 1（历史脏数据）→ 新块不能撞 002/003
    const features = [
      labelFeature('a', 1),
      makeFeature('b', {
        parcelCode: 'MAN-002',
        parcelIndex: 2,
        parcelRole: 'parcel',
        source: 'manual-farmland-label',
        parcelAreaMu: 5,
        parcelAreaSquareMeters: 3333.3,
      }),
      makeFeature('c', {
        parcelCode: 'MAN-003',
        parcelIndex: 3,
        parcelRole: 'parcel',
        source: 'manual-farmland-label',
        parcelAreaMu: 5,
        parcelAreaSquareMeters: 3333.3,
      }),
      makeFeature('new'),
    ];
    const updates = planLabelUpdates(features);
    expect(updates).toHaveLength(1);
    expect(updates[0].updates.parcelCode).toBe('MAN-004');
  });

  it('only fills area for coded blocks missing it (keeps code untouched)', () => {
    const coded = makeFeature('coded', {
      parcelCode: 'MAN-010',
      parcelIndex: 10,
      parcelRole: 'parcel',
      source: 'manual-farmland-label',
    });
    const updates = planLabelUpdates([coded]);
    expect(updates).toHaveLength(1);
    expect(updates[0].updates.parcelCode).toBeUndefined();
    expect(updates[0].updates.name).toBeUndefined();
    expect(updates[0].updates.parcelAreaMu).toBeGreaterThan(0);
  });

  it('does not overwrite an existing numeric area', () => {
    const coded = makeFeature('coded', {
      parcelCode: 'MAN-010',
      parcelIndex: 10,
      parcelRole: 'parcel',
      source: 'manual-farmland-label',
      parcelAreaMu: 123,
      parcelAreaSquareMeters: 82000,
    });
    expect(planLabelUpdates([coded])).toEqual([]);
  });

  it('handles degenerate geometry without crashing', () => {
    const degenerate = makeFeature('deg', {}, [
      [86.0, 44.5],
      [86.0, 44.5],
      [86.0, 44.5],
      [86.0, 44.5],
    ]);
    const updates = planLabelUpdates([degenerate]);
    expect(updates).toHaveLength(1);
    expect(updates[0].updates.parcelCode).toBe('MAN-001');
    expect(updates[0].updates.parcelAreaMu).toBeUndefined();
  });
});

describe('computeAreaProps', () => {
  it('computes mu from square meters', () => {
    const props = computeAreaProps(makeFeature('f'));
    expect(props.parcelAreaSquareMeters).toBeGreaterThan(0);
    expect(props.parcelAreaMu).toBeCloseTo(props.parcelAreaSquareMeters! / 666.667, 1);
  });
});

describe('maxTrainingLabelIndex', () => {
  it('returns 0 when no training codes exist', () => {
    expect(maxTrainingLabelIndex([])).toBe(0);
    expect(maxTrainingLabelIndex([makeFeature('a', { parcelCode: 'MAN-007' })])).toBe(0);
  });

  it('finds the highest training code regardless of order or gaps', () => {
    const features = [
      makeFeature('a', { parcelCode: '训练标注-12' }),
      makeFeature('b', { parcelCode: 'MAN-061' }),
      makeFeature('c', { parcelCode: '训练标注-5' }),
      makeFeature('d', { parcelCode: '训练标注-30' }),
    ];
    expect(maxTrainingLabelIndex(features)).toBe(30);
  });

  it('ignores malformed or partial codes', () => {
    const features = [
      makeFeature('a', { parcelCode: '训练标注-' }),
      makeFeature('b', { parcelCode: '训练标注-abc' }),
      makeFeature('c', { parcelCode: '训练标注-9x' }),
      makeFeature('d', { parcelCode: '训练标注-4' }),
    ];
    expect(maxTrainingLabelIndex(features)).toBe(4);
  });
});
