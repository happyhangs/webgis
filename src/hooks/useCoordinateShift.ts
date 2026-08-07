import { useEffect } from 'react';
import L from 'leaflet';
import { getBasemapConfig } from '../basemaps';
import { wgs2gcj, gcj2wgs, shiftFeatureCoords } from '../utils/coord';

export function useCoordinateShift(
  _mapRef: React.RefObject<L.Map | null>,
  basemap: string,
  layerMapRef: React.RefObject<Map<string, L.Layer>>,
  displayWithGCJRef: React.MutableRefObject<boolean>,
) {
  useEffect(() => {
    const needGCJ = getBasemapConfig(basemap).wgs2gcj === true;
    if (displayWithGCJRef.current === needGCJ) return;
    const fn = needGCJ ? wgs2gcj : gcj2wgs;
    const layerMap = layerMapRef.current!;
    for (const [, layer] of layerMap) {
      try {
        shiftLayerCoords(layer, fn);
        const feat = (layer as any).feature;
        if (feat) {
          (layer as any).feature = shiftFeatureCoords(feat, fn);
        }
      } catch {
        // Keep map usable if a single geometry is malformed
      }
    }
    displayWithGCJRef.current = needGCJ;
  }, [basemap, displayWithGCJRef, layerMapRef]);
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
