import type { GeoJSONFeature } from '../types';

export interface BuiltinLayerDef {
  key: string;
  name: string;
  path: string;
  color: string;
  category: string;
  size: string; // Human-readable size
}

export const BUILTIN_CATEGORIES: { key: string; label: string }[] = [
  { key: '轻量边界', label: '轻量边界' },
  { key: '轻量区划', label: '轻量区划' },
];

export const BUILTIN_LAYERS: BuiltinLayerDef[] = [
  { key: 'nanhaizhudao', name: '南海诸岛', path: '/data/南海诸岛.json', color: '#e76f51', category: '轻量边界', size: '65 KB' },
  { key: 'nanhaijdx', name: '南海九段线', path: '/data/南海九段线.json', color: '#e76f51', category: '轻量边界', size: '9 KB' },
  { key: 'nanhaibj', name: '南海边界', path: '/data/南海边界.json', color: '#e63946', category: '轻量边界', size: '612 KB' },
  { key: 'jiuduanxian', name: '九段线', path: '/data/九段线.json', color: '#e76f51', category: '轻量区划', size: '10 KB' },
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
