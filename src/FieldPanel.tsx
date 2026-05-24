import { useCallback, useMemo, useState } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  Grid3x3,
  TrendingUp,
  Layers,
  Ruler,
} from 'lucide-react';
import area from '@turf/area';
import { useAppContext } from './AppContext';
import type { GeoJSONFeature } from './types';

export default function FieldPanel() {
  const { state, dispatch } = useAppContext();
  const [collapsed, setCollapsed] = useState(true);
  const [filterLayer, setFilterLayer] = useState<string>('__all__');
  const [sortBy, setSortBy] = useState<'name' | 'area'>('area');

  const polygons = useMemo(() => {
    return state.features.filter((f) => {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return false;
      if (filterLayer !== '__all__' && f.properties.layerId !== filterLayer) return false;
      return true;
    });
  }, [state.features, filterLayer]);

  const sorted = useMemo(() => {
    const list = polygons.map((f) => ({
      feature: f,
      areaMu: area(f) / 666.667, // m² → 亩
    }));
    if (sortBy === 'area') list.sort((a, b) => b.areaMu - a.areaMu);
    else list.sort((a, b) => a.feature.properties.name.localeCompare(b.feature.properties.name, 'zh'));
    return list;
  }, [polygons, sortBy]);

  const totalMu = useMemo(() => sorted.reduce((s, f) => s + f.areaMu, 0), [sorted]);

  const layerStats = useMemo(() => {
    const map = new Map<string, { name: string; count: number; mu: number }>();
    for (const f of state.features) {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
      const lid = f.properties.layerId;
      const entry = map.get(lid);
      const mu = area(f) / 666.667;
      if (entry) { entry.count++; entry.mu += mu; }
      else {
        const layer = state.layers.find((l) => l.id === lid);
        map.set(lid, { name: layer?.name || '未知图层', count: 1, mu });
      }
    }
    return [...map.values()].sort((a, b) => b.mu - a.mu);
  }, [state.features, state.layers]);

  const handleFlyTo = useCallback((feature: GeoJSONFeature) => {
    dispatch({ type: 'SELECT_FEATURE', id: feature.properties.id });
    (window as any).__webgis?.flyToFeature?.(feature);
  }, [dispatch]);

  if (collapsed) {
    return (
      <button className="field-launcher" type="button" onClick={() => setCollapsed(false)} title="地块管理">
        <Grid3x3 size={18} />
        <span>地块</span>
        <ChevronsRight size={14} />
      </button>
    );
  }

  return (
    <aside className="panel field-panel">
      <div className="field-header">
        <span className="field-title"><Grid3x3 size={15} /> 地块管理</span>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化">
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
            {layerStats.map((s, i) => (
              <option key={i} value={state.layers.find((l) => l.name === s.name)?.id || ''}>{s.name}</option>
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
                <span className="field-name">{feature.properties.name}</span>
                <span className="field-mu">{areaMu.toFixed(1)} 亩</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
