import { useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppContext } from './AppContext';
import { useMapInit } from './hooks/useMapInit';
import { useMapBasemap } from './hooks/useMapBasemap';
import { useFeatureSync } from './hooks/useFeatureSync';
import { useCoordinateShift } from './hooks/useCoordinateShift';
import { useToolBridge } from './hooks/useToolBridge';
import { setManualLabelLayerId } from './utils/mapHelpers';

export { setManualLabelLayerId };

export default function MapView() {
  const { state, dispatch } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const basemapRef = useRef(state.basemap);
  const currentLayerIdRef = useRef(state.currentLayerId);
  const displayWithGCJRef = useRef(false);

  const layerMapRef = useRef<Map<string, L.Layer>>(new Map());
  const selectedLayerRef = useRef<L.Layer | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayTileRef = useRef<L.TileLayer | null>(null);

  // Keep refs in sync
  basemapRef.current = state.basemap;
  currentLayerIdRef.current = state.currentLayerId;

  // Initialize map (one-shot)
  const mapRef = useMapInit(
    containerRef, state.mapView, state.basemap,
    basemapRef, currentLayerIdRef, dispatch,
    initializedRef, layerMapRef, selectedLayerRef,
    tileLayerRef, overlayTileRef,
  );

  // Basemap switching
  useMapBasemap(mapRef, state.basemap, tileLayerRef, overlayTileRef);

  // Coordinate shift when basemap toggles GCJ/WGS
  useCoordinateShift(mapRef, state.basemap, layerMapRef, displayWithGCJRef);

  // Feature render sync: state → map layers
  useFeatureSync(
    mapRef, state.features, state.layers, state.basemap,
    state.selectedFeatureId, layerMapRef, selectedLayerRef, dispatch,
  );

  // Tool bridge (window.__webgis)
  useToolBridge(mapRef, state.basemap, layerMapRef, currentLayerIdRef);

  return (
    <div id="map-container">
      <div ref={containerRef} className="leaflet-map-root" />
    </div>
  );
}
