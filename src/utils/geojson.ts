import { GeoJSONFeature } from '../types';

export function exportGeoJSON(features: GeoJSONFeature[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

export function importGeoJSON(raw: string): GeoJSONFeature[] {
  const data = JSON.parse(raw);
  const items: any[] =
    data.type === 'FeatureCollection'
      ? data.features
      : Array.isArray(data)
        ? data
        : [data];

  return items
    .filter((f: any) => f?.type === 'Feature' && f.geometry)
    .map((f: any, i: number) => {
      const geomType: string = f.geometry.type;
      let shapeType: GeoJSONFeature['properties']['shapeType'];

      if (geomType === 'Point' || geomType === 'MultiPoint') {
        shapeType = 'Marker';
      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        shapeType = 'Line';
      } else {
        shapeType = 'Polygon';
      }

      const defaultName =
        shapeType === 'Marker'
          ? `导入点 ${i + 1}`
          : shapeType === 'Line'
            ? `导入线 ${i + 1}`
            : `导入面 ${i + 1}`;

      return {
        ...f,
        properties: {
          id: f.properties?.id || crypto.randomUUID(),
          name: f.properties?.name || defaultName,
          description: f.properties?.description || '',
          color: f.properties?.color || '#3388ff',
          shapeType,
          layerId: f.properties?.layerId || '__default__',
        },
      };
    });
}
