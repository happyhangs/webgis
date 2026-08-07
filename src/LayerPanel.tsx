import { useState, useRef, useEffect } from 'react';
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
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Check,
  Pencil,
  Search,
  Copy,
  Loader2,
  Map as MapIcon,
} from 'lucide-react';
import { useAppContext, DEFAULT_LAYER_ID } from './AppContext';
import type { GeoJSONFeature, Layer } from './types';

interface AdminCityEntry {
  file?: string | null;
  features?: number;
  sizeKb?: number;
}

interface AdminIndexEntry extends AdminCityEntry {
  cities?: string[] | Record<string, AdminCityEntry>;
}

type AdminIndex = Record<string, AdminIndexEntry>;

function normalizeFeatureCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  return undefined;
}

function normalizeAdminIndex(value: unknown): AdminIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('行政区划索引格式错误');
  }

  const index: AdminIndex = {};
  for (const [province, rawEntry] of Object.entries(value as Record<string, any>)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry: AdminIndexEntry = {
      file: typeof rawEntry.file === 'string' ? rawEntry.file : null,
      features: normalizeFeatureCount(rawEntry.features),
      sizeKb: normalizeFeatureCount(rawEntry.sizeKb),
    };

    if (Array.isArray(rawEntry.cities)) {
      entry.cities = rawEntry.cities.filter((item: unknown): item is string => typeof item === 'string');
    } else if (rawEntry.cities && typeof rawEntry.cities === 'object') {
      entry.cities = Object.fromEntries(
        Object.entries(rawEntry.cities as Record<string, any>).map(([city, rawCity]) => [
          city,
          {
            file: typeof rawCity?.file === 'string' ? rawCity.file : null,
            features: normalizeFeatureCount(rawCity?.features),
            sizeKb: normalizeFeatureCount(rawCity?.sizeKb),
          },
        ]),
      );
    }

    index[province] = entry;
  }

  if (Object.keys(index).length === 0) {
    throw new Error('行政区划索引为空');
  }
  return index;
}

function adminCountLabel(value: unknown): string {
  const count = normalizeFeatureCount(value);
  return typeof count === 'number' ? String(count) : '';
}

function adminCityNames(cities: AdminIndexEntry['cities']): string[] {
  if (Array.isArray(cities)) return cities;
  if (cities && typeof cities === 'object') return Object.keys(cities);
  return [];
}

const shapeIcon = (shapeType: string) => {
  switch (shapeType) {
    case 'Marker': return <MapPin size={13} />;
    case 'Line': return <Minus size={13} />;
    case 'Polygon': return <Hexagon size={13} />;
    case 'Rectangle': return <Square size={13} />;
    default: return null;
  }
};

const shapeLabel = (shapeType: string) => {
  switch (shapeType) {
    case 'Marker': return '点';
    case 'Line': return '线';
    case 'Polygon': return '面';
    case 'Rectangle': return '矩形';
    default: return shapeType;
  }
};

export default function LayerPanel() {
  const { state, dispatch } = useAppContext();
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
    () => new Set(state.layers.map((l) => l.id)),
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [copyMenuId, setCopyMenuId] = useState<string | null>(null);
  const [adminExpanded, setAdminExpanded] = useState(false);
  const [adminIndex, setAdminIndex] = useState<AdminIndex | null>(null);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminLoading, setAdminLoading] = useState<string | null>(null);
  const [adminError, setAdminError] = useState('');
  const [expandedProvince, setExpandedProvince] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const adminLoadRef = useRef(false);

  const toggleExpand = (id: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddLayer = () => {
    const layer: Layer = { id: crypto.randomUUID(), name: `图层 ${state.layers.length + 1}`, visible: true };
    dispatch({ type: 'ADD_LAYER', layer });
    setExpandedLayers((prev) => new Set(prev).add(layer.id));
  };

  const handleRename = (id: string, name: string) => { dispatch({ type: 'RENAME_LAYER', id, name }); setRenamingId(null); };
  const startRename = (id: string) => { setRenamingId(id); setTimeout(() => renameInputRef.current?.focus(), 0); };

  const selectedId = state.selectedFeatureId;

  const featuresByLayer = new Map<string, GeoJSONFeature[]>();
  for (const layer of state.layers) featuresByLayer.set(layer.id, []);
  for (const f of state.features) {
    const arr = featuresByLayer.get(f.properties.layerId);
    if (arr) arr.push(f);
    else featuresByLayer.set(f.properties.layerId, [f]);
  }

  const searchLower = searchText.trim().toLowerCase();
  const displayedLayers = searchLower
    ? state.layers.filter((l) => {
        if (l.name.toLowerCase().includes(searchLower)) return true;
        const feats = featuresByLayer.get(l.id) || [];
        return feats.some((f) => f.properties.name.toLowerCase().includes(searchLower));
      })
    : state.layers;

  const handleCopyFeature = (featureId: string, targetLayerId: string) => {
    dispatch({ type: 'COPY_FEATURE', featureId, layerId: targetLayerId });
    setCopyMenuId(null);
  };

  useEffect(() => {
    if (!copyMenuId) return;
    const close = () => setCopyMenuId(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [copyMenuId]);

  // Load admin division index on first expand
  useEffect(() => {
    if (!adminExpanded || adminIndex || adminLoadRef.current) return;
    adminLoadRef.current = true;
    setAdminError('');
    fetch('/data/counties/_index_county.json')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setAdminIndex(normalizeAdminIndex(data)))
      .catch((error) => {
        adminLoadRef.current = false;
        setAdminError(`行政区划索引加载失败：${error instanceof Error ? error.message : '未知错误'}`);
      });
  }, [adminExpanded, adminIndex]);

  if (collapsed) {
    return (
      <div className="panel layer-panel collapsed">
        <div className="panel-header panel-header-vertical">
          <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开图层面板" aria-label="展开图层面板">
            <ChevronsRight size={16} />
          </button>
          <span className="panel-title-vertical">图层</span>
        </div>
      </div>
    );
  }

  const handleLoadAdminRegion = async (province: string, city?: string) => {
    if (!adminIndex) return;
    const provData = adminIndex[province];
    if (!provData) return;

    let fileName: string | undefined;
    if (city && provData.cities && !Array.isArray(provData.cities) && typeof provData.cities === 'object') {
      fileName = provData.cities[city]?.file || undefined;
    } else if (provData.file) {
      fileName = provData.file;
    } else {
      setAdminError(`${province} 已按城市拆分，请先展开后选择具体城市。`);
      return;
    }
    if (!fileName) {
      setAdminError(`未找到 ${city ? `${province}-${city}` : province} 对应的数据文件。`);
      return;
    }

    const layerName = city ? `${province}-${city}` : province;
    const key = city || province;
    setAdminLoading(key);
    setAdminError('');
    try {
      const resp = await fetch(`/data/counties/${fileName}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
        throw new Error('GeoJSON 格式错误');
      }
      const layerId = crypto.randomUUID();

      const features: GeoJSONFeature[] = (data.features || [])
        .filter((f: any) => {
          const g = f?.geometry;
          if (!g || !g.type || !Array.isArray(g.coordinates)) return false;
          try {
            return JSON.stringify(g.coordinates).length < 500_000;
          } catch {
            return false;
          }
        })
        .map((f: any) => {
          const gt = f.geometry?.type || 'Polygon';
          const shapeType: GeoJSONFeature['properties']['shapeType'] =
            gt === 'MultiPolygon' || gt === 'Polygon' ? 'Polygon' : 'Line';
          const props = f.properties || {};
          return {
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: {
              id: crypto.randomUUID(),
              name: String(props['县'] || props['市'] || props['NAME'] || key),
              description: String(props['市'] ? `${props['市']} ${props['县'] || ''}`.trim() : ''),
              color: '#4dabf7',
              fillColor: '#a5d8ff',
              fillEnabled: true,
              strokeStyle: 'solid' as const,
              strokeWidth: 1,
              shapeType,
              layerId,
            },
          };
        });

      if (features.length === 0) {
        setAdminError('未找到有效区划数据');
        return;
      }

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      dispatch({ type: 'SET_CURRENT_LAYER', id: layerId });
    } catch (e: any) {
      setAdminError(`加载区划数据失败：${e?.message || '未知错误'}`);
    } finally {
      setAdminLoading(null);
    }
  };

  return (
    <div className="panel layer-panel">
      <div className="panel-header">
        <Layers size={15} />
        <span>图层</span>
        <button className="panel-header-btn" onClick={handleAddLayer} title="新建图层" aria-label="新建图层"><Plus size={15} /></button>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化" aria-label="最小化图层面板"><ChevronsLeft size={14} /></button>
      </div>
      <div className="panel-body">
        <div className="layer-search-box">
          <Search size={14} className="layer-search-icon" />
          <input
            className="layer-search-input"
            type="text"
            placeholder="搜索图层或要素名称..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button className="layer-search-clear" onClick={() => setSearchText('')} title="清除" aria-label="清除图层搜索">×</button>
          )}
        </div>

        {state.layers.length === 0 && <div className="panel-empty">暂无图层，点击 + 新建。</div>}

        {searchLower && displayedLayers.length === 0 && state.layers.length > 0 && (
          <div className="panel-empty">无匹配的图层或要素</div>
        )}

        {displayedLayers.map((layer: Layer) => {
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
                  aria-label={`${expanded ? '折叠' : '展开'}图层「${layer.name}」`}
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button className={`layer-visibility ${!layer.visible ? 'off' : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_LAYER', id: layer.id })}
                  title={layer.visible ? '隐藏' : '显示'}
                  aria-label={`${layer.visible ? '隐藏' : '显示'}图层「${layer.name}」`}>
                  {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                {renamingId === layer.id ? (
                  <input ref={renameInputRef} className="layer-rename-input" defaultValue={layer.name}
                    onBlur={(e) => handleRename(layer.id, e.target.value || layer.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(layer.id, (e.target as HTMLInputElement).value || layer.name);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()} />
                ) : (
                  <span className="layer-title"
                    onClick={() => dispatch({ type: 'SET_CURRENT_LAYER', id: layer.id })}
                    title={isActive ? '当前绘制图层' : '设为当前图层'}>
                    {layer.name}
                  </span>
                )}
                <span className="layer-count">{features.length}</span>
                {isActive && <Check size={13} className="layer-active-mark" />}
                <button className="layer-action-btn" title="重命名" aria-label={`重命名图层「${layer.name}」`} onClick={() => startRename(layer.id)}><Pencil size={12} /></button>
                {isDefault && features.length > 0 && (
                  <button className="layer-action-btn danger" title="清空默认图层" aria-label="清空默认图层"
                    onClick={() => { if (confirm(`确定清空默认图层全部 ${features.length} 个标注？`)) dispatch({ type: 'CLEAR_LAYER_FEATURES', layerId: DEFAULT_LAYER_ID }); }}>
                    <Trash2 size={12} /></button>
                )}
                {!isDefault && (
                  <button className="layer-action-btn danger" title="删除图层" aria-label={`删除图层「${layer.name}」`}
                    onClick={() => { if (confirm(`确定删除图层「${layer.name}」及其全部 ${features.length} 个标注？`)) dispatch({ type: 'DELETE_LAYER', id: layer.id }); }}>
                    <Trash2 size={12} /></button>
                )}
              </div>
              {expanded && (
                <div className="layer-features">
                  {features.length === 0 && <div className="layer-empty-hint">空图层</div>}
                  {features.map((f: GeoJSONFeature) => (
                    <div key={f.properties.id} className={`layer-item ${selectedId === f.properties.id ? 'selected' : ''}`}>
                      <div className="layer-item-main"
                        onClick={() => {
                          dispatch({ type: 'SELECT_FEATURE', id: f.properties.id });
                          const api = (window as any).__webgis;
                          api?.flyToFeature?.(f);
                        }}>
                        <span className="layer-color" style={{ backgroundColor: f.properties.color }} />
                        <span className="layer-icon">{shapeIcon(f.properties.shapeType)}</span>
                        <span className="layer-name">{f.properties.name}</span>
                        <span className="layer-type">{shapeLabel(f.properties.shapeType)}</span>
                      </div>
                      <div className="layer-item-actions">
                        <button className="layer-copy-btn"
                          title="复制到其他图层"
                          aria-label={`复制要素「${f.properties.name}」到其他图层`}
                          onClick={(e) => { e.stopPropagation(); setCopyMenuId(copyMenuId === f.properties.id ? null : f.properties.id); }}>
                          <Copy size={11} />
                        </button>
                        <button className="layer-copy-btn danger"
                          title="删除要素"
                          aria-label={`删除要素「${f.properties.name}」`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`确定删除「${f.properties.name}」？`)) {
                              dispatch({ type: 'DELETE_FEATURE', id: f.properties.id });
                            }
                          }}>
                          <Trash2 size={11} />
                        </button>
                        {copyMenuId === f.properties.id && (
                          <div className="layer-copy-menu">
                            <div className="layer-copy-menu-title">复制到图层</div>
                            {state.layers.filter((l) => l.id !== f.properties.layerId).map((l) => (
                              <button key={l.id} className="layer-copy-menu-item"
                                onClick={(e) => { e.stopPropagation(); handleCopyFeature(f.properties.id, l.id); }}>
                                {l.name}
                              </button>
                            ))}
                            {state.layers.filter((l) => l.id !== f.properties.layerId).length === 0 && (
                              <div className="layer-copy-menu-empty">无其他图层</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* ── 行政区划 ── */}
        <div className="admin-section">
          <button
            className="admin-header"
            type="button"
            onClick={() => setAdminExpanded(!adminExpanded)}
          >
            <span>{adminExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <MapIcon size={13} />
            <span>行政区划</span>
          </button>

          {adminExpanded && (
            <div className="admin-body">
              <div className="admin-search-box">
                <Search size={13} className="admin-search-icon" />
                <input
                  className="admin-search-input"
                  type="text"
                  placeholder="搜索省/市/县..."
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                />
              </div>

              {adminError && <div className="admin-error">{adminError}</div>}

              {!adminIndex && !adminError ? (
                <div className="admin-loading"><Loader2 size={13} className="builtin-spinner" /> 加载索引...</div>
              ) : !adminIndex ? (
                <button className="admin-retry-btn" type="button" onClick={() => {
                  adminLoadRef.current = false;
                  setAdminError('');
                  setAdminExpanded(false);
                  setTimeout(() => setAdminExpanded(true), 0);
                }}>
                  重新加载行政区划索引
                </button>
              ) : (
                <div className="admin-list">
                  {(Object.entries(adminIndex) as Array<[string, AdminIndexEntry]>)
                    .filter(([province, data]) => {
                      if (!adminSearch.trim()) return true;
                      const q = adminSearch.toLowerCase();
                      if (province.toLowerCase().includes(q)) return true;
                      return adminCityNames(data.cities).some((c) => c.toLowerCase().includes(q));
                    })
                    .map(([province, data]) => {
                      const isSplit = !data.file; // split by city
                      const isExpanded = expandedProvince === province;
                      const isLoadingProv = adminLoading === province;

                      return (
                        <div key={province} className="admin-province">
                          <button
                            className={`admin-province-btn ${isLoadingProv ? 'loading' : ''}`}
                            type="button"
                            onClick={() => {
                              if (isSplit) {
                                setExpandedProvince(isExpanded ? null : province);
                              } else {
                                handleLoadAdminRegion(province);
                              }
                            }}
                          >
                            {isSplit && (
                              <span className="admin-chevron">
                                {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              </span>
                            )}
                            <span className="admin-province-name">{province}</span>
                            <span className="admin-province-count">{adminCountLabel(data.features)}</span>
                            {isLoadingProv && <Loader2 size={10} className="builtin-spinner" />}
                          </button>

                          {isSplit && isExpanded && data.cities && !Array.isArray(data.cities) && typeof data.cities === 'object' && (
                            <div className="admin-cities">
                              {Object.entries(data.cities)
                                .filter(([city]) => {
                                  if (!adminSearch.trim()) return true;
                                  return city.toLowerCase().includes(adminSearch.toLowerCase());
                                })
                                .map(([city, cityData]) => {
                                  const isLoadingCity = adminLoading === city;
                                  return (
                                    <button
                                      key={city}
                                      className={`admin-city-btn ${isLoadingCity ? 'loading' : ''}`}
                                      type="button"
                                      onClick={() => handleLoadAdminRegion(province, city)}
                                    >
                                      <span className="admin-city-name">{city}</span>
                                      <span className="admin-city-count">{adminCountLabel(cityData.features)}</span>
                                      {isLoadingCity && <Loader2 size={10} className="builtin-spinner" />}
                                    </button>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
