import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { useAppContext } from '../AppContext';
import { getBasemapConfig } from '../basemaps';
import { wgs2gcj, gcj2wgs, shiftFeatureCoords } from '../utils/coord';
import {
  AMAP_STATIC_SIZE,
  WEB_MERCATOR_TILE_SIZE,
  lngLatToWorldPixel,
  normalizeAmapStaticZoom,
  staticAmapBoundsToWgs,
} from '../utils/amapStatic';
import type { GeoJSONFeature } from '../types';
import type { MapAPI, MapViewSnapshot, ViewBounds } from '../utils/mapAPI';
import { buildFeature, emitFeatureClick } from '../utils/mapHelpers';

const FEATURE_ZOOM_100M = 16;
const FEATURE_ZOOM_50M = 17;
const FEATURE_FLY_OPTIONS = { duration: 0.65, easeLinearity: 0.25 };
const FAST_EDIT_OPTIONS = {
  snappable: false,
  snapMiddle: false,
  syncLayersOnDrag: false,
  limitMarkersToViewport: true,
  hideMiddleMarkers: true,
  pinning: false,
};
const REGION_SELECT_STYLE = {
  color: '#0a84ff',
  weight: 2,
  dashArray: '6 6',
  fillColor: '#0a84ff',
  fillOpacity: 0.12,
};

export function useToolBridge(
  mapRef: React.RefObject<L.Map | null>,
  basemap: string,
  layerMapRef: React.RefObject<Map<string, L.Layer>>,
  currentLayerIdRef: React.MutableRefObject<string>,
) {
  const { dispatch } = useAppContext();
  const trainingImageRef = useRef<L.ImageOverlay | null>(null);
  const trainingImageDataRef = useRef<{ url: string; bounds: ViewBounds } | null>(null);

  const enableDraw = useCallback(
    (shape: string, options: { snappable?: boolean; snapMiddle?: boolean } = {}) => {
      mapRef.current?.pm.enableDraw(shape as any, { continueDrawing: true, ...options });
    },
    [],
  );

  const disableDraw = useCallback(() => { mapRef.current?.pm.disableDraw(); }, []);

  const enableEdit = useCallback(() => {
    const layer = (window as any).__webgis_selectedLayer;
    if (layer) { (layer as any).pm.enable(FAST_EDIT_OPTIONS); }
  }, []);

  const disableEdit = useCallback(() => {
    const layer = (window as any).__webgis_selectedLayer;
    if (layer) { (layer as any).pm.disable(); }
  }, []);

  const enableRemoval = useCallback(() => { mapRef.current?.pm.enableGlobalRemovalMode(); }, []);
  const disableRemoval = useCallback(() => { mapRef.current?.pm.disableGlobalRemovalMode(); }, []);

  const flyTo = useCallback((lat: number, lng: number, zoom = 14) => {
    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
    const displayLat = needGCJ ? wgs2gcj(lat, lng)[0] : lat;
    const displayLng = needGCJ ? wgs2gcj(lat, lng)[1] : lng;
    mapRef.current?.flyTo([displayLat, displayLng], zoom, { duration: 1.5 });
  }, [basemap]);

  const flyToFeature = useCallback((feature: GeoJSONFeature) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
      const displayFeature = needGCJ ? shiftFeatureCoords(feature, wgs2gcj) : feature;
      const gj = L.geoJSON(displayFeature as any);
      const bounds = gj.getBounds();
      if (bounds.isValid()) {
        if (feature.properties.shapeType === 'Marker') {
          map.flyTo(bounds.getCenter(), FEATURE_ZOOM_50M, FEATURE_FLY_OPTIONS);
          return;
        }
        map.flyToBounds(bounds, {
          padding: [40, 40],
          maxZoom: FEATURE_ZOOM_100M,
          ...FEATURE_FLY_OPTIONS,
        });
      }
    } catch { /* ignore */ }
  }, [basemap]);

  const flyToBounds = useCallback((target: ViewBounds) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
      // wgs2gcj 返回 [lat, lng]，对角点分别换算后取包络足够定位用途
      const corners: Array<[number, number]> = [
        [target.west, target.south],
        [target.west, target.north],
        [target.east, target.south],
        [target.east, target.north],
      ];
      const shifted = corners.map(([lng, lat]) =>
        needGCJ ? (wgs2gcj(lat, lng) as [number, number]) : ([lat, lng] as [number, number]),
      );
      const lats = shifted.map(([lat]) => lat);
      const lngs = shifted.map(([, lng]) => lng);
      map.flyToBounds(
        L.latLngBounds(
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ),
        { padding: [40, 40], maxZoom: FEATURE_ZOOM_100M, ...FEATURE_FLY_OPTIONS },
      );
    } catch { /* ignore */ }
  }, [basemap]);

  const placeMarker = useCallback((lat: number, lng: number, name: string) => {
    const map = mapRef.current;
    if (!map) return;
    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
    const isGeolocation = name.includes('我的位置');
    const inputIsGCJ = !isGeolocation && needGCJ;

    let storeLat = lat;
    let storeLng = lng;
    if (inputIsGCJ) { [storeLat, storeLng] = gcj2wgs(lat, lng); }

    let displayLat = storeLat;
    let displayLng = storeLng;
    if (needGCJ) { [displayLat, displayLng] = wgs2gcj(storeLat, storeLng); }

    const feature = buildFeature(
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [storeLng, storeLat] } },
      'Marker',
      currentLayerIdRef.current,
    );
    feature.properties.name = name;
    feature.properties.color = '#e63946';
    feature.properties.fillColor = '#e63946';
    const marker = L.circleMarker([displayLat, displayLng], {
      radius: 10, fillColor: '#e63946', color: '#fff', weight: 3, fillOpacity: 0.9,
    }).addTo(map);
    (marker as any).feature = feature;
    marker.on('click', () => {
      emitFeatureClick(feature);
      dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
    });
    layerMapRef.current!.set(feature.properties.id, marker);
    dispatch({ type: 'ADD_FEATURE', feature });
  }, [dispatch, basemap, currentLayerIdRef, layerMapRef]);

  const snapshotFromAmap = useCallback((amapCenter: [number, number], zoom: number): MapViewSnapshot => {
    const staticZoom = normalizeAmapStaticZoom(zoom);
    return {
      amapCenter,
      zoom: staticZoom,
      bounds: staticAmapBoundsToWgs(amapCenter, staticZoom),
    };
  }, []);

  const getMapSnapshot = useCallback((): MapViewSnapshot | null => {
    const map = mapRef.current;
    if (!map) return null;
    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
    const center = map.getCenter();
    const zoom = normalizeAmapStaticZoom(map.getZoom());
    const [amapLat, amapLng] = needGCJ
      ? [center.lat, center.lng]
      : wgs2gcj(center.lat, center.lng);
    return snapshotFromAmap([amapLng, amapLat], zoom);
  }, [basemap, snapshotFromAmap]);

  const selectMapSnapshot = useCallback((): Promise<MapViewSnapshot | null> => {
    const map = mapRef.current;
    if (!map) return Promise.resolve(null);
    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
    const container = map.getContainer();

    return new Promise((resolve) => {
      let start: L.LatLng | null = null;
      let rectangle: L.Rectangle | null = null;
      let done = false;
      const draggingWasEnabled = map.dragging.enabled();

      const cleanup = () => {
        map.off('mousedown', onDown);
        map.off('mousemove', onMove);
        map.off('mouseup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        container.classList.remove('map-region-selecting');
        if (rectangle) rectangle.remove();
        if (draggingWasEnabled) map.dragging.enable();
      };

      const finish = (snapshot: MapViewSnapshot | null) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(snapshot);
      };

      const onDown = (event: L.LeafletMouseEvent) => {
        if (event.originalEvent.button !== 0) return;
        start = event.latlng;
        if (draggingWasEnabled) map.dragging.disable();
        rectangle = L.rectangle(L.latLngBounds(start, start), REGION_SELECT_STYLE).addTo(map);
      };

      const onMove = (event: L.LeafletMouseEvent) => {
        if (!start || !rectangle) return;
        rectangle.setBounds(L.latLngBounds(start, event.latlng));
      };

      const onUp = (event: L.LeafletMouseEvent) => {
        if (!start) return finish(null);
        const selected = L.latLngBounds(start, event.latlng);
        if (!selected.isValid()) return finish(null);
        const center = selected.getCenter();
        const selectionBounds = needGCJ ? boundsToWgs(selected) : latLngBoundsToViewBounds(selected);
        const amapCenter = needGCJ
          ? [center.lng, center.lat] as [number, number]
          : (() => {
              const [lat, lng] = wgs2gcj(center.lat, center.lng);
              return [lng, lat] as [number, number];
            })();
        const amapBounds = needGCJ ? selected : boundsToGcj(selected);
        finish({
          ...snapshotFromAmap(amapCenter, zoomForStaticBounds(amapBounds)),
          selectionBounds,
        });
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') finish(null);
      };

      container.classList.add('map-region-selecting');
      map.on('mousedown', onDown);
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
      window.addEventListener('keydown', onKeyDown);
    });
  }, [basemap, snapshotFromAmap]);

  const renderTrainingImage = useCallback(() => {
    const map = mapRef.current;
    const data = trainingImageDataRef.current;
    if (!map || !data) return;
    trainingImageRef.current?.remove();
    const displayBounds = viewBoundsToLeaflet(data.bounds, getBasemapConfig(basemap).wgs2gcj === true);
    trainingImageRef.current = L.imageOverlay(data.url, displayBounds, {
      opacity: 0.78,
      interactive: false,
      className: 'training-image-overlay',
    }).addTo(map);
    trainingImageRef.current.bringToFront();
  }, [basemap, mapRef]);

  const showTrainingImage = useCallback((url: string, bounds: ViewBounds) => {
    trainingImageDataRef.current = { url, bounds };
    renderTrainingImage();
    mapRef.current?.fitBounds(viewBoundsToLeaflet(bounds, getBasemapConfig(basemap).wgs2gcj === true), {
      padding: [30, 30],
    });
  }, [basemap, mapRef, renderTrainingImage]);

  const clearTrainingImage = useCallback(() => {
    trainingImageRef.current?.remove();
    trainingImageRef.current = null;
    trainingImageDataRef.current = null;
  }, []);

  useEffect(() => {
    if (trainingImageDataRef.current) renderTrainingImage();
  }, [basemap, renderTrainingImage]);

  useEffect(() => {
    const api: MapAPI = {
      enableDraw, disableDraw, enableEdit, disableEdit,
      enableRemoval, disableRemoval, flyTo, flyToFeature, flyToBounds, placeMarker,
      getMapSnapshot, selectMapSnapshot, showTrainingImage, clearTrainingImage,
    };
    (window as any).__webgis = api;
    return () => {
      delete (window as any).__webgis;
      delete (window as any).__webgis_selectedLayer;
      trainingImageRef.current?.remove();
    };
  }, [enableDraw, disableDraw, enableEdit, disableEdit,
      enableRemoval, disableRemoval, flyTo, flyToFeature, flyToBounds, placeMarker, getMapSnapshot, selectMapSnapshot,
      showTrainingImage, clearTrainingImage]);
}

function viewBoundsToLeaflet(bounds: ViewBounds, needGCJ: boolean): L.LatLngBounds {
  if (!needGCJ) return L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
  const corners = [
    wgs2gcj(bounds.south, bounds.west),
    wgs2gcj(bounds.north, bounds.east),
  ];
  return L.latLngBounds(corners[0], corners[1]);
}

function boundsToGcj(bounds: L.LatLngBounds): L.LatLngBounds {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const [south, west] = wgs2gcj(sw.lat, sw.lng);
  const [north, east] = wgs2gcj(ne.lat, ne.lng);
  return L.latLngBounds([south, west], [north, east]);
}

function boundsToWgs(bounds: L.LatLngBounds): ViewBounds {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const nw = L.latLng(ne.lat, sw.lng);
  const se = L.latLng(sw.lat, ne.lng);
  const corners = [sw, nw, ne, se].map((point) => gcj2wgs(point.lat, point.lng));
  const lats = corners.map(([lat]) => lat);
  const lngs = corners.map(([, lng]) => lng);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function latLngBoundsToViewBounds(bounds: L.LatLngBounds): ViewBounds {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return {
    west: Math.min(sw.lng, ne.lng),
    south: Math.min(sw.lat, ne.lat),
    east: Math.max(sw.lng, ne.lng),
    north: Math.max(sw.lat, ne.lat),
  };
}

function zoomForStaticBounds(bounds: L.LatLngBounds): number {
  const scale = WEB_MERCATOR_TILE_SIZE;
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const a = lngLatToWorldPixel(sw.lng, sw.lat, scale);
  const b = lngLatToWorldPixel(ne.lng, ne.lat, scale);
  const span = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1e-9);
  return normalizeAmapStaticZoom(Math.floor(Math.log2((AMAP_STATIC_SIZE * 0.9) / span)));
}
