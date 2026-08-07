/** Public Map API — typed bridge between React components and Leaflet map */
import type { GeoJSONFeature } from '../types';

export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapViewSnapshot {
  // [lng, lat] in GCJ-02 for the backend Amap static proxy.
  amapCenter: [number, number];
  // Integer zoom used by the backend AMap static image and bounds calculation.
  zoom: number;
  // WGS-84 bounds used to georeference model output before display transforms.
  bounds: ViewBounds;
  // Optional exact user-drawn WGS-84 rectangle. Static map images may include padding.
  selectionBounds?: ViewBounds;
}

export interface MapAPI {
  enableDraw: (shape: string, options?: { snappable?: boolean; snapMiddle?: boolean }) => void;
  disableDraw: () => void;
  enableEdit: () => void;
  disableEdit: () => void;
  enableRemoval: () => void;
  disableRemoval: () => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  flyToFeature: (feature: GeoJSONFeature) => void;
  placeMarker: (lat: number, lng: number, name: string) => void;
  getMapSnapshot: () => MapViewSnapshot | null;
  selectMapSnapshot: () => Promise<MapViewSnapshot | null>;
  showTrainingImage: (url: string, bounds: ViewBounds) => void;
  clearTrainingImage: () => void;
}
