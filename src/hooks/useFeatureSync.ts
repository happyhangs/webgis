import { useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { getBasemapConfig } from '../basemaps';
import { wgs2gcj, shiftFeatureCoords } from '../utils/coord';
import { getDashArray, isAreaShape } from '../utils/featureStyle';
import { applyStyle, clearLayerTooltip, emitFeatureClick } from '../utils/mapHelpers';
import type { GeoJSONFeature, Layer } from '../types';

export function useFeatureSync(
  mapRef: React.RefObject<L.Map | null>,
  features: GeoJSONFeature[],
  layers: Layer[],
  basemap: string,
  selectedFeatureId: string | null,
  layerMapRef: React.RefObject<Map<string, L.Layer>>,
  selectedLayerRef: React.MutableRefObject<L.Layer | null>,
  dispatch: React.Dispatch<any>,
) {
  const visibleIds = useMemo(
    () => new Set(layers.filter((l) => l.visible).map((l) => l.id)),
    [layers],
  );

  // ── Add / Remove layers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lm = layerMapRef.current;
    if (!lm) return;

    const desiredIds = new Set(
      features.filter((f) => visibleIds.has(f.properties.layerId)).map((f) => f.properties.id),
    );

    for (const [id, layer] of lm) {
      if (!desiredIds.has(id)) {
        map.removeLayer(layer);
        lm.delete(id);
        if (selectedLayerRef.current === layer) selectedLayerRef.current = null;
      }
    }

    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;

    for (const feature of features) {
      if (!visibleIds.has(feature.properties.layerId)) continue;
      if (lm.has(feature.properties.id)) continue;

      let displayFeature = { ...feature, geometry: { ...feature.geometry } };
      if (needGCJ) {
        displayFeature = shiftFeatureCoords(displayFeature, wgs2gcj);
      }

      try {
        const gj = L.geoJSON(displayFeature as any, {
          pointToLayer: (_f: any, latlng: L.LatLng) =>
            L.circleMarker(latlng, {
              radius: 8,
              fillColor: feature.properties.color,
              color: '#fff',
              weight: 2,
              fillOpacity: 0.9,
            }),
          style: () => {
            const p = feature.properties;
            return {
              color: p.color,
              fillColor: p.fillColor,
              fillOpacity: isAreaShape(p.shapeType) && p.fillEnabled ? 0.26 : 0,
              weight: p.strokeWidth,
              dashArray: getDashArray(p.strokeStyle, p.strokeWidth),
              lineCap: p.strokeStyle === 'dotted' ? 'round' : 'butt',
            };
          },
          onEachFeature: (_f: any, layer: L.Layer) => {
            (layer as any).feature = feature;
            clearLayerTooltip(layer);
            layer.on('click', () => {
              emitFeatureClick(feature);
              dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
            });
          },
        });
        gj.eachLayer((l) => { lm.set(feature.properties.id, l); });
        gj.addTo(map);
      } catch { /* ignore malformed geometry */ }
    }
  }, [features, layers, visibleIds, basemap, dispatch, layerMapRef, selectedLayerRef]);

  // ── Highlight selected feature ──
  useEffect(() => {
    if (selectedLayerRef.current) {
      const prev = selectedLayerRef.current;
      const feat = (prev as any).feature as GeoJSONFeature | undefined;
      if (feat) applyStyle(prev, feat, false);
      selectedLayerRef.current = null;
    }

    if (!selectedFeatureId) return;

    const lm = layerMapRef.current;
    if (!lm) return;
    const layer = lm.get(selectedFeatureId);
    if (layer) {
      const feat = (layer as any).feature as GeoJSONFeature | undefined;
      if (feat) applyStyle(layer, feat, true);
      selectedLayerRef.current = layer;
    }
  }, [selectedFeatureId, layerMapRef, selectedLayerRef]);

  // ── Sync feature property changes ──
  const prevFeaturesRef = useRef(features);
  useEffect(() => {
    const lm = layerMapRef.current;
    if (!lm) return;
    const prevMap = new Map(prevFeaturesRef.current.map((f) => [f.properties.id, f]));
    for (const f of features) {
      const prev = prevMap.get(f.properties.id);
      if (
        prev &&
        (prev.properties.color !== f.properties.color ||
          prev.properties.fillColor !== f.properties.fillColor ||
          prev.properties.fillEnabled !== f.properties.fillEnabled ||
          prev.properties.strokeStyle !== f.properties.strokeStyle ||
          prev.properties.strokeWidth !== f.properties.strokeWidth ||
          prev.properties.name !== f.properties.name ||
          prev.properties.layerId !== f.properties.layerId)
      ) {
        const layer = lm.get(f.properties.id);
        if (layer) {
          const isSelected = f.properties.id === selectedFeatureId;
          applyStyle(layer, f, isSelected);
          (layer as any).feature = f;
          clearLayerTooltip(layer);
        }
      }
    }
    prevFeaturesRef.current = features;
  }, [features, selectedFeatureId, layerMapRef]);

  // ── Sync selected layer ref for toolbar ──
  useEffect(() => {
    const lm = layerMapRef.current;
    (window as any).__webgis_selectedLayer = (selectedFeatureId && lm)
      ? lm.get(selectedFeatureId) || null
      : null;
  }, [selectedFeatureId, layerMapRef]);
}
