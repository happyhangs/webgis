import { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { GeoJSONFeature, MapViewState, Layer } from './types';
import { DEFAULT_BASEMAP, normalizeBasemapKey } from './basemaps';
import { loadState, saveState } from './store';

const DEFAULT_LAYER_ID = '__default__';

interface AppState {
  layers: Layer[];
  features: GeoJSONFeature[];
  selectedFeatureId: string | null;
  currentLayerId: string;
  mapView: MapViewState;
  basemap: string;
}

type Action =
  | { type: 'SET_ALL'; layers: Layer[]; features: GeoJSONFeature[]; mapView: MapViewState; basemap: string }
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
  | { type: 'BATCH_ADD_FEATURES'; features: GeoJSONFeature[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ALL':
      return {
        ...state,
        layers: action.layers,
        features: action.features,
        mapView: action.mapView,
        basemap: normalizeBasemapKey(action.basemap),
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
      const fallbackId = DEFAULT_LAYER_ID;
      // Move orphaned features to default layer
      const newFeatures = state.features.map((f) =>
        f.properties.layerId === action.id
          ? { ...f, properties: { ...f.properties, layerId: fallbackId } }
          : f,
      );
      return {
        ...state,
        layers: newLayers,
        features: newFeatures,
        currentLayerId: state.currentLayerId === action.id ? fallbackId : state.currentLayerId,
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

    case 'MOVE_FEATURE':
      return {
        ...state,
        features: state.features.map((f) =>
          f.properties.id === action.featureId
            ? { ...f, properties: { ...f.properties, layerId: action.layerId } }
            : f,
        ),
      };

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
  });

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = loadState();
    if (saved) {
      dispatch({
        type: 'SET_ALL',
        layers: saved.layers,
        features: saved.features,
        mapView: saved.mapView || { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
        basemap: normalizeBasemapKey(saved.basemap),
      });
    }
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveState({
        layers: state.layers,
        features: state.features,
        mapView: state.mapView,
        basemap: state.basemap,
      });
    }, 400);
  }, [state.layers, state.features, state.mapView, state.basemap]);

  useEffect(() => {
    if (restored.current) persist();
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
