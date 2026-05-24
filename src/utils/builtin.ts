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
  { key: '国界', label: '国界' },
  { key: '行政区划', label: '行政区划' },
  { key: '交通', label: '交通' },
  { key: '水系', label: '水系' },
];

export const BUILTIN_LAYERS: BuiltinLayerDef[] = [
  // ── 国界 ──
  { key: 'guojiexian', name: '国界线', path: '/data/国界线.json', color: '#e63946', category: '国界', size: '2.8 MB' },
  { key: 'nanhaizhudao', name: '南海诸岛', path: '/data/南海诸岛.json', color: '#e76f51', category: '国界', size: '65 KB' },
  { key: 'nanhaijdx', name: '南海九段线', path: '/data/南海九段线.json', color: '#e76f51', category: '国界', size: '9 KB' },
  { key: 'nanhaibj', name: '南海边界', path: '/data/南海边界.json', color: '#e63946', category: '国界', size: '612 KB' },

  // ── 行政区划 ──
  { key: 'sheng', name: '省界', path: '/data/省界.json', color: '#e9c46a', category: '行政区划', size: '30 MB' },
  { key: 'shi', name: '市界', path: '/data/市界.json', color: '#f4a261', category: '行政区划', size: '73 MB' },
  { key: 'xian', name: '县界', path: '/data/县界.json', color: '#90be6d', category: '行政区划', size: '160 MB' },
  { key: 'jiuduanxian', name: '九段线', path: '/data/九段线.json', color: '#e76f51', category: '行政区划', size: '10 KB' },
  { key: 'quxian2105', name: '区县(2021-05)', path: '/data/区县(2021-05).json', color: '#577590', category: '行政区划', size: '93 MB' },

  // ── 交通 ──
  { key: 'tielu', name: '铁路', path: '/data/铁路.json', color: '#333333', category: '交通', size: '32 MB' },
  { key: 'gaosu', name: '高速', path: '/data/高速.json', color: '#e63946', category: '交通', size: '156 MB' },
  { key: 'guodao', name: '国道', path: '/data/国道.json', color: '#f4a261', category: '交通', size: '110 MB' },
  { key: 'shengdao', name: '省道', path: '/data/省道.json', color: '#e9c46a', category: '交通', size: '237 MB' },

  // ── 水系 ──
  { key: 'river1l', name: '一级河流(线)', path: '/data/一级河流(线).json', color: '#457b9d', category: '水系', size: '2.9 MB' },
  { key: 'river1p', name: '一级河流(面)', path: '/data/一级河流(面).json', color: '#a8dadc', category: '水系', size: '2.3 MB' },
  { key: 'river2l', name: '二级河流(线)', path: '/data/二级河流(线).json', color: '#457b9d', category: '水系', size: '5.9 MB' },
  { key: 'river2p', name: '二级河流(面)', path: '/data/二级河流(面).json', color: '#a8dadc', category: '水系', size: '3.7 MB' },
  { key: 'river4', name: '四级河流', path: '/data/四级河流.json', color: '#1d3557', category: '水系', size: '4.1 MB' },
  { key: 'river5', name: '五级河流', path: '/data/五级河流.json', color: '#1d3557', category: '水系', size: '10.7 MB' },
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
