import { useCallback, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Gauge,
  MapPin,
  Navigation,
  Route,
} from 'lucide-react';
import { useAppContext } from './AppContext';
import type { GeoJSONFeature } from './types';
import type { AmapRoutePoint, AmapRouteStep } from './utils/amap';

interface RouteResult {
  distance: string;
  duration: string;
  origin: AmapRoutePoint;
  destination: AmapRoutePoint;
  steps: AmapRouteStep[];
}

export default function NavigationPanel() {
  const { dispatch } = useAppContext();
  const [collapsed, setCollapsed] = useState(false);
  const [originText, setOriginText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);

  const handlePlanRoute = useCallback(async () => {
    const originInput = originText.trim();
    const destinationInput = destinationText.trim();
    if (!originInput || !destinationInput) {
      alert('请输入导航起点和终点，支持地名或“纬度,经度”。');
      return;
    }

    setLoading(true);
    try {
      const {
        resolveAmapRoutePoint,
        planDrivingRouteAmap,
        formatRouteDistance,
        formatRouteDuration,
      } = await import('./utils/amap');

      const origin = await resolveAmapRoutePoint(originInput);
      if (!origin) {
        alert(`未找到起点「${originInput}」`);
        return;
      }

      const destination = await resolveAmapRoutePoint(destinationInput);
      if (!destination) {
        alert(`未找到终点「${destinationInput}」`);
        return;
      }

      const route = await planDrivingRouteAmap(origin, destination);
      const distance = formatRouteDistance(route.distance);
      const duration = formatRouteDuration(route.duration);
      const layerId = crypto.randomUUID();
      const routeName = `导航 ${origin.name} → ${destination.name}`;
      const feature: GeoJSONFeature = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: route.points,
        },
        properties: {
          id: crypto.randomUUID(),
          name: routeName,
          description: [
            `起点：${origin.name}`,
            `终点：${destination.name}`,
            `距离：${distance}`,
            `预计耗时：${duration}`,
            `来源：高德驾车路径规划`,
          ].join('\n'),
          color: '#d99a20',
          shapeType: 'Line',
          layerId,
        },
      };

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: routeName, visible: true } });
      dispatch({ type: 'BATCH_ADD_FEATURES', features: [feature] });
      dispatch({ type: 'SET_CURRENT_LAYER', id: layerId });
      setResult({
        distance,
        duration,
        origin,
        destination,
        steps: route.steps,
      });
      setTimeout(() => (window as any).__webgis?.flyToFeature?.(feature), 100);
    } catch (e: any) {
      alert(`导航失败: ${e?.message || '高德接口请求异常'}`);
    } finally {
      setLoading(false);
    }
  }, [originText, destinationText, dispatch]);

  if (collapsed) {
    return (
      <div className="panel nav-panel collapsed">
        <div className="panel-header panel-header-vertical nav-panel-collapsed">
          <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开导航">
            <ChevronsRight size={16} />
          </button>
          <span className="panel-title-vertical">导航</span>
        </div>
      </div>
    );
  }

  return (
    <aside className="panel nav-panel">
      <div className="nav-app-header">
        <div className="nav-app-title">
          <span className="nav-app-icon"><Navigation size={17} /></span>
          <span>驾车导航</span>
        </div>
        <button className="panel-toggle nav-collapse-btn" onClick={() => setCollapsed(true)} title="最小化导航">
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="nav-body">
        <div className="nav-mode-row">
          <button className="nav-mode active" type="button">
            <Route size={14} />
            <span>驾车</span>
          </button>
        </div>

        <div className="nav-input-stack">
          <div className="nav-input-row">
            <span className="nav-dot start" />
            <input
              className="nav-input"
              value={originText}
              onChange={(e) => setOriginText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePlanRoute(); }}
              placeholder="起点"
            />
          </div>
          <button
            className="nav-swap-btn"
            type="button"
            title="交换起终点"
            onClick={() => {
              setOriginText(destinationText);
              setDestinationText(originText);
            }}
            disabled={loading}
          >
            <ArrowLeftRight size={15} />
          </button>
          <div className="nav-input-row">
            <span className="nav-dot end" />
            <input
              className="nav-input"
              value={destinationText}
              onChange={(e) => setDestinationText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePlanRoute(); }}
              placeholder="终点"
            />
          </div>
        </div>

        <button
          className="nav-primary-btn"
          type="button"
          onClick={handlePlanRoute}
          disabled={loading}
        >
          <Navigation size={17} />
          <span>{loading ? '规划中' : '开始导航'}</span>
        </button>

        {result ? (
          <div className="nav-result">
            <div className="nav-summary">
              <div className="nav-summary-main">
                <strong>{result.distance}</strong>
                <span>{result.duration}</span>
              </div>
              <div className="nav-summary-sub">
                <MapPin size={13} />
                <span>{result.origin.name} → {result.destination.name}</span>
              </div>
            </div>

            <div className="nav-stat-row">
              <span><Gauge size={13} />{result.distance}</span>
              <span><Clock3 size={13} />{result.duration}</span>
            </div>

            <div className="nav-steps">
              {result.steps.length === 0 ? (
                <div className="nav-empty">暂无详细步骤</div>
              ) : (
                result.steps.map((step, index) => (
                  <div className="nav-step" key={`${step.instruction}-${index}`}>
                    <span className="nav-step-index">{index + 1}</span>
                    <div className="nav-step-text">
                      <strong>{step.instruction || '继续行驶'}</strong>
                      <span>
                        {formatStepMeta(step.distance, step.duration)}
                        {step.road ? ` · ${step.road}` : ''}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="nav-empty-state">
            <Route size={20} />
            <span>输入起终点后生成路线图层</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function formatStepMeta(distance: number, duration: number): string {
  const dist = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
  const mins = Math.max(1, Math.round(duration / 60));
  return `${dist} · ${mins} 分钟`;
}
