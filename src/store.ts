import type { FeatureProperties, GeoJSONFeature, Layer, MapViewState, PersistedState, CustomBasemapInput } from './types';
import { normalizeBasemapKey } from './basemaps';
import { normalizeFeatureStyle } from './utils/featureStyle';
import { DEFAULT_BACKEND_URL } from './backendUrl';

const STORAGE_KEY = 'webgis_state';
const DEFAULT_LAYER_ID = '__default__';
const DEFAULT_LAYER: Layer = { id: DEFAULT_LAYER_ID, name: '默认图层', visible: true };
const DEFAULT_MAP_VIEW: MapViewState = { center: [39.9042, 116.4074], zoom: 10 };
type PersistedStatePayload = PersistedState & { savedAt?: number };

export function loadState(): PersistedStatePayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): PersistedStatePayload {
  const payload = { ...state, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — silently ignore
  }
  return payload;
}

export async function loadRemoteState(backendUrl: string = DEFAULT_BACKEND_URL): Promise<PersistedStatePayload | null> {
  try {
    const response = await fetch(`${backendUrl}/state`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeState(data?.state);
  } catch {
    return null;
  }
}

export async function saveRemoteState(state: PersistedState, backendUrl: string = DEFAULT_BACKEND_URL): Promise<void> {
  try {
    await fetch(`${backendUrl}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, savedAt: Date.now() }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Backend can be offline; localStorage remains the fallback.
  }
}

function normalizeState(value: unknown): PersistedStatePayload | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<PersistedStatePayload>;
  const layers = normalizeLayers(data.layers);
  const layerIds = new Set(layers.map((layer) => layer.id));
  const features = normalizeFeatures(data.features, layerIds);

  return {
    layers,
    features,
    basemap: normalizeBasemapKey(data.basemap),
    mapView: normalizeMapView(data.mapView),
    customBasemap: normalizeCustomBasemap(data.customBasemap),
    savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : 0,
  };
}

function normalizeLayers(value: unknown): Layer[] {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const layers: Layer[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const layer = item as Partial<Layer>;
    if (typeof layer.id !== 'string' || !layer.id.trim() || seen.has(layer.id)) continue;
    seen.add(layer.id);
    layers.push({
      id: layer.id,
      name: typeof layer.name === 'string' && layer.name.trim() ? layer.name : '未命名图层',
      visible: layer.visible !== false,
    });
  }

  if (!seen.has(DEFAULT_LAYER_ID)) {
    layers.unshift(DEFAULT_LAYER);
  }
  return layers.length ? layers : [DEFAULT_LAYER];
}

function normalizeFeatures(value: unknown, layerIds: Set<string>): GeoJSONFeature[] {
  const input = Array.isArray(value) ? value : [];
  const features: GeoJSONFeature[] = [];

  for (const item of input) {
    if (!isFeatureLike(item)) continue;
    const props = item.properties && typeof item.properties === 'object'
      ? (item.properties as Partial<FeatureProperties>)
      : {};
    const shapeType = normalizeShapeType(props.shapeType, item.geometry.type);
    const layerId =
      typeof props.layerId === 'string' && layerIds.has(props.layerId)
        ? props.layerId
        : DEFAULT_LAYER_ID;

    features.push({
      ...item,
      type: 'Feature',
      geometry: item.geometry,
      properties: {
        id: typeof props.id === 'string' && props.id ? props.id : crypto.randomUUID(),
        name: typeof props.name === 'string' && props.name ? props.name : defaultFeatureName(shapeType, features.length + 1),
        description: typeof props.description === 'string' ? props.description : '',
        ...normalizeFeatureStyle(props, shapeType),
        ...normalizeParcelProperties(props),
        shapeType,
        layerId,
      },
    });
  }

  return features;
}

function normalizeParcelProperties(
  props: Partial<FeatureProperties>,
): Partial<FeatureProperties> {
  const normalized: Partial<FeatureProperties> = {};
  if (typeof props.parcelCode === 'string' && props.parcelCode.trim()) {
    normalized.parcelCode = props.parcelCode;
  }
  if (typeof props.parcelIndex === 'number' && Number.isFinite(props.parcelIndex)) {
    normalized.parcelIndex = props.parcelIndex;
  }
  if (typeof props.parcelGroup === 'string' && props.parcelGroup.trim()) {
    normalized.parcelGroup = props.parcelGroup;
  }
  if (typeof props.parcelAreaMu === 'number' && Number.isFinite(props.parcelAreaMu)) {
    normalized.parcelAreaMu = props.parcelAreaMu;
  }
  if (
    typeof props.parcelAreaSquareMeters === 'number' &&
    Number.isFinite(props.parcelAreaSquareMeters)
  ) {
    normalized.parcelAreaSquareMeters = props.parcelAreaSquareMeters;
  }
  if (typeof props.parcelConfidence === 'number' && Number.isFinite(props.parcelConfidence)) {
    normalized.parcelConfidence = props.parcelConfidence;
  }
  if (typeof props.pixelArea === 'number' && Number.isFinite(props.pixelArea)) {
    normalized.pixelArea = props.pixelArea;
  }
  if (typeof props.areaApproximate === 'boolean') {
    normalized.areaApproximate = props.areaApproximate;
  }
  if (
    Array.isArray(props.pixelPolygon) &&
    props.pixelPolygon.every((point) =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1])
    )
  ) {
    normalized.pixelPolygon = props.pixelPolygon;
  }
  if (props.parcelRole === 'parcel' || props.parcelRole === 'boundary') {
    normalized.parcelRole = props.parcelRole;
  }
  if (typeof props.source === 'string' && props.source.trim()) {
    normalized.source = props.source;
  }
  return normalized;
}

function isFeatureLike(value: unknown): value is GeoJSONFeature {
  if (!value || typeof value !== 'object') return false;
  const feature = value as Partial<GeoJSONFeature>;
  const geometry = feature.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  return (
    feature.type === 'Feature' &&
    !!geometry &&
    typeof geometry.type === 'string' &&
    coordinatesAreFinite(geometry.coordinates)
  );
}

function coordinatesAreFinite(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (typeof value[0] === 'number' || typeof value[1] === 'number') {
    return (
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]) &&
      Math.abs(value[0]) <= 180 &&
      Math.abs(value[1]) <= 90
    );
  }
  return value.every((child) => coordinatesAreFinite(child));
}

function normalizeShapeType(
  value: unknown,
  geometryType: string,
): FeatureProperties['shapeType'] {
  if (value === 'Marker' || value === 'Line' || value === 'Polygon' || value === 'Rectangle') {
    return value;
  }
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'Marker';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'Line';
  return 'Polygon';
}

function defaultFeatureName(shapeType: FeatureProperties['shapeType'], index: number): string {
  if (shapeType === 'Marker') return `恢复点 ${index}`;
  if (shapeType === 'Line') return `恢复线 ${index}`;
  return `恢复面 ${index}`;
}

function normalizeMapView(value: unknown): MapViewState {
  if (!value || typeof value !== 'object') return DEFAULT_MAP_VIEW;
  const view = value as Partial<MapViewState>;
  const center = Array.isArray(view.center) ? view.center : [];
  const lat = Number(center[0]);
  const lng = Number(center[1]);
  const zoom = Number(view.zoom);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    Number.isFinite(zoom)
  ) {
    return { center: [lat, lng], zoom: Math.min(22, Math.max(1, Math.round(zoom))) };
  }
  return DEFAULT_MAP_VIEW;
}

function normalizeCustomBasemap(value: unknown): CustomBasemapInput | null {
  if (!value || typeof value !== 'object') return null;
  const cfg = value as Partial<CustomBasemapInput>;
  if (typeof cfg.name === 'string' && cfg.name.trim() && typeof cfg.url === 'string' && cfg.url.trim()) {
    return {
      name: cfg.name.trim(),
      url: cfg.url.trim(),
      attribution: typeof cfg.attribution === 'string' ? cfg.attribution : undefined,
      maxZoom: typeof cfg.maxZoom === 'number' && cfg.maxZoom > 0 ? cfg.maxZoom : undefined,
    };
  }
  return null;
}
