import { describe, it, expect } from 'vitest';
import { exportGeoJSON, importGeoJSON } from '../geojson';

describe('geojson', () => {
  it('should import a FeatureCollection and export back', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [116.4074, 39.9042] },
        properties: { name: '北京' },
      }],
    };
    const features = importGeoJSON(JSON.stringify(fc));
    expect(features.length).toBe(1);
    expect(features[0].properties.name).toBe('北京');
  });

  it('should import a single Feature', () => {
    const feat = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.4, 39.9] },
      properties: {},
    };
    const features = importGeoJSON(JSON.stringify(feat));
    expect(features.length).toBe(1);
  });

  it('should export features as FeatureCollection', () => {
    const features = importGeoJSON(JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.4, 39.9] },
      properties: { name: 'test' },
    }));
    const exported = exportGeoJSON(features);
    const parsed = JSON.parse(exported);
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features.length).toBe(1);
  });

  it('should normalize FeatureCollection properties', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { name: 'test' },
      }],
    };
    const features = importGeoJSON(JSON.stringify(fc));
    expect(features[0].properties.shapeType).toBe('Polygon');
    expect(features[0].properties.color).toBeDefined();
  });
});
