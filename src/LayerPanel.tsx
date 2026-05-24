import { useState, useRef } from 'react';
import {
  MapPin,
  Minus,
  Hexagon,
  Square,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Layers,
  Check,
  Pencil,
  Database,
  Loader2,
} from 'lucide-react';
import { useAppContext, DEFAULT_LAYER_ID } from './AppContext';
import { BUILTIN_LAYERS, BUILTIN_CATEGORIES, fetchBuiltinLayer } from './utils/builtin';
import type { GeoJSONFeature, Layer } from './types';

const shapeIcon = (shapeType: string) => {
  switch (shapeType) {
    case 'Marker':
      return <MapPin size={13} />;
    case 'Line':
      return <Minus size={13} />;
    case 'Polygon':
      return <Hexagon size={13} />;
    case 'Rectangle':
      return <Square size={13} />;
    default:
      return null;
  }
};

export default function LayerPanel() {
  const { state, dispatch } = useAppContext();
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
    () => new Set(state.layers.map((l) => l.id)),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [loadingBuiltin, setLoadingBuiltin] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const toggleExpand = (id: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddLayer = () => {
    const layer: Layer = {
      id: crypto.randomUUID(),
      name: `图层 ${state.layers.length + 1}`,
      visible: true,
    };
    dispatch({ type: 'ADD_LAYER', layer });
    setExpandedLayers((prev) => new Set(prev).add(layer.id));
  };

  const handleRename = (id: string, name: string) => {
    dispatch({ type: 'RENAME_LAYER', id, name });
    setRenamingId(null);
  };

  const startRename = (id: string) => {
    setRenamingId(id);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const handleLoadBuiltin = async (def: (typeof BUILTIN_LAYERS)[0]) => {
    setLoadingBuiltin(def.key);
    try {
      const layerId = crypto.randomUUID();
      const features = await fetchBuiltinLayer(def, layerId);
      dispatch({
        type: 'ADD_LAYER',
        layer: { id: layerId, name: def.name, visible: true },
      });
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      setExpandedLayers((prev) => new Set(prev).add(layerId));
    } catch {
      alert(`加载 ${def.name} 失败`);
    } finally {
      setLoadingBuiltin(null);
    }
  };

  const selectedId = state.selectedFeatureId;

  const featuresByLayer = new Map<string, GeoJSONFeature[]>();
  for (const layer of state.layers) {
    featuresByLayer.set(layer.id, []);
  }
  for (const f of state.features) {
    const arr = featuresByLayer.get(f.properties.layerId);
    if (arr) arr.push(f);
    else featuresByLayer.set(f.properties.layerId, [f]);
  }

  return (
    <div className="panel layer-panel">
      <div className="panel-header">
        <Layers size={15} />
        <span>图层</span>
        <button className="panel-header-btn" onClick={handleAddLayer} title="新建图层">
          <Plus size={15} />
        </button>
      </div>
      <div className="panel-body">
        {state.layers.length === 0 && (
          <div className="panel-empty">暂无图层，点击 + 新建。</div>
        )}

        {state.layers.map((layer: Layer) => {
          const expanded = expandedLayers.has(layer.id);
          const features = featuresByLayer.get(layer.id) || [];
          const isActive = state.currentLayerId === layer.id;
          const isDefault = layer.id === DEFAULT_LAYER_ID;

          return (
            <div key={layer.id} className={`layer-group ${isActive ? 'active' : ''}`}>
              <div className="layer-header">
                <button
                  className="layer-chevron"
                  onClick={() => toggleExpand(layer.id)}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>

                <button
                  className={`layer-visibility ${!layer.visible ? 'off' : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_LAYER', id: layer.id })}
                  title={layer.visible ? '隐藏' : '显示'}
                >
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>

                {renamingId === layer.id ? (
                  <input
                    ref={renameInputRef}
                    className="layer-rename-input"
                    defaultValue={layer.name}
                    onBlur={(e) => handleRename(layer.id, e.target.value || layer.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')
                        handleRename(
                          layer.id,
                          (e.target as HTMLInputElement).value || layer.name,
                        );
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="layer-title"
                    onClick={() =>
                      dispatch({ type: 'SET_CURRENT_LAYER', id: layer.id })
                    }
                    title={isActive ? '当前绘制图层' : '设为当前图层'}
                  >
                    {layer.name}
                  </span>
                )}

                <span className="layer-count">{features.length}</span>

                {isActive && <Check size={13} className="layer-active-mark" />}

                <button
                  className="layer-action-btn"
                  title="重命名"
                  onClick={() => startRename(layer.id)}
                >
                  <Pencil size={12} />
                </button>

                {!isDefault && (
                  <button
                    className="layer-action-btn danger"
                    title="删除图层"
                    onClick={() => {
                      if (confirm(`确定删除图层「${layer.name}」？所含标注将移至默认图层。`)) {
                        dispatch({ type: 'DELETE_LAYER', id: layer.id });
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              {expanded && (
                <div className="layer-features">
                  {features.length === 0 && (
                    <div className="layer-empty-hint">空图层 — 在此绘制标注</div>
                  )}
                  {features.map((f: GeoJSONFeature) => (
                    <div
                      key={f.properties.id}
                      className={`layer-item ${selectedId === f.properties.id ? 'selected' : ''}`}
                      onClick={() =>
                        dispatch({
                          type: 'SELECT_FEATURE',
                          id: selectedId === f.properties.id ? null : f.properties.id,
                        })
                      }
                    >
                      <span
                        className="layer-color"
                        style={{ backgroundColor: f.properties.color }}
                      />
                      <span className="layer-icon">{shapeIcon(f.properties.shapeType)}</span>
                      <span className="layer-name">{f.properties.name}</span>
                      <span className="layer-type">{f.properties.shapeType}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Built-in data section */}
        <div className="builtin-section">
          <div className="builtin-header">
            <Database size={13} />
            <span>内置数据</span>
          </div>
          {BUILTIN_CATEGORIES.map((cat) => {
            const catLayers = BUILTIN_LAYERS.filter((d) => d.category === cat.key);
            if (catLayers.length === 0) return null;
            return (
              <div key={cat.key} className="builtin-cat">
                <div className="builtin-cat-label">{cat.label}</div>
                {catLayers.map((def) => {
                  const loading = loadingBuiltin === def.key;
                  const alreadyLoaded = state.layers.some((l) => l.name === def.name);
                  return (
                    <div
                      key={def.key}
                      className={`builtin-item ${alreadyLoaded ? 'loaded' : ''}`}
                      onClick={() => {
                        if (!alreadyLoaded && !loading) handleLoadBuiltin(def);
                      }}
                      title={alreadyLoaded ? '已加载' : `点击加载 (${def.size})`}
                    >
                      <span
                        className="builtin-color"
                        style={{ backgroundColor: def.color }}
                      />
                      <span className="builtin-name">{def.name}</span>
                      <span className="builtin-size">{def.size}</span>
                      {loading && <Loader2 size={11} className="builtin-spinner" />}
                      {alreadyLoaded && <span className="builtin-done">✓</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
