import { describe, expect, it } from 'vitest';
import { normalizeMapView } from '../store';

describe('normalizeMapView', () => {
  it('keeps a valid view unchanged', () => {
    const view = normalizeMapView({ center: [44.51, 86.05], zoom: 14 });
    expect(view).toEqual({ center: [44.51, 86.05], zoom: 14 });
  });

  it('corrects legacy swapped center written as [lng, lat]', () => {
    // 历史缺陷产物：中国境内视图的经纬被写反（85.03 在中国经度带且超北界）
    const view = normalizeMapView({ center: [85.0348, 44.5097], zoom: 11 });
    expect(view.center).toEqual([44.5097, 85.0348]);
  });

  it('corrects fully-invalid latitude by swapping', () => {
    const view = normalizeMapView({ center: [110.5, 44.5], zoom: 10 });
    expect(view.center).toEqual([44.5, 110.5]);
  });

  it('falls back to default for out-of-range values', () => {
    const view = normalizeMapView({ center: [95, 300], zoom: 10 });
    expect(view).toEqual({ center: [39.9042, 116.4074], zoom: 10 });
  });

  it('falls back to default for missing or malformed input', () => {
    expect(normalizeMapView(null)).toEqual({ center: [39.9042, 116.4074], zoom: 10 });
    expect(normalizeMapView({})).toEqual({ center: [39.9042, 116.4074], zoom: 10 });
    expect(normalizeMapView({ center: ['a', 'b'], zoom: 10 })).toEqual({ center: [39.9042, 116.4074], zoom: 10 });
    expect(normalizeMapView({ center: [44.5, 86.0], zoom: 'x' })).toEqual({ center: [39.9042, 116.4074], zoom: 10 });
  });

  it('clamps zoom into valid range', () => {
    expect(normalizeMapView({ center: [44.5, 86.0], zoom: 30 }).zoom).toBe(22);
    expect(normalizeMapView({ center: [44.5, 86.0], zoom: 0 }).zoom).toBe(1);
    expect(normalizeMapView({ center: [44.5, 86.0], zoom: 12.6 }).zoom).toBe(13);
  });

  it('does not touch a legitimately northern view outside the swap pattern', () => {
    // 北极圈附近（经度 100 超出中国纬度带）不应被"纠正"
    const view = normalizeMapView({ center: [70, 100], zoom: 6 });
    expect(view.center).toEqual([70, 100]);
  });
});
