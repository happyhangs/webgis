import { describe, expect, it } from 'vitest';
import { clipPolygonCoordinatesToBounds, polygonAreaSquareMeters } from '../geoBounds';

describe('geo bounds clipping', () => {
  it('clips a YOLO polygon to the selected rectangle', () => {
    const clipped = clipPolygonCoordinatesToBounds([[
      [0, 0], [3, 0], [3, 3], [0, 3], [0, 0],
    ]], { west: 1, south: 1, east: 2, north: 2 });

    expect(clipped).not.toBeNull();
    const ring = clipped?.[0] || [];
    expect(ring.length).toBeGreaterThanOrEqual(4);
    for (const [lng, lat] of ring) {
      expect(lng).toBeGreaterThanOrEqual(1);
      expect(lng).toBeLessThanOrEqual(2);
      expect(lat).toBeGreaterThanOrEqual(1);
      expect(lat).toBeLessThanOrEqual(2);
    }
    expect(polygonAreaSquareMeters(clipped!)).toBeGreaterThan(0);
  });

  it('drops polygons outside the selected rectangle', () => {
    const clipped = clipPolygonCoordinatesToBounds([[
      [0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0],
    ]], { west: 1, south: 1, east: 2, north: 2 });

    expect(clipped).toBeNull();
  });
});
