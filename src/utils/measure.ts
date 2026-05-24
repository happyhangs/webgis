import area from '@turf/area';
import length from '@turf/length';
import { GeoJSONFeature } from '../types';

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

export function formatArea(squareMeters: number): string {
  if (squareMeters >= 1000000) return `${(squareMeters / 1000000).toFixed(2)} km²`;
  return `${squareMeters.toFixed(1)} m²`;
}

export function getFeatureMeasurement(feature: GeoJSONFeature): string | null {
  try {
    if (feature.properties.shapeType === 'Line') {
      const m = length(feature, { units: 'meters' });
      return `长度: ${formatDistance(m)}`;
    }
    if (
      feature.properties.shapeType === 'Polygon' ||
      feature.properties.shapeType === 'Rectangle'
    ) {
      const a = area(feature);
      return `面积: ${formatArea(a)}`;
    }
  } catch {
    return null;
  }
  return null;
}
