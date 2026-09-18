import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { setManualLabelLayerId } from '../utils/mapHelpers';
import {
  getManualLabelFeatures,
  getLayerBounds,
} from '../utils/yoloDataset';
import { planLabelUpdates } from '../utils/labelTools';
import { adoptRecognitionAsLabels } from '../utils/preAnnotation';
import type { Bounds } from '../utils/yoloDataset';
import type { GeoJSONFeature } from '../types';

export const MANUAL_LABEL_LAYER_NAME = '农田人工标定';

export function useManualLabelLayer() {
  const { state, dispatch } = useAppContext();
  const [labelLayerId, setLabelLayerId] = React.useState('');
  const labelMode = state.labelMode;

  // Find or create the manual label layer
  useEffect(() => {
    const existing = findLabelLayer(state.layers, state.features);
    if (existing) {
      if (existing.name !== '农田人工标定') {
        dispatch({ type: 'RENAME_LAYER', id: existing.id, name: '农田人工标定' });
      }
      if (existing.id !== labelLayerId) {
        setLabelLayerId(existing.id);
        setManualLabelLayerId(existing.id);
      }
    } else if (labelLayerId) {
      setLabelLayerId('');
      setManualLabelLayerId(null as any);
    }
  }, [dispatch, state.features, state.layers, labelLayerId]);

  // Sync labelMode to global so useMapInit can re-enable draw after each polygon
  const labelModeRef = React.useRef(labelMode);
  labelModeRef.current = labelMode;
  useEffect(() => {
    (window as any).__webgis_labelMode = labelModeRef.current;
    return () => { delete (window as any).__webgis_labelMode; };
  }, [labelMode]);

  const startLabelDrawing = useCallback(() => {
    (window as any).__webgis?.startLabelDrawing?.();
  }, []);

  const startLabelRemoval = useCallback(() => {
    (window as any).__webgis?.startLabelRemoval?.();
  }, []);

  const activateLabelLayer = useCallback(() => {
    const api = (window as any).__webgis;
    if (!api?.startLabelDrawing) return;
    let lid = labelLayerId;
    if (!lid) {
      const existing = findLabelLayer(state.layers, state.features);
      if (existing) {
        lid = existing.id;
        if (existing.name !== '农田人工标定') {
          dispatch({ type: 'RENAME_LAYER', id: existing.id, name: '农田人工标定' });
        }
        setLabelLayerId(lid);
        setManualLabelLayerId(lid);
      } else {
        lid = crypto.randomUUID();
        dispatch({ type: 'ADD_LAYER', layer: { id: lid, name: '农田人工标定', visible: true } });
        setLabelLayerId(lid);
        setManualLabelLayerId(lid);
      }
    }
    dispatch({ type: 'SET_CURRENT_LAYER', id: lid });
    dispatch({ type: 'SET_LABEL_MODE', on: true });
    window.setTimeout(() => api.startLabelDrawing(), 0);
  }, [dispatch, labelLayerId, state.features, state.layers]);

  const deactivateLabelLayer = useCallback(() => {
    const api = (window as any).__webgis;
    api?.stopLabelDrawing?.();
    api?.stopLabelRemoval?.();
    dispatch({ type: 'SET_LABEL_MODE', on: false });
  }, [dispatch]);

  /**
   * 把识别结果图层中的面要素转入人工标定：
   * 确保标定层存在 → 跳过与已有标定重叠的块 → 生成 MAN-xxx 新标定。
   * 返回新增/跳过数量，由调用方决定消息与源图层清理。
   */
  const importRecognitionFeatures = useCallback((recognitionFeatures: GeoJSONFeature[]) => {
    let lid = labelLayerId;
    if (!lid) {
      const existing = findLabelLayer(state.layers, state.features);
      if (existing) {
        lid = existing.id;
        if (existing.name !== MANUAL_LABEL_LAYER_NAME) {
          dispatch({ type: 'RENAME_LAYER', id: existing.id, name: MANUAL_LABEL_LAYER_NAME });
        }
      } else {
        lid = crypto.randomUUID();
        dispatch({ type: 'ADD_LAYER', layer: { id: lid, name: MANUAL_LABEL_LAYER_NAME, visible: true } });
      }
      setLabelLayerId(lid);
      setManualLabelLayerId(lid);
    }
    const existingLabels = getManualLabelFeatures(state.features, lid);
    const { features, skipped, lowConfidence } = adoptRecognitionAsLabels({
      recognitionFeatures,
      existingLabels,
      labelLayerId: lid,
    });
    if (features.length > 0) {
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      dispatch({ type: 'SET_CURRENT_LAYER', id: lid });
    }
    return { added: features.length, skipped, lowConfidence, layerId: lid };
  }, [dispatch, labelLayerId, state.features, state.layers]);

  const deleteLabelFeature = useCallback((featureId: string) => {
    dispatch({ type: 'DELETE_FEATURE', id: featureId });
  }, [dispatch]);

  // Fingerprint-based cache: avoid expensive recomputation of manual-label
  // features & bounds when state.features changes but the subset belonging to
  // labelLayerId hasn't actually changed (detected via ID+parcelCode fingerprint).
  const prevFingerprintRef = useRef('');
  const cachedFeaturesRef = useRef<any[]>([]);
  const cachedBoundsRef = useRef<Bounds | null>(null);

  const manualLabelFeatures = useMemo(() => {
    if (!labelLayerId) {
      prevFingerprintRef.current = '';
      cachedFeaturesRef.current = [];
      cachedBoundsRef.current = null;
      return [] as any[];
    }
    const fingerprint = state.features
      .filter((f) => f.properties?.layerId === labelLayerId)
      .map((f) => `${f.properties.id}:${f.properties.parcelCode ?? ''}`)
      .join(',');
    if (fingerprint === prevFingerprintRef.current) {
      return cachedFeaturesRef.current;
    }
    prevFingerprintRef.current = fingerprint;
    cachedFeaturesRef.current = getManualLabelFeatures(state.features, labelLayerId);
    cachedBoundsRef.current = getLayerBounds(state.features, labelLayerId);
    return cachedFeaturesRef.current;
  }, [labelLayerId, state.features]);

  const bounds = useMemo<Bounds | null>(
    () => (labelLayerId ? cachedBoundsRef.current : null),
    [labelLayerId, state.features],
  );

  // 本会话新画地块的撤销栈：只在标注模式进行中记录新出现的标定块，
  // 装载历史数据（恢复快照/加载图层）时只刷新基线，绝不入栈。
  const knownIdsRef = useRef<Set<string> | null>(null);
  const drawnStackRef = useRef<string[]>([]);
  useEffect(() => {
    const ids = manualLabelFeatures.map((f) => f.properties.id);
    if (knownIdsRef.current === null || !labelModeRef.current) {
      knownIdsRef.current = new Set(ids);
      return;
    }
    const known = knownIdsRef.current;
    for (const id of ids) {
      if (!known.has(id)) drawnStackRef.current.push(id);
    }
    knownIdsRef.current = new Set(ids);
  }, [manualLabelFeatures]);

  const undoLastBlock = useCallback(() => {
    while (drawnStackRef.current.length > 0) {
      const id = drawnStackRef.current.pop()!;
      if (state.features.some((f) => f.properties.id === id)) {
        dispatch({ type: 'DELETE_FEATURE', id });
        return id;
      }
    }
    return null;
  }, [dispatch, state.features]);

  const canUndo = drawnStackRef.current.some((id) =>
    state.features.some((f) => f.properties.id === id),
  );

  // 自动编号 + 补齐面积/分组：编号只分配给还没有 parcelCode 的块，
  // 从现有最大编号顺延且绝不重号（详见 utils/labelTools）。
  useEffect(() => {
    const updates = planLabelUpdates(manualLabelFeatures);
    updates.forEach((item) => dispatch({ type: 'UPDATE_FEATURE', id: item.id, updates: item.updates }));
  }, [dispatch, manualLabelFeatures]);

  return {
    labelLayerId,
    manualLabelFeatures,
    bounds,
    labelMode,
    activateLabelLayer,
    deactivateLabelLayer,
    deleteLabelFeature,
    importRecognitionFeatures,
    startLabelDrawing,
    startLabelRemoval,
    undoLastBlock,
    canUndo,
  };
}

function findLabelLayer(layers: Array<{ id: string; name: string }>, features: any[]) {
  const named = layers.find((layer) => layer.name === '农田人工标定');
  if (named) return named;
  const reusableId = features.find((feature) =>
    (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon') &&
    ['manual-farmland-label', 'training-map-draft'].includes(feature.properties?.source),
  )?.properties?.layerId;
  return layers.find((layer) => layer.id === reusableId);
}
