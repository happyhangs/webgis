import { useEffect, useRef } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { getBasemapConfig } from '../basemaps';
import { gcj2wgs, shiftFeatureCoords } from '../utils/coord';
import {
  WEB_MERCATOR_WORLD_BOUNDS,
  buildFeature,
  applyStyle,
  clearLayerTooltip,
  emitFeatureClick,
  getOverlayTileLayerOptions,
  getTileLayerOptions,
} from '../utils/mapHelpers';
import type { GeoJSONFeature, MapViewState } from '../types';
import type { Action } from '../AppContext';

export function useMapInit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  mapView: MapViewState,
  basemap: string,
  basemapRef: React.MutableRefObject<string>,
  currentLayerIdRef: React.MutableRefObject<string>,
  dispatch: React.Dispatch<Action>,
  initializedRef: React.MutableRefObject<boolean>,
  layerMapRef: React.MutableRefObject<Map<string, L.Layer>>,
  selectedLayerRef: React.MutableRefObject<L.Layer | null>,
  tileLayerRef: React.MutableRefObject<L.TileLayer | null>,
  overlayTileRef: React.MutableRefObject<L.TileLayer | null>,
): React.RefObject<L.Map | null> {
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = L.map(containerRef.current, {
      center: mapView.center,
      zoom: mapView.zoom,
      zoomControl: true,
      zoomAnimation: true,
      fadeAnimation: false,
      markerZoomAnimation: true,
      preferCanvas: true,
      wheelDebounceTime: 80,
      wheelPxPerZoomLevel: 100,
      minZoom: 1,
      maxBounds: WEB_MERCATOR_WORLD_BOUNDS,
      maxBoundsViscosity: 0.8,
      worldCopyJump: false,
    });

    const cfg = getBasemapConfig(basemap);
    const tileLayer = L.tileLayer(cfg.url, getTileLayerOptions(cfg)).addTo(map);
    tileLayerRef.current = tileLayer;
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    if (cfg.overlayUrl) {
      const ol = L.tileLayer(cfg.overlayUrl, getOverlayTileLayerOptions(cfg)).addTo(map);
      overlayTileRef.current = ol;
    }

    // --- Geoman event handlers ---

    map.on('pm:create', (e: any) => {
      const layer = e.layer;
      let geojson = layer.toGeoJSON();
      if (getBasemapConfig(basemapRef.current).wgs2gcj) {
        geojson = shiftFeatureCoords(geojson, gcj2wgs);
      }
      const feature = buildFeature(geojson, e.shape, currentLayerIdRef.current);
      layer.feature = feature;
      applyStyle(layer, feature, false);
      clearLayerTooltip(layer);
      layerMapRef.current.set(feature.properties.id, layer);

      layer.on('click', () => {
        emitFeatureClick(feature);
        dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
      });

      dispatch({ type: 'ADD_FEATURE', feature });

    });

    let updateTimer: ReturnType<typeof setTimeout> | null = null;

    map.on('pm:update', (e: any) => {
      const layer = e.layer;
      const feature = layer.feature as GeoJSONFeature | undefined;
      if (!feature) return;
      let geojson = layer.toGeoJSON() as GeoJSONFeature;
      if (getBasemapConfig(basemapRef.current).wgs2gcj) {
        geojson = shiftFeatureCoords(geojson, gcj2wgs);
      }
      const updated = {
        ...geojson,
        properties: { ...feature.properties },
      };
      layer.feature = updated;
      clearLayerTooltip(layer);

      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        dispatch({ type: 'UPDATE_FEATURE_GEOMETRY', feature: updated });
      }, 200);
    });

    map.on('pm:remove', (e: any) => {
      const feature = e.layer.feature as GeoJSONFeature | undefined;
      if (feature) {
        layerMapRef.current.delete(feature.properties.id);
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
      layerMapRef.current.clear();
      selectedLayerRef.current = null;
      initializedRef.current = false;
      tileLayerRef.current = null;
      overlayTileRef.current = null;
      mapRef.current = null;
    };
    // Mount-only effect: initializes the Leaflet map once on component mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return mapRef;
}
