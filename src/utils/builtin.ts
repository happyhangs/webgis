import type { GeoJSONFeature } from '../types';
import { getDefaultFeatureStyle } from './featureStyle';

export interface BuiltinLayerDef {
  key: string;
  name: string;
  path: string;
  color: string;
  category: string;
  size: string;
}

export const BUILTIN_CATEGORIES: { key: string; label: string }[] = [
  { key: '省级', label: '省级' },
  { key: '地级市', label: '地级市' },
];

export const BUILTIN_LAYERS: BuiltinLayerDef[] = [
  { key: 'beijing', name: '北京市', path: '/data/北京市.json', color: '#e76f51', category: '省级', size: '1 KB' },
  { key: 'shanghai', name: '上海市', path: '/data/上海市.json', color: '#4572b9', category: '省级', size: '1 KB' },
  { key: 'guangzhou', name: '广州市', path: '/data/广州市.json', color: '#5fb85f', category: '地级市', size: '1 KB' },
  { key: 'chengdu', name: '成都市', path: '/data/成都市.json', color: '#d99a20', category: '地级市', size: '1 KB' },
  { key: 'wuhan', name: '武汉市', path: '/data/武汉市.json', color: '#8b5cf6', category: '地级市', size: '1 KB' },
  { key: 'xian', name: '西安市', path: '/data/西安市.json', color: '#e63946', category: '地级市', size: '1 KB' },
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
        ...getDefaultFeatureStyle(shapeTypeFromGeom(f.geometry.type), def.color),
        shapeType: shapeTypeFromGeom(f.geometry.type),
        layerId,
      },
    }));
}
