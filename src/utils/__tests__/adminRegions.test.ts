import { describe, expect, it } from 'vitest';
import { geometryBounds } from '../adminRegions';

describe('geometryBounds', () => {
  it('reads a nested administrative MultiPolygon', () => {
    expect(geometryBounds([[[[85, 44], [87, 44], [87, 46], [85, 44]]]])).toEqual({
      west: 85,
      south: 44,
      east: 87,
      north: 46,
    });
  });
});
