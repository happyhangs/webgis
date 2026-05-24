export interface Layer {
  id: string;
  name: string;
  visible: boolean;
}

export interface FeatureProperties {
  id: string;
  name: string;
  description: string;
  color: string;
  shapeType: 'Marker' | 'Line' | 'Polygon' | 'Rectangle';
  layerId: string;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: FeatureProperties;
}

export interface MapViewState {
  center: [number, number];
  zoom: number;
}

export interface PersistedState {
  layers: Layer[];
  features: GeoJSONFeature[];
  mapView: MapViewState;
  basemap: string;
}

export type BasemapKey = 'osm' | 'amap' | 'amap_sat' | 'google' | 'google_sat';

export interface BasemapConfig {
  key: BasemapKey;
  name: string;
  url: string;
  subdomains?: string[];
  attribution: string;
}
