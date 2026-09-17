import { describe, expect, it } from 'vitest';
import { clipPolygonCoordinatesToBounds, mergeFeaturesBounds, polygonAreaSquareMeters } from '../geoBounds';

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

describe('mergeFeaturesBounds', () => {
  it('merges bounds across features and geometry types', () => {
    const bounds = mergeFeaturesBounds([
      { geometry: { type: 'Point', coordinates: [87.5, 46.2] } },
      { geometry: { type: 'Polygon', coordinates: [[[86.9, 45.8], [87.1, 45.8], [87.1, 46.0], [86.9, 46.0], [86.9, 45.8]]] } },
      { geometry: { type: 'MultiPolygon', coordinates: [[[[88.0, 46.5], [88.2, 46.5], [88.2, 46.7], [88.0, 46.7], [88.0, 46.5]]]] } },
    ]);
    expect(bounds).toEqual({ west: 86.9, south: 45.8, east: 88.2, north: 46.7 });
  });

  it('returns null when no valid coordinates exist', () => {
    expect(mergeFeaturesBounds([])).toBeNull();
    expect(mergeFeaturesBounds([{ geometry: { type: 'Point', coordinates: [999, 999] } }])).toBeNull();
    expect(mergeFeaturesBounds([{}])).toBeNull();
  });

  it('rejects antimeridian-spanning outlier data', () => {
    const bounds = mergeFeaturesBounds([
      { geometry: { type: 'Point', coordinates: [87.0, 46.0] } },
      { geometry: { type: 'Point', coordinates: [-170, 20] } },
    ]);
    expect(bounds).toBeNull();
  });
});
