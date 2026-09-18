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
  /** 标注模式：连续画地块（Esc 取消当前块后自动继续）。 */
  startLabelDrawing: () => void;
  /** 标注模式：退出画地块。 */
  stopLabelDrawing: () => void;
  /** 标注模式：进入"点错块即删"（只删除标定层要素）。 */
  startLabelRemoval: () => void;
  stopLabelRemoval: () => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  flyToFeature: (feature: GeoJSONFeature) => void;
  /** 按 WGS-84 范围飞行定位（内部按当前底图做 GCJ 偏移换算）。 */
  flyToBounds: (bounds: ViewBounds) => void;
  placeMarker: (lat: number, lng: number, name: string) => void;
  getMapSnapshot: () => MapViewSnapshot | null;
  selectMapSnapshot: () => Promise<MapViewSnapshot | null>;
  showTrainingImage: (url: string, bounds: ViewBounds) => void;
  clearTrainingImage: () => void;
}
