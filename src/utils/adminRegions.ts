import type { Bounds } from './yoloDataset';

type AdminFileEntry = { file?: string | null };

export type AdminIndexEntry = AdminFileEntry & {
  cities?: string[] | Record<string, AdminFileEntry>;
};

export type AdminIndex = Record<string, AdminIndexEntry>;

export interface AdminRegion {
  id: string;
  name: string;
  bounds: Bounds;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export async function loadAdminIndex(): Promise<AdminIndex> {
  const response = await fetch('/data/counties/_index_county.json');
  if (!response.ok) throw new Error(`行政区索引加载失败（HTTP ${response.status}）`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('行政区索引格式错误');
  return value as AdminIndex;
}

export function adminCityNames(entry: AdminIndexEntry | undefined): string[] {
  if (Array.isArray(entry?.cities)) return entry.cities;
  return entry?.cities && typeof entry.cities === 'object' ? Object.keys(entry.cities) : [];
}

export async function loadAdminRegions(index: AdminIndex, province: string, city: string): Promise<AdminRegion[]> {
  const entry = index[province];
  const cityEntry = entry?.cities && !Array.isArray(entry.cities) ? entry.cities[city] : null;
  const file = cityEntry?.file || entry?.file;
  if (!file || !/^[^/\\]+\.json$/i.test(file)) throw new Error('未找到该行政区的数据文件');

  const response = await fetch(`/data/counties/${encodeURIComponent(file)}`);
  if (!response.ok) throw new Error(`行政区数据加载失败（HTTP ${response.status}）`);
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('行政区数据格式错误');

  return data.features.flatMap((feature: any, position: number) => {
    const geometry = feature?.geometry;
    const properties = feature?.properties || {};
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
    if (properties['市'] && String(properties['市']) !== city) return [];
    const bounds = geometryBounds(geometry.coordinates);
    if (!bounds) return [];
    const name = String(properties['县'] || properties['市'] || properties.NAME || `${city} ${position + 1}`);
    const code = String(properties['县代码'] || properties['市代码'] || position);
    return [{ id: `${province}/${city}/${code}`, name, bounds, geometry } as AdminRegion];
  });
}

export function geometryBounds(coordinates: unknown): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const lng = value[0];
      const lat = value[1];
      if (Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
      }
      return;
    }
    value.forEach(visit);
  };

  visit(coordinates);
  return west < east && south < north ? { west, south, east, north } : null;
}
