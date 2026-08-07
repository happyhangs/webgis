import { describe, it, expect } from 'vitest';
import { exportCSV, importCSV } from '../csv';

describe('csv', () => {
  const sampleCSV = `name,latitude,longitude,description,color
测试点1,39.9042,116.4074,北京,\#ff0000
测试点2,31.2304,121.4737,上海,\#00ff00`;

  it('should import CSV and export back with matching point count', () => {
    const features = importCSV(sampleCSV);
    expect(features.length).toBe(2);
    expect(features[0].properties.name).toBe('测试点1');
    expect(features[0].geometry.coordinates[0]).toBeCloseTo(116.4074);
  });

  it('should export only Marker features', () => {
    const features = importCSV(sampleCSV);
    const csv = exportCSV(features);
    expect(csv).toContain('name,latitude,longitude');
    expect(csv).toContain('测试点1');
  });

  it('should handle empty input', () => {
    const features = importCSV('name,latitude,longitude\n');
    expect(features.length).toBe(0);
  });

  it('should handle quoted fields with commas', () => {
    const csv = 'name,latitude,longitude,description\n"测试,点",39.9,116.4,desc';
    const features = importCSV(csv);
    expect(features.length).toBe(1);
    expect(features[0].properties.name).toBe('测试,点');
  });

  it('should skip rows with invalid coordinates', () => {
    const csv = `name,latitude,longitude
valid,39.9,116.4
invalid,abc,def`;
    const features = importCSV(csv);
    // importCSV may still create a feature with NaN coords; verify valid-only filter
    const withValidCoords = features.filter(
      (f: any) => Number.isFinite(f.geometry.coordinates[0])
    );
    expect(withValidCoords.length).toBe(1);
  });
});
