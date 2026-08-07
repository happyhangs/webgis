import area from '@turf/area';
import type { ViewBounds } from './mapAPI';

type Point = [number, number];
type Edge = 'west' | 'east' | 'south' | 'north';

export function clipPolygonCoordinatesToBounds(
  coordinates: unknown,
  bounds: ViewBounds,
): number[][][] | null {
  if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return null;

  // ponytail: YOLO masks are exterior rings; add hole support if model output starts using holes.
  const ring = normalizeRing(coordinates[0]);
  const clipped = clipRingToBounds(ring, bounds);
  return clipped.length >= 4 ? [clipped] : null;
}

export function polygonAreaSquareMeters(coordinates: number[][][]): number {
  return area({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates },
    properties: {},
  });
}

function clipRingToBounds(ring: Point[], bounds: ViewBounds): Point[] {
  let output = ring;
  for (const edge of ['west', 'east', 'south', 'north'] as const) {
    output = clipEdge(output, bounds, edge);
    if (output.length === 0) break;
  }
  return closeRing(output.map((point) => clampPoint(point, bounds)));
}

function clipEdge(points: Point[], bounds: ViewBounds, edge: Edge): Point[] {
  if (points.length === 0) return [];
  const result: Point[] = [];
  let previous = points[points.length - 1];
  let previousInside = inside(previous, bounds, edge);

  for (const current of points) {
    const currentInside = inside(current, bounds, edge);
    if (currentInside) {
      if (!previousInside) result.push(intersection(previous, current, bounds, edge));
      result.push(current);
    } else if (previousInside) {
      result.push(intersection(previous, current, bounds, edge));
    }
    previous = current;
    previousInside = currentInside;
  }
  return result;
}

function inside([lng, lat]: Point, bounds: ViewBounds, edge: Edge): boolean {
  if (edge === 'west') return lng >= bounds.west;
  if (edge === 'east') return lng <= bounds.east;
  if (edge === 'south') return lat >= bounds.south;
  return lat <= bounds.north;
}

function intersection(a: Point, b: Point, bounds: ViewBounds, edge: Edge): Point {
  const [x1, y1] = a;
  const [x2, y2] = b;
  if (edge === 'west' || edge === 'east') {
    const x = edge === 'west' ? bounds.west : bounds.east;
    const t = x2 === x1 ? 0 : (x - x1) / (x2 - x1);
    return [x, y1 + t * (y2 - y1)];
  }
  const y = edge === 'south' ? bounds.south : bounds.north;
  const t = y2 === y1 ? 0 : (y - y1) / (y2 - y1);
  return [x1 + t * (x2 - x1), y];
}

function normalizeRing(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const points = value
    .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])] as Point)
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && samePoint(first, last)) points.pop();
  return points;
}

function closeRing(points: Point[]): Point[] {
  const deduped = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (deduped.length < 3) return [];
  if (!samePoint(deduped[0], deduped[deduped.length - 1])) deduped.push([...deduped[0]]);
  return deduped;
}

function clampPoint([lng, lat]: Point, bounds: ViewBounds): Point {
  return [
    Math.max(bounds.west, Math.min(bounds.east, lng)),
    Math.max(bounds.south, Math.min(bounds.north, lat)),
  ];
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}
