import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../AppContext';
import { setManualLabelLayerId } from '../utils/mapHelpers';
import {
  getManualLabelFeatures,
  getLayerBounds,
  buildManualLabelUpdates,
} from '../utils/yoloDataset';
import type { Bounds } from '../utils/yoloDataset';

export function useManualLabelLayer() {
  const { state, dispatch } = useAppContext();
  const [labelLayerId, setLabelLayerId] = useState('');
  const [labelMode, setLabelMode] = useState(false);

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

  const activateLabelLayer = useCallback(() => {
    const api = (window as any).__webgis;
    if (!api?.enableDraw) return;
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
    window.setTimeout(() => api.enableDraw('Polygon', { snappable: false, snapMiddle: false }), 0);
    setLabelMode(true);
  }, [dispatch, labelLayerId, state.features, state.layers]);

  const deactivateLabelLayer = useCallback(() => {
    const api = (window as any).__webgis;
    api?.disableDraw?.();
    setLabelMode(false);
  }, []);

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

  // Auto-number unlabeled features
  useEffect(() => {
    const updates = buildManualLabelUpdates(manualLabelFeatures).filter((item) => {
      const feat = manualLabelFeatures.find((c) => c.properties.id === item.id);
      return feat && (
        feat.properties.parcelRole !== 'parcel' ||
        feat.properties.source !== 'manual-farmland-label' ||
        !feat.properties.parcelCode ||
        typeof feat.properties.parcelAreaMu !== 'number'
      );
    });
    updates.forEach((item) => dispatch({ type: 'UPDATE_FEATURE', id: item.id, updates: item.updates }));

    const unlabeled = manualLabelFeatures.filter((f) => !f.properties.parcelCode);
    if (unlabeled.length > 0) {
      const existingCodes = new Set(manualLabelFeatures.map((f) => f.properties.parcelCode).filter(Boolean));
      const maxExisting = manualLabelFeatures.reduce((max, f) => Math.max(max, f.properties.parcelIndex || 0), 0);
      unlabeled.forEach((feature, idx) => {
        const parcelIndex = maxExisting + idx + 1;
        const code = "MAN-" + String(parcelIndex).padStart(3, '0');
        if (existingCodes.has(code)) return;
        dispatch({
          type: 'UPDATE_FEATURE', id: feature.properties.id,
          updates: {
            name: "农田标定-" + code, parcelCode: code, parcelIndex,
            parcelGroup: '人工标定', parcelRole: 'parcel' as const,
            source: 'manual-farmland-label' as const,
          },
        });
      });
    }
  }, [dispatch, manualLabelFeatures]);

  return { labelLayerId, manualLabelFeatures, bounds, labelMode, activateLabelLayer, deactivateLabelLayer, deleteLabelFeature };
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
