import type { GeoJSONFeature } from '../types';

export interface BuiltinLayerDef {
  key: string;
  name: string;
  path: string;
  color: string;
}

export const BUILTIN_LAYERS: BuiltinLayerDef[] = [
  { key: 'guojiexian', name: '国界线', path: '/data/国界线.json', color: '#e63946' },
  { key: 'sheng', name: '省界', path: '/data/省.json', color: '#e9c46a' },
  { key: 'jiuduanxian', name: '九段线', path: '/data/九段线.json', color: '#e76f51' },
];

function shapeTypeFromGeom(geomType: string): GeoJSONFeature['properties']['shapeType'] {
  switch (geomType) {
    case 'Point':
    case 'MultiPoint':
      return 'Marker';
    case 'LineString':
    case 'MultiLineString':
      return 'Line';
    default:
      return 'Polygon';
  }
}

export async function fetchBuiltinLayer(
  def: BuiltinLayerDef,
  layerId: string,
): Promise<GeoJSONFeature[]> {
  const resp = await fetch(def.path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items: any[] =
    data.type === 'FeatureCollection'
      ? data.features
      : Array.isArray(data)
        ? data
        : [data];

  return items
    .filter((f: any) => f?.geometry)
    .map((f: any, i: number) => ({
      ...f,
      properties: {
        id: crypto.randomUUID(),
        name:
          f.properties?.NAME ||
          f.properties?.name ||
          f.properties?.FULL_NAME ||
          `${def.name}_${i + 1}`,
        description: f.properties?.description || '',
        color: def.color,
        shapeType: shapeTypeFromGeom(f.geometry.type),
        layerId,
      },
    }));
}
