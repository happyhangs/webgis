import { useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import 'leaflet/dist/leaflet.css';
import { useAppContext } from './AppContext';
import { getBasemapConfig } from './basemaps';
import { getFeatureMeasurement } from './utils/measure';
import { wgs2gcj, gcj2wgs } from './utils/coord';
import { getDashArray, getDefaultFeatureStyle, isAreaShape } from './utils/featureStyle';
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
      ...getDefaultFeatureStyle(shapeType as GeoJSONFeature['properties']['shapeType']),
      shapeType: shapeType as GeoJSONFeature['properties']['shapeType'],
      layerId,
    },
  };
}

function applyStyle(layer: any, feature: GeoJSONFeature, selected: boolean) {
  const p = feature.properties;
  if (p.shapeType === 'Marker') {
    layer.setStyle({
      radius: selected ? 10 : 8,
      fillColor: p.color,
      color: selected ? '#ff0' : '#fff',
      weight: selected ? 4 : 2,
      fillOpacity: 0.9,
    });
  } else {
    const weight = selected ? p.strokeWidth + 2 : p.strokeWidth;
    layer.setStyle({
      color: p.color,
      fillColor: p.fillColor,
      weight,
      dashArray: getDashArray(p.strokeStyle, weight),
      lineCap: p.strokeStyle === 'dotted' ? 'round' : 'butt',
      fillOpacity: isAreaShape(p.shapeType) && p.fillEnabled ? (selected ? 0.45 : 0.26) : 0,
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

function shiftCoords(coords: any, fn: (lat: number, lng: number) => [number, number]): any {
  if (typeof coords[0] === 'number') {
    const [lat, lng] = fn(coords[1], coords[0]);
    return [lng, lat];
  }
  return coords.map((c: any) => shiftCoords(c, fn));
}

function shiftFeatureCoords(feature: any, fn: (lat: number, lng: number) => [number, number]): any {
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: shiftCoords(feature.geometry.coordinates, fn),
    },
  };
}

function shiftLayerCoords(layer: L.Layer, fn: (lat: number, lng: number) => [number, number]) {
  if (layer instanceof L.CircleMarker) {
    const ll = layer.getLatLng();
    const [lat, lng] = fn(ll.lat, ll.lng);
    layer.setLatLng([lat, lng]);
  } else if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
    const latlngs = (layer as any).getLatLngs();
    (layer as any).setLatLngs(shiftLatLngs(latlngs, fn));
  } else if (layer instanceof L.LayerGroup || (layer as any)._layers) {
    const group = layer as any;
    if (group._layers) {
      for (const id of Object.keys(group._layers)) {
        shiftLayerCoords(group._layers[id], fn);
      }
    }
    if (group.eachLayer) {
      group.eachLayer((l: L.Layer) => shiftLayerCoords(l, fn));
    }
  }
}

function shiftLatLngs(latlngs: any, fn: (lat: number, lng: number) => [number, number]): any {
  if (latlngs && typeof latlngs.lat === 'number') {
    const [lat, lng] = fn(latlngs.lat, latlngs.lng);
    return L.latLng(lat, lng);
  }
  if (Array.isArray(latlngs)) {
    return latlngs.map((c: any) => shiftLatLngs(c, fn));
  }
  return latlngs;
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
  const overlayTileRef = useRef<L.TileLayer | null>(null);
  const currentLayerIdRef = useRef(state.currentLayerId);
  const initializedRef = useRef(false);
  const displayWithGCJ = useRef(false); // whether layers currently have GCJ offset applied

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

    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    if (cfg.overlayUrl) {
      const ol = L.tileLayer(cfg.overlayUrl, {
        attribution: '',
        maxZoom: 19,
        subdomains: cfg.overlaySubdomains,
        opacity: cfg.overlayOpacity ?? 0.4,
      }).addTo(map);
      overlayTileRef.current = ol;
    }

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
      overlayTileRef.current = null;
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = getBasemapConfig(state.basemap);

    // Remove old tile layers
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    if (overlayTileRef.current) map.removeLayer(overlayTileRef.current);

    // Add main tile layer
    const tl = L.tileLayer(cfg.url, getTileLayerOptions(cfg)).addTo(map);
    tileLayerRef.current = tl;

    // Add overlay if hybrid
    if (cfg.overlayUrl) {
      const ol = L.tileLayer(cfg.overlayUrl, {
        attribution: '',
        maxZoom: 19,
        subdomains: cfg.overlaySubdomains,
        opacity: cfg.overlayOpacity ?? 0.4,
      }).addTo(map);
      overlayTileRef.current = ol;
    }
  }, [state.basemap]);

  // When basemap toggles between GCJ / WGS, shift all layer coords in-place (no re-render)
  useEffect(() => {
    const needGCJ = getBasemapConfig(state.basemap).wgs2gcj === true;
    if (displayWithGCJ.current === needGCJ) return; // no change
    const fn = needGCJ ? wgs2gcj : gcj2wgs;
    for (const [, layer] of layerMap.current) {
      shiftLayerCoords(layer, fn);
      const feat = (layer as any).feature;
      if (feat) {
        (layer as any).feature = shiftFeatureCoords(feat, fn);
      }
    }
    displayWithGCJ.current = needGCJ;
  }, [state.basemap]);
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
    const needGCJ = getBasemapConfig(state.basemap).wgs2gcj === true;

    for (const feature of state.features) {
      if (!visibleIds.has(feature.properties.layerId)) continue;
      if (layerMap.current.has(feature.properties.id)) continue;

      let displayFeature = { ...feature, geometry: { ...feature.geometry } };
      if (needGCJ) {
        displayFeature = shiftFeatureCoords(displayFeature, wgs2gcj);
      }

      const gj = L.geoJSON(displayFeature as any, {
        pointToLayer: (_f: any, latlng) =>
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
  }, [state.features, state.layers, visibleIds, state.basemap, dispatch]);

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
          prev.properties.fillColor !== f.properties.fillColor ||
          prev.properties.fillEnabled !== f.properties.fillEnabled ||
          prev.properties.strokeStyle !== f.properties.strokeStyle ||
          prev.properties.strokeWidth !== f.properties.strokeWidth ||
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

  // Track which layer is being edited (single-feature edit mode)
  const editingLayerRef = useRef<L.Layer | null>(null);

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
    // Edit only the selected feature, not all features (avoids freeze with large datasets)
    if (editingLayerRef.current) {
      (editingLayerRef.current as any).pm.disable();
      editingLayerRef.current = null;
    }
    const map = mapRef.current;
    if (!map) return;
    // Find feature ID from state via a ref we'll sync
    const layer = (window as any).__webgis_selectedLayer;
    if (layer) {
      (layer as any).pm.enable();
      editingLayerRef.current = layer;
    }
  }, []);

  const disableEdit = useCallback(() => {
    if (editingLayerRef.current) {
      (editingLayerRef.current as any).pm.disable();
      editingLayerRef.current = null;
    }
  }, []);

  const enableRemoval = useCallback(() => {
    mapRef.current?.pm.enableGlobalRemovalMode();
  }, []);

  const disableRemoval = useCallback(() => {
    mapRef.current?.pm.disableGlobalRemovalMode();
  }, []);

  const flyTo = useCallback((lat: number, lng: number, zoom = 14) => {
    mapRef.current?.flyTo([lat, lng], zoom, { duration: 1.5 });
  }, []);

  const flyToFeature = useCallback((feature: GeoJSONFeature) => {
    const map = mapRef.current;
    if (!map) return;
    const needGCJ = getBasemapConfig(state.basemap).wgs2gcj === true;
    const displayFeature = needGCJ ? shiftFeatureCoords(feature, wgs2gcj) : feature;
    const gj = L.geoJSON(displayFeature as any);
    const bounds = gj.getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [50, 50], duration: 1 });
    }
  }, [state.basemap]);

  const placeMarker = useCallback((lat: number, lng: number, name: string) => {
    const map = mapRef.current;
    if (!map) return;
    const feature = buildFeature(
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] } },
      'Marker',
      currentLayerIdRef.current,
    );
    feature.properties.name = name;
    feature.properties.color = '#e63946';
    feature.properties.fillColor = '#e63946';
    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      fillColor: '#e63946',
      color: '#fff',
      weight: 3,
      fillOpacity: 0.9,
    }).addTo(map);
    (marker as any).feature = feature;
    const popupContent = document.createElement('div');
    popupContent.innerHTML = `<b>${name}</b><br>${lat.toFixed(6)}, ${lng.toFixed(6)}<br><a href="#" class="popup-delete" style="color:#c00;font-size:12px;">删除此标记</a>`;
    popupContent.querySelector('.popup-delete')?.addEventListener('click', (e) => {
      e.preventDefault();
      map.removeLayer(marker);
      layerMap.current.delete(feature.properties.id);
      dispatch({ type: 'DELETE_FEATURE', id: feature.properties.id });
    });
    marker.bindPopup(popupContent).openPopup();
    marker.on('click', () => {
      dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
    });
    layerMap.current.set(feature.properties.id, marker);
    dispatch({ type: 'ADD_FEATURE', feature });
  }, [dispatch]);

  // Sync selected layer ref for toolbar access
  useEffect(() => {
    const layer = state.selectedFeatureId
      ? layerMap.current.get(state.selectedFeatureId) || null
      : null;
    (window as any).__webgis_selectedLayer = layer;
  }, [state.selectedFeatureId]);

  useEffect(() => {
    (window as any).__webgis = {
      enableDraw,
      disableDraw,
      enableEdit,
      disableEdit,
      enableRemoval,
      disableRemoval,
      flyTo,
      flyToFeature,
      placeMarker,
    };
    return () => {
      delete (window as any).__webgis;
      delete (window as any).__webgis_selectedLayer;
    };
  }, [enableDraw, disableDraw, enableEdit, disableEdit, enableRemoval, disableRemoval, flyTo, flyToFeature, placeMarker]);

  return (
    <div id="map-container">
      <div ref={mapContainerRef} className="leaflet-map-root" />
    </div>
  );
}
