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
  fillColor: string;
  fillEnabled: boolean;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  shapeType: 'Marker' | 'Line' | 'Polygon' | 'Rectangle';
  layerId: string;
  parcelCode?: string;
  parcelIndex?: number;
  parcelGroup?: string;
  parcelAreaMu?: number;
  parcelAreaSquareMeters?: number;
  parcelConfidence?: number;
  pixelArea?: number;
  areaApproximate?: boolean;
  pixelPolygon?: number[][];
  parcelRole?: 'parcel' | 'boundary';
  source?: string;
  farmlandId?: string;
}

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: FeatureProperties;
}

export interface TrainingMapDraft {
  imageUrl: string;
  sourceType?: 'amap' | 'local';
  amapCenter: [number, number];
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  zoom: number;
  sourceName: string;
  createdAt: number;
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
  customBasemap?: CustomBasemapInput | null;
}

export type BasemapKey = 'offline' | 'osm' | 'amap' | 'amap_sat' | 'amap_hybrid' | 'google' | 'google_sat' | 'google_hybrid' | 'esri_sat';

export const CUSTOM_BASEMAP_KEY = '__custom__';

export interface BasemapConfig {
  key: string;
  name: string;
  url: string;
  subdomains?: string[];
  attribution: string;
  maxZoom?: number;
  overlayUrl?: string;
  overlaySubdomains?: string[];
  overlayOpacity?: number;
  wgs2gcj?: boolean;
}

export interface CustomBasemapInput {
  name: string;
  url: string;
  attribution?: string;
  maxZoom?: number;
}
