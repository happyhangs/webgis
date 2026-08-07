import { useCallback, useMemo, useState } from 'react';
import {
  ChevronsLeft,
  Grid3x3,
  TrendingUp,
  Layers,
  Ruler,
} from 'lucide-react';
import area from '@turf/area';
import { useAppContext } from './AppContext';
import type { GeoJSONFeature } from './types';
import { useDraggablePanel } from './useDraggablePanel';
import { stopFloatingPanelButtonEvent, useFloatingPanels } from './FloatingPanelContext';

function safeAreaMu(feature: GeoJSONFeature): number | null {
  if (
    typeof feature.properties.parcelAreaMu === 'number' &&
    Number.isFinite(feature.properties.parcelAreaMu)
  ) {
    return feature.properties.parcelAreaMu;
  }
  try {
    const value = area(feature) / 666.667;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export default function FieldPanel() {
  const { state, dispatch } = useAppContext();
  const { isPanelOpen, closePanel } = useFloatingPanels();
  const [filterLayer, setFilterLayer] = useState<string>('__all__');
  const [sortBy, setSortBy] = useState<'name' | 'area'>('area');
  const { panelRef, panelStyle, dragging, dragHandleProps, resizeHandle } = useDraggablePanel();

  const polygons = useMemo(() => {
    return state.features.filter((f) => {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return false;
      if (f.properties.parcelRole === 'boundary') return false;
      if (filterLayer !== '__all__' && f.properties.layerId !== filterLayer) return false;
      return true;
    });
  }, [state.features, filterLayer]);

  const sorted = useMemo(() => {
    const list = polygons.flatMap((f) => {
      const areaMu = safeAreaMu(f);
      return areaMu === null ? [] : [{ feature: f, areaMu }];
    });
    if (sortBy === 'area') list.sort((a, b) => b.areaMu - a.areaMu);
    else list.sort((a, b) => a.feature.properties.name.localeCompare(b.feature.properties.name, 'zh'));
    return list;
  }, [polygons, sortBy]);

  const totalMu = useMemo(() => sorted.reduce((s, f) => s + f.areaMu, 0), [sorted]);

  const layerStats = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; mu: number }>();
    for (const f of state.features) {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
      if (f.properties.parcelRole === 'boundary') continue;
      const lid = f.properties.layerId;
      const entry = map.get(lid);
      const mu = safeAreaMu(f);
      if (mu === null) continue;
      if (entry) { entry.count++; entry.mu += mu; }
      else {
        const layer = state.layers.find((l) => l.id === lid);
        map.set(lid, { id: lid, name: layer?.name || '未知图层', count: 1, mu });
      }
    }
    return [...map.values()].sort((a, b) => b.mu - a.mu);
  }, [state.features, state.layers]);

  const handleFlyTo = useCallback((feature: GeoJSONFeature) => {
    dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
    (window as any).__webgis?.flyToFeature?.(feature);
  }, [dispatch]);

  if (!isPanelOpen('field')) return null;

  return (
    <aside
      ref={panelRef}
      className={`panel floating-panel field-panel ${dragging ? 'is-dragging' : ''}`}
      style={panelStyle}
    >
      <div className="field-header floating-panel-drag-handle" {...dragHandleProps}>
        <span className="field-title"><Grid3x3 size={15} /> 地块管理</span>
        <button
          className="panel-toggle"
          onPointerDown={stopFloatingPanelButtonEvent}
          onClick={(event) => {
            stopFloatingPanelButtonEvent(event);
            closePanel('field');
          }}
          title="最小化至属性栏"
          aria-label="最小化地块管理面板"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="field-body">
        <div className="field-summary">
          <div className="field-stat">
            <Grid3x3 size={14} />
            <span>{sorted.length} 块</span>
          </div>
          <div className="field-stat">
            <Ruler size={14} />
            <span>{totalMu.toFixed(1)} 亩</span>
          </div>
        </div>

        <div className="field-controls">
          <select className="field-select" value={filterLayer} onChange={(e) => setFilterLayer(e.target.value)}>
            <option value="__all__">所有图层</option>
            {layerStats.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            className={`field-sort-btn ${sortBy === 'area' ? 'active' : ''}`}
            onClick={() => setSortBy(sortBy === 'area' ? 'name' : 'area')}
          >
            {sortBy === 'area' ? '面积↓' : '名称'}
          </button>
        </div>

        {/* Per-layer stats */}
        {filterLayer === '__all__' && layerStats.length > 0 && (
          <div className="field-layer-stats">
            <div className="field-section-title"><Layers size={12} /> 各图层统计</div>
            {layerStats.map((s, i) => (
              <div key={i} className="field-layer-row">
                <span className="field-layer-name">{s.name}</span>
                <span>{s.count} 块</span>
                <span className="field-layer-mu">{s.mu.toFixed(1)} 亩</span>
              </div>
            ))}
          </div>
        )}

        {/* Field list */}
        <div className="field-section-title"><TrendingUp size={12} /> 地块清单</div>
        {sorted.length === 0 ? (
          <div className="field-empty">
            暂无面状地块。<br />导入KML或GeoJSON面数据后自动统计。
          </div>
        ) : (
          <div className="field-list">
            {sorted.map(({ feature, areaMu }) => (
              <div
                key={feature.properties.id}
                className="field-item"
                onClick={() => handleFlyTo(feature)}
                title="点击定位到该地块"
              >
                <span className="field-color" style={{ backgroundColor: feature.properties.color }} />
                <span className="field-name">
                  {feature.properties.parcelCode && (
                    <span className="field-code">{feature.properties.parcelCode}</span>
                  )}
                  <span className="field-name-text">
                    {feature.properties.parcelGroup || feature.properties.name}
                  </span>
                </span>
                <span className="field-mu">{areaMu.toFixed(1)} 亩</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div {...resizeHandle('n')} />
      <div {...resizeHandle('s')} />
      <div {...resizeHandle('e')} />
      <div {...resizeHandle('w')} />
      <div {...resizeHandle('ne')} />
      <div {...resizeHandle('nw')} />
      <div {...resizeHandle('se')} />
      <div {...resizeHandle('sw')} />
    </aside>
  );
}
