import { useState } from 'react';
import { ChevronsRight, ChevronsLeft, Info } from 'lucide-react';
import { useAppContext } from './AppContext';
import { getFeatureMeasurement } from './utils/measure';
import { isAreaShape, STROKE_STYLE_OPTIONS } from './utils/featureStyle';
import FloatingPanelDock from './FloatingPanelDock';

const shapeLabel = (shapeType: string) => {
  switch (shapeType) {
    case 'Marker': return '点';
    case 'Line': return '线';
    case 'Polygon': return '面';
    case 'Rectangle': return '矩形';
    default: return shapeType;
  }
};

export default function PropertyPanel() {
  const { state, dispatch } = useAppContext();
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);

  const feature = state.features.find((f) => f.properties.id === state.selectedFeatureId);
  const collapsed = feature
    ? collapsedFor === feature.properties.id
    : collapsedFor !== '__empty-expanded__';
  const expandPanel = () => setCollapsedFor(feature ? null : '__empty-expanded__');
  const collapsePanel = () => setCollapsedFor(feature?.properties.id ?? null);

  if (collapsed) {
    return (
      <div className="panel property-panel collapsed">
        <div className="panel-header panel-header-vertical">
          <button className="panel-toggle" onClick={expandPanel} title="展开属性面板" aria-label="展开属性面板">
            <ChevronsLeft size={16} />
          </button>
          <span className="panel-title-vertical">属性</span>
          <FloatingPanelDock compact />
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
          <button className="panel-toggle" onClick={collapsePanel} title="最小化" aria-label="最小化属性面板"><ChevronsRight size={14} /></button>
        </div>
        <FloatingPanelDock />
        <div className="panel-body">
          <div className="panel-empty">选中一个要素以查看和编辑属性。</div>
        </div>
      </div>
    );
  }

  const p = feature.properties;
  const measurement = getFeatureMeasurement(feature);
  const supportsStroke = p.shapeType !== 'Marker';
  const supportsFill = isAreaShape(p.shapeType);

  return (
    <div className="panel property-panel">
      <div className="panel-header">
        <Info size={15} />
        <span>属性</span>
        <button className="panel-toggle" onClick={collapsePanel} title="最小化" aria-label="最小化属性面板"><ChevronsRight size={14} /></button>
      </div>
      <FloatingPanelDock />
      <div className="panel-body">
        {measurement && <div className="prop-measurement">{measurement}</div>}
        {p.parcelCode && (
          <div className="prop-parcel-meta">
            <span>编号：{p.parcelCode}</span>
            {p.parcelGroup && <span>分区：{p.parcelGroup}</span>}
            {typeof p.parcelAreaMu === 'number' && Number.isFinite(p.parcelAreaMu) && (
              <span>面积：{p.parcelAreaMu.toFixed(1)} 亩</span>
            )}
          </div>
        )}

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
          <span>{supportsStroke ? '边框颜色' : '颜色'}</span>
          <div className="prop-color-row">
            <input type="color" value={p.color}
              onChange={(e) => dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { color: e.target.value } })} />
            <span className="prop-color-value">{p.color}</span>
          </div>
        </label>

        {supportsStroke && (
          <>
            {supportsFill && (
              <div className="prop-field">
                <div className="prop-switch-row">
                  <span>填充</span>
                  <label className="prop-switch">
                    <input
                      type="checkbox"
                      checked={p.fillEnabled}
                      onChange={(e) =>
                        dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { fillEnabled: e.target.checked } })
                      }
                    />
                    <span>{p.fillEnabled ? '开启' : '仅边框'}</span>
                  </label>
                </div>
              </div>
            )}

            {supportsFill && p.fillEnabled && (
              <label className="prop-field">
                <span>填充颜色</span>
                <div className="prop-color-row">
                  <input type="color" value={p.fillColor}
                    onChange={(e) => dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { fillColor: e.target.value } })} />
                  <span className="prop-color-value">{p.fillColor}</span>
                </div>
              </label>
            )}

            <div className="prop-field">
              <span>线条样式</span>
              <div className="stroke-style-options" role="group" aria-label="线条样式">
                {STROKE_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`stroke-style-option ${p.strokeStyle === option.value ? 'active' : ''}`}
                    title={option.label}
                    aria-pressed={p.strokeStyle === option.value}
                    onClick={() =>
                      dispatch({
                        type: 'UPDATE_FEATURE',
                        id: p.id,
                        updates: { strokeStyle: option.value },
                      })
                    }
                  >
                    <svg className="stroke-style-preview" viewBox="0 0 72 18" aria-hidden="true">
                      <line
                        x1="5"
                        y1="9"
                        x2="67"
                        y2="9"
                        stroke={p.color}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={
                          option.value === 'solid' ? undefined : option.value === 'dashed' ? '12 8' : '1 8'
                        }
                      />
                    </svg>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="prop-field">
              <span>线宽</span>
              <div className="prop-range-row">
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={p.strokeWidth}
                  onChange={(e) =>
                    dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { strokeWidth: Number(e.target.value) } })
                  }
                />
                <input
                  className="prop-number-input"
                  type="number"
                  min="1"
                  max="12"
                  value={p.strokeWidth}
                  onChange={(e) =>
                    dispatch({ type: 'UPDATE_FEATURE', id: p.id, updates: { strokeWidth: Number(e.target.value) } })
                  }
                />
              </div>
            </label>
          </>
        )}

        <div className="prop-field">
          <span>类型</span>
          <span className="prop-static">{shapeLabel(p.shapeType)}</span>
        </div>

        <button className="prop-delete-btn" onClick={() => {
          if (confirm(`确定删除「${p.name}」？`)) dispatch({ type: 'DELETE_FEATURE', id: p.id });
        }}>
          删除此要素
        </button>
      </div>
    </div>
  );
}
