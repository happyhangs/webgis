import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { GeoJSONFeature, MapViewState, Layer, CustomBasemapInput } from './types';
import { DEFAULT_BASEMAP, normalizeBasemapKey, saveCustomBasemap } from './basemaps';
import { loadRemoteState, loadState, saveRemoteState, saveState } from './store';

const DEFAULT_LAYER_ID = '__default__';

interface AppState {
  layers: Layer[];
  features: GeoJSONFeature[];
  selectedFeatureId: string | null;
  currentLayerId: string;
  mapView: MapViewState;
  basemap: string;
  customBasemap: CustomBasemapInput | null;
  /** 主页面标注模式（临时状态，不随快照持久化；进入训练中心/地图卸载时退出）。 */
  labelMode: boolean;
}

export type Action =
  | { type: 'SET_ALL'; layers: Layer[]; features: GeoJSONFeature[]; mapView: MapViewState; basemap: string; customBasemap?: CustomBasemapInput | null }
  | { type: 'SET_FEATURES'; features: GeoJSONFeature[] }
  | { type: 'ADD_FEATURE'; feature: GeoJSONFeature }
  | { type: 'UPDATE_FEATURE'; id: string; updates: Partial<GeoJSONFeature['properties']> }
  | { type: 'UPDATE_FEATURE_GEOMETRY'; feature: GeoJSONFeature }
  | { type: 'DELETE_FEATURE'; id: string }
  | { type: 'SELECT_FEATURE'; id: string | null }
  | { type: 'SET_MAP_VIEW'; center: [number, number]; zoom: number }
  | { type: 'SET_BASEMAP'; basemap: string }
  | { type: 'ADD_LAYER'; layer: Layer }
  | { type: 'DELETE_LAYER'; id: string }
  | { type: 'RENAME_LAYER'; id: string; name: string }
  | { type: 'TOGGLE_LAYER'; id: string }
  | { type: 'SET_CURRENT_LAYER'; id: string }
  | { type: 'MOVE_FEATURE'; featureId: string; layerId: string }
  | { type: 'COPY_FEATURE'; featureId: string; layerId: string }
  | { type: 'BATCH_ADD_FEATURES'; features: GeoJSONFeature[] }
  | { type: 'CLEAR_LAYER_FEATURES'; layerId: string }
  | { type: 'SET_LABEL_MODE'; on: boolean }
  | { type: 'SET_CUSTOM_BASEMAP'; customBasemap: CustomBasemapInput | null };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ALL':
      return {
        ...state,
        layers: action.layers,
        features: action.features,
        mapView: action.mapView,
        basemap: normalizeBasemapKey(action.basemap),
        customBasemap: action.customBasemap ?? null,
        currentLayerId: action.layers[0]?.id || DEFAULT_LAYER_ID,
      };

    case 'SET_FEATURES':
      return { ...state, features: action.features };

    case 'ADD_FEATURE':
      return { ...state, features: [...state.features, action.feature] };

    case 'UPDATE_FEATURE':
      return {
        ...state,
        features: state.features.map((f) =>
          f.properties.id === action.id
            ? { ...f, properties: { ...f.properties, ...action.updates } }
            : f,
        ),
      };

    case 'UPDATE_FEATURE_GEOMETRY':
      return {
        ...state,
        features: state.features.map((f) =>
          f.properties.id === action.feature.properties.id ? action.feature : f,
        ),
      };

    case 'DELETE_FEATURE':
      return {
        ...state,
        features: state.features.filter((f) => f.properties.id !== action.id),
        selectedFeatureId: state.selectedFeatureId === action.id ? null : state.selectedFeatureId,
      };

    case 'SELECT_FEATURE':
      return { ...state, selectedFeatureId: action.id };

    case 'SET_MAP_VIEW':
      return { ...state, mapView: { center: action.center, zoom: action.zoom } };

    case 'ADD_LAYER':
      return { ...state, layers: [...state.layers, action.layer] };

    case 'DELETE_LAYER': {
      if (action.id === DEFAULT_LAYER_ID) return state; // Cannot delete default
      const newLayers = state.layers.filter((l) => l.id !== action.id);
      const newFeatures = state.features.filter((f) => f.properties.layerId !== action.id);
      return {
        ...state,
        layers: newLayers,
        features: newFeatures,
        selectedFeatureId: null,
        currentLayerId: state.currentLayerId === action.id ? DEFAULT_LAYER_ID : state.currentLayerId,
      };
    }

    case 'RENAME_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.id ? { ...l, name: action.name } : l,
        ),
      };

    case 'TOGGLE_LAYER':
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.id ? { ...l, visible: !l.visible } : l,
        ),
      };

    case 'SET_CURRENT_LAYER':
      return { ...state, currentLayerId: action.id };

    case 'SET_BASEMAP':
      return { ...state, basemap: normalizeBasemapKey(action.basemap) };

    case 'BATCH_ADD_FEATURES':
      return { ...state, features: [...state.features, ...action.features] };

    case 'CLEAR_LAYER_FEATURES':
      return {
        ...state,
        features: state.features.filter((f) => f.properties.layerId !== action.layerId),
        selectedFeatureId: null,
      };

    case 'SET_LABEL_MODE':
      return { ...state, labelMode: action.on };

    case 'MOVE_FEATURE':
      return {
        ...state,
        features: state.features.map((f) =>
          f.properties.id === action.featureId
            ? { ...f, properties: { ...f.properties, layerId: action.layerId } }
            : f,
        ),
      };

    case 'COPY_FEATURE': {
      const source = state.features.find((f) => f.properties.id === action.featureId);
      if (!source) return state;
      const copy: GeoJSONFeature = {
        ...JSON.parse(JSON.stringify(source)),
        properties: {
          ...JSON.parse(JSON.stringify(source.properties)),
          id: crypto.randomUUID(),
          name: `${source.properties.name} (副本)`,
          layerId: action.layerId,
        },
      };
      return { ...state, features: [...state.features, copy] };
    }

    case 'SET_CUSTOM_BASEMAP':
      return { ...state, customBasemap: action.customBasemap };

    default:
      return state;
  }
}

const DEFAULT_CENTER: [number, number] = [39.9042, 116.4074];
const DEFAULT_ZOOM = 10;

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    layers: [{ id: DEFAULT_LAYER_ID, name: '默认图层', visible: true }],
    features: [],
    selectedFeatureId: null,
    currentLayerId: DEFAULT_LAYER_ID,
    mapView: { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
    basemap: DEFAULT_BASEMAP,
    customBasemap: null,
    labelMode: false,
  });

  const restored = useRef(false);
  const readyToPersist = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    const applySaved = (saved: NonNullable<ReturnType<typeof loadState>>) => {
      dispatch({
        type: 'SET_ALL',
        layers: saved.layers,
        features: saved.features,
        mapView: saved.mapView || { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
        basemap: normalizeBasemapKey(saved.basemap),
        customBasemap: saved.customBasemap ?? null,
      });
      if (saved.customBasemap && saved.basemap === '__custom__') {
        saveCustomBasemap(saved.customBasemap);
      }
    };

    const local = loadState();
    if (local) applySaved(local);

    let cancelled = false;
    loadRemoteState()
      .then((remote) => {
        if (cancelled) return;
        if (remote && (!local || (remote.savedAt || 0) >= (local.savedAt || 0))) {
          applySaved(remote);
        } else if (local) {
          saveRemoteState(local);
        }
      })
      .finally(() => {
        if (!cancelled) readyToPersist.current = true;
      });
    return () => { cancelled = true; };
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snapshot = {
        layers: state.layers,
        features: state.features,
        mapView: state.mapView,
        basemap: state.basemap,
        customBasemap: state.customBasemap,
      };
      saveState(snapshot);
      saveRemoteState(snapshot);
    }, 400);
  }, [state.layers, state.features, state.mapView, state.basemap, state.customBasemap]);

  useEffect(() => {
    if (restored.current && readyToPersist.current) persist();
  }, [persist]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

export { DEFAULT_LAYER_ID };
