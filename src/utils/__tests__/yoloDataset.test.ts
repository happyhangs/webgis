import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { readGeoTiffBounds } from '../yoloDataset';

describe('readGeoTiffBounds', () => {
  it('reads WGS84 bounds without a network request', async () => {
    const buffer = writeArrayBuffer(new Uint8Array(4), {
      width: 2,
      height: 2,
      ModelPixelScale: [0.1, 0.1, 0],
      ModelTiepoint: [0, 0, 0, 85, 45, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
    });
    const file = new File([buffer], 'field.tif');

    await expect(readGeoTiffBounds(file)).resolves.toEqual({
      west: 85,
      south: 44.8,
      east: 85.2,
      north: 45,
    });
  });
});
