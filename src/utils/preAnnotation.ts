/**
 * 预标注（pre-annotation）：把「农田模型识别」图层的识别结果转换成
 * 「农田人工标定」图层的可编辑标注，用少量修正替代从零绘制，加速攒数据。
 *
 * 纯函数，便于单测：不触碰 React、不访问 localStorage。
 */
import { getDefaultFeatureStyle } from './featureStyle';
import { polygonAreaSquareMeters } from './geoBounds';
import { parcelsOverlap } from './tileBatch';
import { LOW_CONFIDENCE } from './fieldReview';
import type { DedupInput } from './tileBatch';
import type { GeoJSONFeature } from '../types';

const PRE_ANNOTATION_COLOR = '#2f9e62';

export interface AdoptRecognitionOptions {
  /** 源：识别结果图层中的面要素（会被复制，不会被修改）。 */
  recognitionFeatures: GeoJSONFeature[];
  /** 目标图层现有标注（用于跳过重复块与续号）。 */
  existingLabels: GeoJSONFeature[];
  /** 目标「农田人工标定」图层 id。 */
  labelLayerId: string;
}

export interface AdoptRecognitionResult {
  /** 转出的新标定要素（已带 MAN 编号与标定属性）。 */
  features: GeoJSONFeature[];
  /** 因与已有标定重叠而跳过的数量。 */
  skipped: number;
  /** 新增块中模型置信度低于阈值（建议优先核对）的数量。 */
  lowConfidence: number;
}

/** 从既有编号（parcelIndex 与 MAN-xxx 代码）推算下一个可用序号。 */
function nextLabelIndex(labels: GeoJSONFeature[]): number {
  let max = 0;
  for (const label of labels) {
    const index = Number(label.properties.parcelIndex);
    if (Number.isFinite(index) && index > max) max = index;
    const match = /MAN-(\d+)/.exec(String(label.properties.parcelCode || ''));
    if (match) {
      const code = Number(match[1]);
      if (Number.isFinite(code) && code > max) max = code;
    }
  }
  return max + 1;
}

function toDedupInput(feature: GeoJSONFeature, areaSquareMeters: number): DedupInput {
  const coordinates = Array.isArray(feature.geometry.coordinates)
    ? (feature.geometry.coordinates as number[][][])
    : [[]];
  return { coordinates, areaSquareMeters, confidence: 0 };
}

function featureArea(feature: GeoJSONFeature): number {
  const stored = Number(feature.properties.parcelAreaSquareMeters);
  if (Number.isFinite(stored) && stored > 0) return stored;
  try {
    return polygonAreaSquareMeters(feature.geometry.coordinates as number[][][]);
  } catch {
    return 0;
  }
}

/**
 * 把识别结果转为人工标定要素：
 * - 每个识别面生成一个新的 MAN-xxx 标定要素（新 id、layerId 指向标定层）；
 * - 与已有标定（或本批先转出的块）重叠的识别结果被跳过，避免重复标注；
 * - 保留面积与置信度信息，名称/描述标注"待修正"来源，便于复核。
 */
export function adoptRecognitionAsLabels(options: AdoptRecognitionOptions): AdoptRecognitionResult {
  const { recognitionFeatures, existingLabels, labelLayerId } = options;
  const existingInputs = existingLabels
    .filter((f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    .map((f) => toDedupInput(f, featureArea(f)));

  let serial = nextLabelIndex(existingLabels);
  const features: GeoJSONFeature[] = [];
  let skipped = 0;
  let lowConfidence = 0;

  for (const source of recognitionFeatures) {
    if (source.geometry.type !== 'Polygon' && source.geometry.type !== 'MultiPolygon') continue;
    const areaSquareMeters = featureArea(source);
    const candidate = toDedupInput(source, areaSquareMeters);
    const isDuplicate = existingInputs.some((other) => parcelsOverlap(candidate, other));
    if (isDuplicate) {
      skipped += 1;
      continue;
    }

    const code = `MAN-${String(serial).padStart(3, '0')}`;
    const confidence = Number(source.properties.parcelConfidence);
    const confidenceText = Number.isFinite(confidence) && confidence > 0
      ? `模型预标注，置信度 ${(confidence * 100).toFixed(0)}%，请核对修正`
      : '模型预标注，请核对修正';
    if (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE) lowConfidence += 1;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: source.geometry.coordinates as number[][][],
      },
      properties: {
        ...getDefaultFeatureStyle('Polygon', PRE_ANNOTATION_COLOR),
        id: crypto.randomUUID(),
        name: `农田标定-${code}`,
        description: confidenceText,
        shapeType: 'Polygon',
        layerId: labelLayerId,
        parcelCode: code,
        parcelIndex: serial,
        parcelGroup: '人工标定',
        parcelAreaMu: Number((areaSquareMeters / 666.667).toFixed(2)),
        parcelAreaSquareMeters: Number(areaSquareMeters.toFixed(2)),
        parcelConfidence: Number.isFinite(confidence) ? confidence : undefined,
        parcelRole: 'parcel',
        source: 'manual-farmland-label',
      },
    });

    existingInputs.push(candidate);
    serial += 1;
  }

  return { features, skipped, lowConfidence };
}
