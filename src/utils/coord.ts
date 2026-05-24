// WGS-84 ↔ GCJ-02 ↔ BD-09 coordinate conversion
// Based on https://github.com/wandergis/coordtransform

const PI = Math.PI;
const X_PI = (PI * 3000.0) / 180.0;
const A = 6378245.0; // semi-major axis
const EE = 0.00669342162296594323; // eccentricity squared

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/** WGS-84 → GCJ-02 */
export function wgs2gcj(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lat + dLat, lng + dLng];
}

/** GCJ-02 → WGS-84 */
export function gcj2wgs(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];
  const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
  return [lat * 2 - gcjLat, lng * 2 - gcjLng];
}

/** GCJ-02 → BD-09 */
export function gcj2bd(lat: number, lng: number): [number, number] {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return [z * Math.sin(theta) + 0.006, z * Math.cos(theta) + 0.0065];
}

/** BD-09 → GCJ-02 */
export function bd2gcj(lat: number, lng: number): [number, number] {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return [z * Math.sin(theta), z * Math.cos(theta)];
}

/** BD-09 → WGS-84 */
export function bd2wgs(lat: number, lng: number): [number, number] {
  const [gcjLat, gcjLng] = bd2gcj(lat, lng);
  return gcj2wgs(gcjLat, gcjLng);
}

/** WGS-84 → BD-09 */
export function wgs2bd(lat: number, lng: number): [number, number] {
  const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
  return gcj2bd(gcjLat, gcjLng);
}

export type CoordSystem = 'wgs84' | 'gcj02' | 'bd09';

function convertCoord(lat: number, lng: number, from: CoordSystem): [number, number] {
  if (from === 'gcj02') return gcj2wgs(lat, lng);
  if (from === 'bd09') return bd2wgs(lat, lng);
  return [lat, lng];
}

/** Convert all coords from WGS-84 to GCJ-02 for Amap display */
export function applyGCJOffset(feature: any): any {
  const f = { ...feature, geometry: { ...feature.geometry } };
  const convertPt = (c: number[]) => {
    const [lat, lng] = wgs2gcj(c[1], c[0]);
    return [lng, lat];
  };
  if (f.geometry.type === 'Point') {
    f.geometry.coordinates = convertPt(f.geometry.coordinates);
  } else if (f.geometry.type === 'MultiPoint' || f.geometry.type === 'LineString') {
    f.geometry.coordinates = f.geometry.coordinates.map(convertPt);
  } else if (f.geometry.type === 'MultiLineString' || f.geometry.type === 'Polygon') {
    f.geometry.coordinates = f.geometry.coordinates.map((ring: any) => ring.map(convertPt));
  } else if (f.geometry.type === 'MultiPolygon') {
    f.geometry.coordinates = f.geometry.coordinates.map((poly: any) =>
      poly.map((ring: any) => ring.map(convertPt)),
    );
  }
  return f;
}

/** Convert all coordinates in a GeoJSON feature from source CS to WGS-84 */
export function convertFeatureCoords(feature: any, from: CoordSystem): any {
  if (from === 'wgs84') return feature; // no conversion needed
  const f = { ...feature, geometry: { ...feature.geometry } };

  const convertPt = (c: number[]) => {
    const [lat, lng] = convertCoord(c[1], c[0], from);
    return [lng, lat];
  };

  if (f.geometry.type === 'Point') {
    f.geometry.coordinates = convertPt(f.geometry.coordinates);
  } else if (f.geometry.type === 'MultiPoint' || f.geometry.type === 'LineString') {
    f.geometry.coordinates = f.geometry.coordinates.map(convertPt);
  } else if (f.geometry.type === 'MultiLineString' || f.geometry.type === 'Polygon') {
    f.geometry.coordinates = f.geometry.coordinates.map((ring: any) => ring.map(convertPt));
  } else if (f.geometry.type === 'MultiPolygon') {
    f.geometry.coordinates = f.geometry.coordinates.map((poly: any) =>
      poly.map((ring: any) => ring.map(convertPt)),
    );
  }
  return f;
}
