import { useEffect } from 'react';
import L from 'leaflet';
import { getBasemapConfig as getCfg } from '../basemaps';
import { getOverlayTileLayerOptions, getTileLayerOptions } from '../utils/mapHelpers';

/**
 * Switch basemap tile layers.
 */
export function useMapBasemap(
  mapRef: React.RefObject<L.Map | null>,
  basemap: string,
  tileLayerRef: React.MutableRefObject<L.TileLayer | null>,
  overlayTileRef: React.MutableRefObject<L.TileLayer | null>,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = getCfg(basemap);

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    if (overlayTileRef.current) map.removeLayer(overlayTileRef.current);

    const tl = L.tileLayer(cfg.url, getTileLayerOptions(cfg)).addTo(map);
    tileLayerRef.current = tl;

    if (cfg.overlayUrl) {
      const ol = L.tileLayer(cfg.overlayUrl, getOverlayTileLayerOptions(cfg)).addTo(map);
      overlayTileRef.current = ol;
    }
  }, [basemap, mapRef, overlayTileRef, tileLayerRef]);
}
