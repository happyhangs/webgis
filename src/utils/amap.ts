import { gcj2wgs, wgs2gcj } from './coord';

const KEY = 'fcfdf69df521f74f022e6cc53cb1d8b9';
const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/;

export interface AmapGeocodeResult {
  lat: number;
  lng: number;
  name: string;
}

export interface AmapRoutePoint {
  input: string;
  name: string;
  wgsLat: number;
  wgsLng: number;
  amapLat: number;
  amapLng: number;
}

export interface AmapDrivingRoute {
  distance: number;
  duration: number;
  points: [number, number][];
  steps: AmapRouteStep[];
}

export interface AmapRouteStep {
  instruction: string;
  road: string;
  distance: number;
  duration: number;
}

export async function geocodeAmap(address: string): Promise<AmapGeocodeResult | null> {
  const resp = await fetch(
    `https://restapi.amap.com/v3/geocode/geo?key=${KEY}&address=${encodeURIComponent(address)}`,
  );
  const data = await resp.json();
  if (data.status !== '1' || !data.geocodes?.length) return null;
  const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
  return { lat, lng, name: data.geocodes[0].formatted_address || address };
}

export async function resolveAmapRoutePoint(input: string): Promise<AmapRoutePoint | null> {
  const q = input.trim();
  if (!q) return null;

  const coord = parseCoordinate(q);
  if (coord) {
    const [amapLat, amapLng] = wgs2gcj(coord.lat, coord.lng);
    return {
      input: q,
      name: `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`,
      wgsLat: coord.lat,
      wgsLng: coord.lng,
      amapLat,
      amapLng,
    };
  }

  const geocoded = await geocodeAmap(q);
  if (!geocoded) return null;
  const [wgsLat, wgsLng] = gcj2wgs(geocoded.lat, geocoded.lng);
  return {
    input: q,
    name: geocoded.name,
    wgsLat,
    wgsLng,
    amapLat: geocoded.lat,
    amapLng: geocoded.lng,
  };
}

export async function planDrivingRouteAmap(
  origin: AmapRoutePoint,
  destination: AmapRoutePoint,
): Promise<AmapDrivingRoute> {
  const params = new URLSearchParams({
    key: KEY,
    origin: formatAmapCoord(origin.amapLat, origin.amapLng),
    destination: formatAmapCoord(destination.amapLat, destination.amapLng),
    extensions: 'all',
    output: 'JSON',
  });

  const resp = await fetch(`https://restapi.amap.com/v3/direction/driving?${params.toString()}`);
  const data = await resp.json();
  if (data.status !== '1') {
    throw new Error(data.info || '高德路径规划失败');
  }

  const path = data.route?.paths?.[0];
  if (!path) {
    throw new Error('未找到可用路线');
  }

  const pointsGcj = collectPolylinePoints(path);
  if (pointsGcj.length < 2) {
    throw new Error('路线返回结果中没有有效轨迹');
  }

  return {
    distance: Number(path.distance || 0),
    duration: Number(path.duration || 0),
    points: pointsGcj.map(([lng, lat]) => {
      const [wgsLat, wgsLng] = gcj2wgs(lat, lng);
      return [wgsLng, wgsLat];
    }),
    steps: Array.isArray(path.steps)
      ? path.steps.map((step: any) => ({
          instruction: stripHtml(step.instruction || ''),
          road: step.road || '',
          distance: Number(step.distance || 0),
          duration: Number(step.duration || 0),
        }))
      : [],
  };
}

export function formatRouteDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '未知距离';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
}

export function formatRouteDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '未知耗时';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function parseCoordinate(input: string): { lat: number; lng: number } | null {
  const match = input.match(COORD_PATTERN);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function formatAmapCoord(lat: number, lng: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

function collectPolylinePoints(path: any): [number, number][] {
  const points: [number, number][] = [];
  const pushPolyline = (polyline: unknown) => {
    if (typeof polyline !== 'string') return;
    for (const pair of polyline.split(';')) {
      const [lngText, latText] = pair.split(',');
      const lng = Number(lngText);
      const lat = Number(latText);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const prev = points[points.length - 1];
      if (prev && prev[0] === lng && prev[1] === lat) continue;
      points.push([lng, lat]);
    }
  };

  if (Array.isArray(path.steps)) {
    for (const step of path.steps) pushPolyline(step.polyline);
  }

  if (points.length === 0) pushPolyline(path.polyline);
  return points;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}
