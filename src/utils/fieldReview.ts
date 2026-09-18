/**
 * 地块管理面板的审查辅助：排序、置信度分级、逐块核对游标。
 * 纯函数，便于单测。
 */
import type { GeoJSONFeature } from '../types';

export type FieldSortBy = 'area' | 'confidence' | 'name';

export interface FieldListItem {
  feature: GeoJSONFeature;
  areaMu: number;
}

/** 置信度阈值：<0.5 低（优先核对），≥0.7 高。 */
export const LOW_CONFIDENCE = 0.5;
export const HIGH_CONFIDENCE = 0.7;

export type ConfidenceLevel = 'high' | 'mid' | 'low';

/** 地块置信度（0~1）；没有该字段（人工绘制）返回 null。 */
export function featureConfidence(feature: GeoJSONFeature): number | null {
  const value = Number(feature.properties.parcelConfidence);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

export function confidenceLevel(value: number | null): ConfidenceLevel | null {
  if (value === null) return null;
  if (value >= HIGH_CONFIDENCE) return 'high';
  if (value >= LOW_CONFIDENCE) return 'mid';
  return 'low';
}

/** 排序：面积降序 / 置信度升序（低置信在前，人工绘制殿后） / 名称。 */
export function sortFieldList(items: FieldListItem[], sortBy: FieldSortBy): FieldListItem[] {
  const list = [...items];
  if (sortBy === 'area') {
    list.sort((a, b) => b.areaMu - a.areaMu);
  } else if (sortBy === 'name') {
    list.sort((a, b) =>
      String(a.feature.properties.name || '').localeCompare(String(b.feature.properties.name || ''), 'zh'),
    );
  } else {
    list.sort((a, b) => {
      const ca = featureConfidence(a.feature) ?? Number.POSITIVE_INFINITY;
      const cb = featureConfidence(b.feature) ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return ca - cb;
      return b.areaMu - a.areaMu;
    });
  }
  return list;
}

/** 排序按钮循环：面积 → 置信度 → 名称 → 面积。 */
export function nextSortBy(current: FieldSortBy): FieldSortBy {
  if (current === 'area') return 'confidence';
  if (current === 'confidence') return 'name';
  return 'area';
}

export function fieldSortLabel(sortBy: FieldSortBy): string {
  if (sortBy === 'area') return '面积↓';
  if (sortBy === 'confidence') return '置信度↑';
  return '名称';
}

/**
 * 「下一块」游标：返回列表中当前项之后的下标。
 * 未选中/已到末尾时回到第一块（循环核对）；空列表返回 -1。
 */
export function nextReviewIndex(total: number, currentIndex: number): number {
  if (total <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= total - 1) return 0;
  return currentIndex + 1;
}
