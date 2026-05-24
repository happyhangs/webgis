import { PersistedState } from './types';
import { normalizeBasemapKey } from './basemaps';

const STORAGE_KEY = 'webgis_state';

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedState>;

    // Migrate old format (features without layerId)
    const defaultLayer = { id: '__default__', name: '默认图层', visible: true };
    const layers = data.layers?.length ? data.layers : [defaultLayer];
    const features = (data.features || []).map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        layerId: f.properties.layerId || '__default__',
      },
    }));

    return {
      layers,
      features,
      basemap: normalizeBasemapKey(data.basemap),
      mapView: data.mapView || { center: [39.9042, 116.4074], zoom: 10 },
    };
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}
