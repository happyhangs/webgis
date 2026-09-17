import { describe, expect, it } from 'vitest';
import { dedupeOverlappingParcels, planAmapTileGrid } from '../tileBatch';

describe('planAmapTileGrid', () => {
  it('returns a single tile for a small region', () => {
    // 约 160m x 220m 的小范围（小于单张 z16 瓦片的覆盖）
    const plan = planAmapTileGrid({ west: 85.9995, south: 44.4995, east: 86.0005, north: 44.5005 });
    expect(plan).not.toBeNull();
    expect(plan!.tiles.length).toBe(1);
    expect(plan!.zoom).toBe(16);
  });

  it('covers the whole region with grid tiles', () => {
    // 约 20km x 20km
    const region = { west: 85.8, south: 44.3, east: 86.2, north: 44.7 };
    const plan = planAmapTileGrid(region, { maxTiles: 64 });
    expect(plan).not.toBeNull();
    expect(plan!.tiles.length).toBeGreaterThan(1);
    expect(plan!.tiles.length).toBeLessThanOrEqual(64);
    // 所有瓦片范围都在区域内或与区域相交
    for (const tile of plan!.tiles) {
      expect(tile.bounds.west).toBeLessThan(region.east);
      expect(tile.bounds.east).toBeGreaterThan(region.west);
      expect(tile.bounds.south).toBeLessThan(region.north);
      expect(tile.bounds.north).toBeGreaterThan(region.south);
    }
    // 中心应在 WGS-84 的合理范围
    for (const tile of plan!.tiles) {
      const [lng, lat] = tile.center;
      expect(lng).toBeGreaterThan(85);
      expect(lng).toBeLessThan(87);
      expect(lat).toBeGreaterThan(43);
      expect(lat).toBeLessThan(46);
    }
  });

  it('drops zoom levels until tile count fits the cap', () => {
    const region = { west: 85.8, south: 44.3, east: 86.2, north: 44.7 };
    const highRes = planAmapTileGrid(region, { maxTiles: 400 });
    const limited = planAmapTileGrid(region, { maxTiles: 9 });
    expect(highRes).not.toBeNull();
    expect(limited).not.toBeNull();
    // 限制更紧时必须选择更低的缩放
    expect(limited!.zoom).toBeLessThan(highRes!.zoom);
    expect(limited!.tiles.length).toBeLessThanOrEqual(9);
  });

  it('returns null for absurdly large regions', () => {
    const plan = planAmapTileGrid(
      { west: 70, south: 20, east: 135, north: 50 },
      { maxTiles: 4, zoomPreference: [10, 9, 8] },
    );
    expect(plan).toBeNull();
  });

  it('returns null for degenerate regions', () => {
    expect(planAmapTileGrid({ west: 86, south: 44.5, east: 86, north: 44.5 })).toBeNull();
    expect(planAmapTileGrid({ west: 86.1, south: 44.5, east: 86.0, north: 44.6 })).toBeNull();
  });

  it('overlapping tiles are requested with padding beyond single-tile span', () => {
    const plan = planAmapTileGrid({ west: 85.9, south: 44.4, east: 86.1, north: 44.6 });
    expect(plan).not.toBeNull();
    if (plan!.tiles.length > 1) {
      // 相邻瓦片应有重叠：第二列瓦片 west 小于第一列瓦片 east
      const t0 = plan!.tiles[0];
      const t1 = plan!.tiles[1];
      if (Math.abs(t0.center[1] - t1.center[1]) < 1e-9) {
        expect(t1.bounds.west).toBeLessThan(t0.bounds.east);
      }
    }
  });
});

describe('dedupeOverlappingParcels', () => {
  const square = (lng: number, lat: number, size: number) => [[
    [lng, lat],
    [lng + size, lat],
    [lng + size, lat + size],
    [lng, lat + size],
    [lng, lat],
  ]];

  it('removes duplicate parcels detected on adjacent tiles, keeping the larger', () => {
    const full = { coordinates: square(86.0, 44.5, 0.001), areaSquareMeters: 5000, confidence: 0.6 };
    const partial = { coordinates: square(86.0, 44.5, 0.0009), areaSquareMeters: 4200, confidence: 0.75 };
    const other = { coordinates: square(86.01, 44.5, 0.001), areaSquareMeters: 5000, confidence: 0.6 };
    const result = dedupeOverlappingParcels([full, partial, other]);
    expect(result.length).toBe(2);
    // 保留面积更大的那个
    expect(result[0].areaSquareMeters).toBeGreaterThanOrEqual(4200);
  });

  it('keeps distinct adjacent parcels', () => {
    const a = { coordinates: square(86.0, 44.5, 0.001), areaSquareMeters: 5000, confidence: 0.6 };
    const b = { coordinates: square(86.002, 44.5, 0.001), areaSquareMeters: 5000, confidence: 0.6 };
    const result = dedupeOverlappingParcels([a, b]);
    expect(result.length).toBe(2);
  });

  it('keeps same-location parcels when area magnitudes differ greatly', () => {
    const big = { coordinates: square(86.0, 44.5, 0.01), areaSquareMeters: 500000, confidence: 0.6 };
    const tiny = { coordinates: square(86.0, 44.5, 0.0001), areaSquareMeters: 500, confidence: 0.7 };
    const result = dedupeOverlappingParcels([big, tiny]);
    expect(result.length).toBe(2);
  });

  it('is order-independent', () => {
    const full = { coordinates: square(86.0, 44.5, 0.001), areaSquareMeters: 5000, confidence: 0.6 };
    const partial = { coordinates: square(86.0, 44.5, 0.0009), areaSquareMeters: 4200, confidence: 0.75 };
    const r1 = dedupeOverlappingParcels([full, partial]);
    const r2 = dedupeOverlappingParcels([partial, full]);
    expect(r1.map((x) => x.areaSquareMeters)).toEqual(r2.map((x) => x.areaSquareMeters));
  });

  it('handles empty and degenerate inputs', () => {
    expect(dedupeOverlappingParcels([])).toEqual([]);
    const degenerate = { coordinates: [[]], areaSquareMeters: 100, confidence: 0.5 };
    expect(dedupeOverlappingParcels([degenerate]).length).toBe(1);
  });
});
