import { useState } from 'react';
import { ChevronsRight, ChevronsLeft, Info } from 'lucide-react';
import { useAppContext } from './AppContext';
import { getFeatureMeasurement } from './utils/measure';

export default function PropertyPanel() {
  const { state, dispatch } = useAppContext();
  const [collapsed, setCollapsed] = useState(false);

  const feature = state.features.find((f) => f.properties.id === state.selectedFeatureId);

  if (collapsed) {
    return (
      <div className="panel property-panel collapsed">
        <div className="panel-header panel-header-vertical">
          <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开属性面板">
            <ChevronsLeft size={16} />
          </button>
          <span className="panel-title-vertical">属性</span>
        </div>
      </div>
    );
  }

  if (!feature) {
    return (
      <div className="panel property-panel">
        <div className="panel-header">
          <Info size={15} />
          <span>属性</span>
          <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化"><ChevronsRight size={14} /></button>
        </div>
        <div className="panel-body">
          <div className="panel-empty">选中一个要素以查看和编辑属性。</div>
        </div>
      </div>
    );
  }

  const p = feature.properties;
  const measurement = getFeatureMeasurement(feature);

  return (
    <div className="panel property-panel">
      <div className="panel-header">
        <Info size={15} />
        <span>属性</span>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化"><ChevronsRight size={14} /></button>
      </div>
      <div className="panel-body">
        {measurement && <div className="prop-measurement">{measurement}</div>}

        <label className="prop-field">
          <span>所属图层</span>
          <select className="prop-select" value={p.layerId}
            onChange={(e) => dispatch({ type: 'MOVE_FEATURE', featureId: p.id, layerId: e.target.value })}>
            {state.layers.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
        </label>

        <label className="prop-field">
          <span>名称</span>
          <input type="text" value={p.name}
            onChange={(e) => dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { name: e.target.value } })} />
        </label>

        <label className="prop-field">
          <span>描述</span>
          <textarea rows={3} value={p.description}
            onChange={(e) => dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { description: e.target.value } })} />
        </label>

        <label className="prop-field">
          <span>颜色</span>
          <div className="prop-color-row">
            <input type="color" value={p.color}
              onChange={(e) => dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { color: e.target.value } })} />
            <span className="prop-color-value">{p.color}</span>
          </div>
        </label>

        <div className="prop-field">
          <span>类型</span>
          <span className="prop-static">{p.shapeType}</span>
        </div>

        <button className="prop-delete-btn" onClick={() => dispatch({ type: 'DELETE_FEATURE', id: p.id })}>
          删除此要素
        </button>
      </div>
    </div>
  );
}
