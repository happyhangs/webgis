import { useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet/dist/leaflet.css';
import { useAppContext } from './AppContext';
import { getBasemapConfig } from './basemaps';
import { getFeatureMeasurement } from './utils/measure';
import type { GeoJSONFeature, BasemapConfig } from './types';

const SHAPE_LABELS: Record<string, string> = {
  Marker: '点',
  Line: '线',
  Polygon: '面',
  Rectangle: '矩形',
};

function buildFeature(geojson: any, shape: string, layerId: string): GeoJSONFeature {
  const shapeType =
    shape === 'Marker'
      ? 'Marker'
      : shape === 'Line'
        ? 'Line'
        : shape === 'Rectangle'
          ? 'Rectangle'
          : 'Polygon';

  const label = SHAPE_LABELS[shapeType] || '要素';
  return {
    ...geojson,
    properties: {
      id: crypto.randomUUID(),
      name: `未命名${label}`,
      description: '',
      color: '#3388ff',
      shapeType: shapeType as GeoJSONFeature['properties']['shapeType'],
      layerId,
    },
  };
}

function applyStyle(layer: any, feature: GeoJSONFeature, selected: boolean) {
  const c = feature.properties.color;
  if (feature.properties.shapeType === 'Marker') {
    layer.setStyle({
      radius: selected ? 10 : 8,
      fillColor: c,
      color: selected ? '#ff0' : '#fff',
      weight: selected ? 4 : 2,
      fillOpacity: 0.9,
    });
  } else {
    layer.setStyle({
      color: c,
      fillColor: c,
      weight: selected ? 5 : 3,
      fillOpacity: selected ? 0.4 : 0.2,
    });
  }
}

function updateTooltip(layer: any, feature: GeoJSONFeature) {
  const measurement = getFeatureMeasurement(feature);
  if (measurement) {
    if (layer.getTooltip()) {
      layer.setTooltipContent(measurement);
    } else {
      layer.bindTooltip(measurement, {
        permanent: true,
        direction: 'center',
        className: 'measurement-tooltip',
      });
    }
  }
}

function getTileLayerOptions(cfg: BasemapConfig): L.TileLayerOptions {
  const options: L.TileLayerOptions = {
    attribution: cfg.attribution,
    maxZoom: 19,
  };

  if (cfg.subdomains?.length) {
    options.subdomains = cfg.subdomains;
  }

  return options;
}

export default function MapView() {
  const { state, dispatch } = useAppContext();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerMap = useRef<Map<string, L.Layer>>(new Map());
  const selectedLayer = useRef<L.Layer | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const currentLayerIdRef = useRef(state.currentLayerId);
  const initializedRef = useRef(false);

  // Keep ref in sync
  currentLayerIdRef.current = state.currentLayerId;

  // Initialise Leaflet once. React owns the container node; Leaflet owns its contents.
  useEffect(() => {
    if (!mapContainerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = L.map(mapContainerRef.current, {
      center: state.mapView.center,
      zoom: state.mapView.zoom,
      zoomControl: true,
    });

    const cfg = getBasemapConfig(state.basemap);
    const tileLayer = L.tileLayer(cfg.url, getTileLayerOptions(cfg)).addTo(map);
    tileLayerRef.current = tileLayer;

    // --- Geoman event handlers ---

    map.on('pm:create', (e: any) => {
      const layer = e.layer;
      const feature = buildFeature(layer.toGeoJSON(), e.shape, currentLayerIdRef.current);
      layer.feature = feature;
      applyStyle(layer, feature, false);
      updateTooltip(layer, feature);
      layerMap.current.set(feature.properties.id, layer);

      layer.on('click', () => {
        dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
      });

      dispatch({ type: 'ADD_FEATURE', feature });
    });

    let updateTimer: ReturnType<typeof setTimeout> | null = null;

    map.on('pm:update', (e: any) => {
      const layer = e.layer;
      const feature = layer.feature as GeoJSONFeature | undefined;
      if (!feature) return;
      const geojson = layer.toGeoJSON() as GeoJSONFeature;
      const updated = {
        ...geojson,
        properties: { ...feature.properties },
      };
      layer.feature = updated;
      updateTooltip(layer, updated);

      // Debounce React state — pm:update fires per pixel during vertex drag
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        dispatch({ type: 'UPDATE_FEATURE_GEOMETRY', feature: updated });
      }, 200);
    });

    map.on('pm:remove', (e: any) => {
      const feature = e.layer.feature as GeoJSONFeature | undefined;
      if (feature) {
        layerMap.current.delete(feature.properties.id);
        dispatch({ type: 'DELETE_FEATURE', id: feature.properties.id });
      }
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      dispatch({
        type: 'SET_MAP_VIEW',
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      layerMap.current.clear();
      selectedLayer.current = null;
      initializedRef.current = false;
      tileLayerRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = getBasemapConfig(state.basemap);

    // Remove old tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    // Add new one
    const tl = L.tileLayer(cfg.url, getTileLayerOptions(cfg)).addTo(map);
    tileLayerRef.current = tl;
  }, [state.basemap]);

  // SynFeature visibility: get visible layer IDs
  const visibleIds = useMemo(
    () => new Set(state.layers.filter((l) => l.visible).map((l) => l.id)),
    [state.layers],
  );

  // Sync features from state → map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Determine which feature IDs should be on the map
    const desiredIds = new Set(
      state.features.filter((f) => visibleIds.has(f.properties.layerId)).map((f) => f.properties.id),
    );

    // Remove layers not wanted
    for (const [id, layer] of layerMap.current) {
      if (!desiredIds.has(id)) {
        map.removeLayer(layer);
        layerMap.current.delete(id);
        if (selectedLayer.current === layer) selectedLayer.current = null;
      }
    }

    // Add new features not yet on map (and from visible layers)
    for (const feature of state.features) {
      if (!visibleIds.has(feature.properties.layerId)) continue;
      if (layerMap.current.has(feature.properties.id)) continue;

      const gj = L.geoJSON(feature as any, {
        pointToLayer: (_f: any, latlng) =>
          L.circleMarker(latlng, {
            radius: 8,
            fillColor: feature.properties.color,
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9,
          }),
        style: () => ({
          color: feature.properties.color,
          fillColor: feature.properties.color,
          fillOpacity: 0.2,
          weight: 3,
        }),
        onEachFeature: (_f: any, layer: L.Layer) => {
          (layer as any).feature = feature;
          updateTooltip(layer, feature);
          layer.on('click', () => {
            dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
          });
        },
      });

      gj.eachLayer((l) => {
        layerMap.current.set(feature.properties.id, l);
      });
      gj.addTo(map);
    }
  }, [state.features, state.layers, visibleIds, dispatch]);

  // Highlight selected feature
  useEffect(() => {
    if (selectedLayer.current) {
      const prev = selectedLayer.current;
      const feat = (prev as any).feature as GeoJSONFeature | undefined;
      if (feat) applyStyle(prev, feat, false);
      selectedLayer.current = null;
    }

    if (!state.selectedFeatureId) return;

    const layer = layerMap.current.get(state.selectedFeatureId);
    if (layer) {
      const feat = (layer as any).feature as GeoJSONFeature | undefined;
      if (feat) applyStyle(layer, feat, true);
      selectedLayer.current = layer;
    }
  }, [state.selectedFeatureId]);

  // Sync feature property changes to existing layers
  const prevFeaturesRef = useRef(state.features);
  useEffect(() => {
    const prevMap = new Map(
      prevFeaturesRef.current.map((f) => [f.properties.id, f]),
    );
    for (const f of state.features) {
      const prev = prevMap.get(f.properties.id);
      if (
        prev &&
        (prev.properties.color !== f.properties.color ||
          prev.properties.name !== f.properties.name ||
          prev.properties.layerId !== f.properties.layerId)
      ) {
        const layer = layerMap.current.get(f.properties.id);
        if (layer) {
          const isSelected = f.properties.id === state.selectedFeatureId;
          applyStyle(layer, f, isSelected);
          (layer as any).feature = f;
          updateTooltip(layer, f);
        }
      }
    }
    prevFeaturesRef.current = state.features;
  }, [state.features, state.selectedFeatureId]);

  // Expose controls for Toolbar
  const enableDraw = useCallback(
    (shape: string) => {
      mapRef.current?.pm.enableDraw(shape as any);
    },
    [],
  );

  const disableDraw = useCallback(() => {
    mapRef.current?.pm.disableDraw();
  }, []);

  const enableEdit = useCallback(() => {
    mapRef.current?.pm.enableGlobalEditMode();
  }, []);

  const disableEdit = useCallback(() => {
    mapRef.current?.pm.disableGlobalEditMode();
  }, []);

  const enableRemoval = useCallback(() => {
    mapRef.current?.pm.enableGlobalRemovalMode();
  }, []);

  const disableRemoval = useCallback(() => {
    mapRef.current?.pm.disableGlobalRemovalMode();
  }, []);

  useEffect(() => {
    (window as any).__webgis = {
      enableDraw,
      disableDraw,
      enableEdit,
      disableEdit,
      enableRemoval,
      disableRemoval,
    };
    return () => {
      delete (window as any).__webgis;
    };
  }, [enableDraw, disableDraw, enableEdit, disableEdit, enableRemoval, disableRemoval]);

  return (
    <div id="map-container">
      <div ref={mapContainerRef} className="leaflet-map-root" />
    </div>
  );
}
