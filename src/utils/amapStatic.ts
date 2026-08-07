import { gcj2wgs, wgs2gcj } from './coord';

export const AMAP_STATIC_SIZE = 640;
export const WEB_MERCATOR_TILE_SIZE = 256;

export interface StaticBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface StaticMapFit {
  amapCenter: [number, number];
  zoom: number;
  bounds: StaticBounds;
}

export function fitAmapStaticToWgsBounds(bounds: StaticBounds): StaticMapFit {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLng = (bounds.west + bounds.east) / 2;
  const [gcjLat, gcjLng] = wgs2gcj(centerLat, centerLng);
  const amapCenter: [number, number] = [gcjLng, gcjLat];
  for (let zoom = 17; zoom >= 3; zoom -= 1) {
    const candidate = staticAmapBoundsToWgs(amapCenter, zoom);
    if (
      candidate.west <= bounds.west && candidate.south <= bounds.south &&
      candidate.east >= bounds.east && candidate.north >= bounds.north
    ) {
      return { amapCenter, zoom, bounds: candidate };
    }
  }
  return { amapCenter, zoom: 3, bounds: staticAmapBoundsToWgs(amapCenter, 3) };
}

export function normalizeAmapStaticZoom(zoom: number): number {
  const value = Number.isFinite(zoom) ? Math.round(zoom) : 15;
  return Math.max(3, Math.min(17, value));
}

export function staticAmapBoundsToWgs(
  amapCenter: [number, number],
  zoom: number,
  width = AMAP_STATIC_SIZE,
  height = AMAP_STATIC_SIZE,
): StaticBounds {
  const safeZoom = normalizeAmapStaticZoom(zoom);
  const scale = WEB_MERCATOR_TILE_SIZE * Math.pow(2, safeZoom);
  const center = lngLatToWorldPixel(amapCenter[0], amapCenter[1], scale);
  const westX = center.x - width / 2;
  const eastX = center.x + width / 2;
  const northY = center.y - height / 2;
  const southY = center.y + height / 2;
  const gcjCorners = [
    worldPixelToLngLat(westX, southY, scale),
    worldPixelToLngLat(westX, northY, scale),
    worldPixelToLngLat(eastX, northY, scale),
    worldPixelToLngLat(eastX, southY, scale),
  ];
  const corners = gcjCorners.map(([lng, lat]) => gcj2wgs(lat, lng));
  const lngs = corners.map(([, lng]) => lng);
  const lats = corners.map(([lat]) => lat);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

export function lngLatToWorldPixel(lng: number, lat: number, scale: number): { x: number; y: number } {
  const sinLat = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldPixelToLngLat(x: number, y: number, scale: number): [number, number] {
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}
