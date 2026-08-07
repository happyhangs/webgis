import { describe, expect, it } from 'vitest';
import { fitAmapStaticToWgsBounds, normalizeAmapStaticZoom, staticAmapBoundsToWgs } from '../amapStatic';

describe('amap static georeference', () => {
  it('uses integer zoom supported by AMap static images', () => {
    expect(normalizeAmapStaticZoom(16.49)).toBe(16);
    expect(normalizeAmapStaticZoom(16.5)).toBe(17);
    expect(normalizeAmapStaticZoom(20)).toBe(17);
    expect(normalizeAmapStaticZoom(1)).toBe(3);
  });

  it('keeps the image bounds centered on the requested map center', () => {
    const bounds = staticAmapBoundsToWgs([116.397389, 39.908722], 16.4);
    const midLng = (bounds.west + bounds.east) / 2;
    const midLat = (bounds.south + bounds.north) / 2;

    expect(bounds.east).toBeGreaterThan(bounds.west);
    expect(bounds.north).toBeGreaterThan(bounds.south);
    expect(midLng).toBeCloseTo(116.391, 2);
    expect(midLat).toBeCloseTo(39.907, 2);
  });

  it('fits one static satellite image around existing label bounds', () => {
    const labels = { west: 86.06237, south: 44.33866, east: 86.08279, north: 44.35402 };
    const fit = fitAmapStaticToWgsBounds(labels);
    expect(fit.bounds.west).toBeLessThanOrEqual(labels.west);
    expect(fit.bounds.south).toBeLessThanOrEqual(labels.south);
    expect(fit.bounds.east).toBeGreaterThanOrEqual(labels.east);
    expect(fit.bounds.north).toBeGreaterThanOrEqual(labels.north);
    expect(fit.zoom).toBeGreaterThanOrEqual(3);
    expect(fit.zoom).toBeLessThanOrEqual(17);
  });

});
