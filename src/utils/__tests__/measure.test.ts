import { describe, it, expect } from 'vitest';
import { formatDistance, formatArea, getFeatureMeasurement } from '../measure';
import type { GeoJSONFeature } from '../../types';

describe('measure', () => {
  it('should format distance in meters', () => {
    const result = formatDistance(1234.5);
    expect(result).toContain('1.23');
    expect(result).toContain('km');
  });

  it('should format distance in meters for short distances', () => {
    const result = formatDistance(500);
    expect(result).toContain('500');
    expect(result).toContain('m');
  });

  it('should format area', () => {
    const result = formatArea(15000);
    // formatArea returns m² for values under 1e6 m²
    expect(result).toContain('m²');
    expect(typeof result).toBe('string');
  });

  it('should return measurement for a line feature', () => {
    const feature: GeoJSONFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[116.4, 39.9], [116.41, 39.91]],
      },
      properties: {
        id: '1', name: 'test', description: '',
        color: '#000', fillColor: '#000', fillEnabled: false,
        strokeStyle: 'solid', strokeWidth: 2,
        shapeType: 'Line', layerId: 'default',
      },
    };
    const measurement = getFeatureMeasurement(feature);
    expect(measurement).toBeTruthy();
  });

  it('should return null for Marker', () => {
    const feature: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.4, 39.9] },
      properties: {
        id: '1', name: 'test', description: '',
        color: '#000', fillColor: '#000', fillEnabled: false,
        strokeStyle: 'solid', strokeWidth: 2,
        shapeType: 'Marker', layerId: 'default',
      },
    };
    expect(getFeatureMeasurement(feature)).toBeNull();
  });
});
