/**
 * 大范围识别的瓦片批处理：栅格规划与跨瓦片去重。
 *
 * 背景：行政区识别过去把整个范围拟合进一张 640px 影像，县域越大像素越粗，
 * 地块小到模型无法检出。这里改为按固定缩放切成瓦片网格，逐张识别后合并。
 */
import { gcj2wgs, wgs2gcj } from './coord';
import { AMAP_STATIC_SIZE, staticAmapBoundsToWgs } from './amapStatic';
import type { ViewBounds } from './mapAPI';

export interface TileGridTile {
  /** WGS-84 瓦片中心 [lng, lat]。 */
  center: [number, number];
  /** WGS-84 瓦片覆盖范围。 */
  bounds: ViewBounds;
}

export interface TileGridPlan {
  zoom: number;
  cols: number;
  rows: number;
  tiles: TileGridTile[];
}

export interface TileGridOptions {
  /** 瓦片数上限；规划时会从高到低尝试缩放，超过上限则降一档。 */
  maxTiles?: number;
  /** 候选缩放（从高到低）。 */
  zoomPreference?: number[];
  /** 允许的最低缩放；低于此缩放的方案直接放弃（返回 null）。 */
  minZoom?: number;
  /** 相邻瓦片重叠比例（0~0.5），用于避免地块恰好被切在瓦片边界。 */
  overlap?: number;
  /** 瓦片像素尺寸（默认与 /amap-static 一致的 640）。 */
  size?: number;
}

/** 估算指定缩放下一张瓦片在给定中心处的 WGS-84 跨度。 */
function tileSpanAt(centerLng: number, centerLat: number, zoom: number, size: number): { w: number; h: number } {
  const [gcjLat, gcjLng] = wgs2gcj(centerLat, centerLng);
  const bounds = staticAmapBoundsToWgs([gcjLng, gcjLat], zoom, size, size);
  return { w: bounds.east - bounds.west, h: bounds.north - bounds.south };
}

/**
 * 规划瓦片网格：从高到低尝试缩放，返回第一个瓦片数不超过上限的方案。
 * 全部超过上限时返回 null（调用方回退到整幅单图识别）。
 */
export function planAmapTileGrid(region: ViewBounds, options: TileGridOptions = {}): TileGridPlan | null {
  const maxTiles = options.maxTiles ?? 64;
  const zoomPreference = options.zoomPreference ?? [16, 15, 14, 13, 12, 11, 10];
  const minZoom = options.minZoom ?? 3;
  const overlap = Math.min(0.45, Math.max(0, options.overlap ?? 0.2));
  const size = options.size ?? AMAP_STATIC_SIZE;

  const regionW = Math.max(0, region.east - region.west);
  const regionH = Math.max(0, region.north - region.south);
  if (regionW <= 0 || regionH <= 0) return null;

  const centerLng = (region.west + region.east) / 2;
  const centerLat = (region.south + region.north) / 2;

  for (const zoom of zoomPreference) {
    if (zoom < minZoom) break;
    const span = tileSpanAt(centerLng, centerLat, zoom, size);
    if (span.w <= 0 || span.h <= 0) continue;
    const stepW = span.w * (1 - overlap);
    const stepH = span.h * (1 - overlap);
    const cols = regionW <= span.w ? 1 : Math.ceil((regionW - span.w) / stepW) + 1;
    const rows = regionH <= span.h ? 1 : Math.ceil((regionH - span.h) / stepH) + 1;
    if (cols * rows > maxTiles) continue;

    const tiles: TileGridTile[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        // 首尾对齐：区域内边距优先，最后一行/列贴边
        const lng = cols === 1
          ? centerLng
          : region.west + span.w / 2 + Math.min(c * stepW, regionW - span.w);
        const lat = rows === 1
          ? centerLat
          : region.south + span.h / 2 + Math.min(r * stepH, regionH - span.h);
        const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
        const bounds = staticAmapBoundsToWgs([gcjLng, gcjLat], zoom, size, size);
        // 瓦片覆盖范围已是 WGS-84，同时把中心还原为 WGS-84 供展示/记录
        const [wgsLat, wgsLng] = gcj2wgs(gcjLat, gcjLng);
        tiles.push({ center: [wgsLng, wgsLat], bounds });
      }
    }
    return { zoom, cols, rows, tiles };
  }
  return null;
}

export interface DedupInput {
  /** GeoJSON 外环坐标 [[lng, lat], ...] */
  coordinates: number[][][];
  areaSquareMeters: number;
  confidence: number;
}

/** 两个范围的交集；无交集时返回 null。 */
export function intersectBounds(a: ViewBounds, b: ViewBounds): ViewBounds | null {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

function bboxOf(coords: number[][][]): ViewBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of coords) {
    for (const point of ring) {
      const lng = Number(point?.[0]);
      const lat = Number(point?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) return { west: 0, south: 0, east: 0, north: 0 };
  return { west, south, east, north };
}

function bboxIou(a: ViewBounds, b: ViewBounds): number {
  const ix = Math.max(0, Math.min(a.east, b.east) - Math.max(a.west, b.west));
  const iy = Math.max(0, Math.min(a.north, b.north) - Math.max(a.south, b.south));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a.east - a.west) * Math.max(0, a.north - a.south);
  const areaB = Math.max(0, b.east - b.west) * Math.max(0, b.north - b.south);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/** 小包围盒有多大比例落在另一个包围盒内。 */
function bboxContainment(small: ViewBounds, big: ViewBounds): number {
  const ix = Math.max(0, Math.min(small.east, big.east) - Math.max(small.west, big.west));
  const iy = Math.max(0, Math.min(small.north, big.north) - Math.max(small.south, big.south));
  const inter = ix * iy;
  const areaSmall = Math.max(0, small.east - small.west) * Math.max(0, small.north - small.south);
  return areaSmall > 0 ? inter / areaSmall : 0;
}

/** 判定两个地块是否为同一块（同一套包围盒规则，供去重与预标注复用）。 */
function overlapsWithBBoxes(
  areaA: number,
  bboxA: ViewBounds,
  areaB: number,
  bboxB: ViewBounds,
): boolean {
  const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
  if (ratio < 0.15) return false; // 面积差太多，不是同一块地（如大田缝隙里的小地块）
  if (bboxIou(bboxA, bboxB) >= 0.4 && ratio >= 0.5) return true;
  // 残缺副本：较小者几乎完全包含在较大者的包围盒内
  if (areaA <= areaB) return bboxContainment(bboxA, bboxB) >= 0.85;
  return bboxContainment(bboxB, bboxA) >= 0.85;
}

/** 公开的单对判定：两个地块是否视为同一块。 */
export function parcelsOverlap(a: DedupInput, b: DedupInput): boolean {
  return overlapsWithBBoxes(
    Math.max(1, a.areaSquareMeters),
    bboxOf(a.coordinates),
    Math.max(1, b.areaSquareMeters),
    bboxOf(b.coordinates),
  );
}

/**
 * 跨瓦片去重：地块被瓦片边界切开时会在两张瓦片分别检出（含重叠区）。
 * 规则（满足任一即视为同一地块，保留面积更大者）：
 *  1) 面积量级相近（比例 ≥0.5）且包围盒 IoU ≥0.4 —— 同一位置的重复检出；
 *  2) 较小者 ≥85% 落在较大者包围盒内，且面积比 ≥0.15 —— 大块完整、小块是
 *     邻瓦片切出的残缺副本。
 * 面积比 <0.15 的嵌套保留（可能是大块缝隙里真实存在的小地块）。
 * 按面积降序贪心，保证结果与输入顺序无关。
 */
export function dedupeOverlappingParcels<T extends DedupInput>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => b.areaSquareMeters - a.areaSquareMeters);
  const kept: Array<{ item: T; bbox: ViewBounds }> = [];
  for (const item of sorted) {
    const bbox = bboxOf(item.coordinates);
    const area = Math.max(1, item.areaSquareMeters);
    const isDuplicate = kept.some(({ item: other, bbox: otherBbox }) =>
      overlapsWithBBoxes(area, bbox, Math.max(1, other.areaSquareMeters), otherBbox),
    );
    if (!isDuplicate) kept.push({ item, bbox });
  }
  return kept.map(({ item }) => item);
}
