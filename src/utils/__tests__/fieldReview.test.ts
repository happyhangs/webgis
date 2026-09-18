import { describe, expect, it } from 'vitest';
import {
  confidenceLevel,
  featureConfidence,
  fieldSortLabel,
  nextReviewIndex,
  nextSortBy,
  sortFieldList,
} from '../fieldReview';
import type { GeoJSONFeature } from '../../types';

function makeFeature(id: string, props: Record<string, unknown> = {}): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: { id, name: `地块-${id}`, ...props } as any,
  };
}

const item = (id: string, areaMu: number, confidence?: number) => ({
  feature: makeFeature(id, confidence === undefined ? {} : { parcelConfidence: confidence }),
  areaMu,
});

describe('featureConfidence / confidenceLevel', () => {
  it('reads numeric confidence and clamps to 0..1', () => {
    expect(featureConfidence(makeFeature('a', { parcelConfidence: 0.38 }))).toBe(0.38);
    expect(featureConfidence(makeFeature('a', { parcelConfidence: 1.4 }))).toBe(1);
    expect(featureConfidence(makeFeature('a', { parcelConfidence: -0.2 }))).toBe(0);
  });

  it('returns null for hand-drawn labels without confidence', () => {
    expect(featureConfidence(makeFeature('a'))).toBeNull();
    expect(featureConfidence(makeFeature('a', { parcelConfidence: undefined }))).toBeNull();
  });

  it('grades confidence into low / mid / high', () => {
    expect(confidenceLevel(null)).toBeNull();
    expect(confidenceLevel(0.2)).toBe('low');
    expect(confidenceLevel(0.5)).toBe('mid');
    expect(confidenceLevel(0.69)).toBe('mid');
    expect(confidenceLevel(0.7)).toBe('high');
    expect(confidenceLevel(0.92)).toBe('high');
  });
});

describe('sortFieldList', () => {
  it('sorts by area descending', () => {
    const list = sortFieldList([item('a', 10), item('b', 50), item('c', 30)], 'area');
    expect(list.map((x) => x.feature.properties.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by confidence ascending, hand-drawn labels last', () => {
    const list = sortFieldList(
      [item('a', 10, 0.8), item('b', 20, 0.3), item('c', 30), item('d', 40, 0.55)],
      'confidence',
    );
    expect(list.map((x) => x.feature.properties.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('breaks confidence ties by larger area first', () => {
    const list = sortFieldList([item('a', 10, 0.3), item('b', 60, 0.3)], 'confidence');
    expect(list.map((x) => x.feature.properties.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [item('b', 1), item('a', 2)];
    const before = input.map((x) => x.feature.properties.id);
    sortFieldList(input, 'area');
    expect(input.map((x) => x.feature.properties.id)).toEqual(before);
  });
});

describe('sort button cycle', () => {
  it('cycles area → confidence → name → area', () => {
    expect(nextSortBy('area')).toBe('confidence');
    expect(nextSortBy('confidence')).toBe('name');
    expect(nextSortBy('name')).toBe('area');
  });

  it('labels the three modes', () => {
    expect(fieldSortLabel('area')).toBe('面积↓');
    expect(fieldSortLabel('confidence')).toBe('置信度↑');
    expect(fieldSortLabel('name')).toBe('名称');
  });
});

describe('nextReviewIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(nextReviewIndex(0, -1)).toBe(-1);
    expect(nextReviewIndex(0, 3)).toBe(-1);
  });

  it('advances to the next index', () => {
    expect(nextReviewIndex(5, 0)).toBe(1);
    expect(nextReviewIndex(5, 3)).toBe(4);
  });

  it('wraps to the first item at the end or with no selection', () => {
    expect(nextReviewIndex(5, 4)).toBe(0);
    expect(nextReviewIndex(5, -1)).toBe(0);
    expect(nextReviewIndex(5, 99)).toBe(0);
  });
});
