import area from '@turf/area';
import type { GeoJSONFeature } from '../types';

export const MANUAL_LABEL_SOURCE = 'manual-farmland-label';

export function formatLabelCode(index: number): string {
  return `MAN-${String(index).padStart(3, '0')}`;
}

function parseLabelCode(code: unknown): number | null {
  const matched = /^MAN-(\d+)$/.exec(String(code || ''));
  return matched ? Number(matched[1]) : null;
}

/**
 * 计算面要素的面积属性（亩 / 平方米）。几何非法时返回空对象。
 */
export function computeAreaProps(feature: GeoJSONFeature): {
  parcelAreaMu?: number;
  parcelAreaSquareMeters?: number;
} {
  try {
    const areaSquareMeters = area(feature as any);
    if (!Number.isFinite(areaSquareMeters) || areaSquareMeters <= 0) return {};
    return {
      parcelAreaSquareMeters: Number(areaSquareMeters.toFixed(2)),
      parcelAreaMu: Number((areaSquareMeters / 666.667).toFixed(2)),
    };
  } catch {
    return {};
  }
}

export interface LabelPlanUpdate {
  id: string;
  updates: Partial<GeoJSONFeature['properties']>;
}

/**
 * 为标定层要素计算需要补齐的属性（编号 / 面积 / 分组）。
 *
 * 编号规则：只给还没有 parcelCode 的块分配编号，从现有最大编号 +1 起顺延
 * （删除过的空号可能被再次使用，编号始终连续紧凑）；与现有编号冲突时
 * 继续顺延，绝不重号。已有 parcelCode 的块永远不改编号 —— 避免历史标注
 * 在重排时错位。
 */
export function planLabelUpdates(features: GeoJSONFeature[]): LabelPlanUpdate[] {
  const existingCodes = new Set<string>();
  let maxIndex = 0;
  for (const feature of features) {
    const code = feature.properties.parcelCode;
    if (code) existingCodes.add(code);
    const parsed = parseLabelCode(code);
    const index = Number(feature.properties.parcelIndex) || 0;
    maxIndex = Math.max(maxIndex, index, parsed ?? 0);
  }

  let next = maxIndex + 1;
  const updates: LabelPlanUpdate[] = [];

  for (const feature of features) {
    const p = feature.properties;
    const needCode = !p.parcelCode;
    const needArea =
      typeof p.parcelAreaMu !== 'number' || typeof p.parcelAreaSquareMeters !== 'number';
    const needBase =
      p.parcelRole !== 'parcel' || p.source !== MANUAL_LABEL_SOURCE || needArea;
    if (!needCode && !needBase) continue;

    const update: Partial<GeoJSONFeature['properties']> = {};
    if (needBase) {
      update.parcelRole = 'parcel';
      update.source = MANUAL_LABEL_SOURCE;
      update.parcelGroup = p.parcelGroup || '人工标定';
      if (needArea) {
        const areaProps = computeAreaProps(feature);
        if (areaProps.parcelAreaMu !== undefined && typeof p.parcelAreaMu !== 'number') {
          update.parcelAreaMu = areaProps.parcelAreaMu;
        }
        if (
          areaProps.parcelAreaSquareMeters !== undefined &&
          typeof p.parcelAreaSquareMeters !== 'number'
        ) {
          update.parcelAreaSquareMeters = areaProps.parcelAreaSquareMeters;
        }
      }
    }
    if (needCode) {
      while (existingCodes.has(formatLabelCode(next))) next += 1;
      const code = formatLabelCode(next);
      existingCodes.add(code);
      update.parcelCode = code;
      update.parcelIndex = next;
      update.name = `农田标定-${code}`;
      next += 1;
    }
    updates.push({ id: p.id, updates: update });
  }

  return updates;
}
