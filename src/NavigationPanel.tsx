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
  points: [number, number][];
  steps: AmapRouteStep[];
}

export default function NavigationPanel() {
  const { dispatch } = useAppContext();
  const [collapsed, setCollapsed] = useState(true);
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
          fillColor: '#d99a20',
          fillEnabled: false,
          strokeStyle: 'solid',
          strokeWidth: 5,
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
        points: route.points,
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
      <button className="nav-launcher" type="button" onClick={() => setCollapsed(false)} title="打开导航">
        <Navigation size={18} />
        <span>导航</span>
        <ChevronsRight size={14} />
      </button>
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

        <RoutePreview result={result} />

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

function RoutePreview({ result }: { result: RouteResult | null }) {
  const preview = result ? buildPreviewGeometry(result.points) : null;
  return (
    <div className="nav-preview">
      <div className="nav-preview-map">
        <div className="nav-preview-road major a" />
        <div className="nav-preview-road major b" />
        <div className="nav-preview-road minor a" />
        <div className="nav-preview-road minor b" />
        {preview ? (
          <svg className="nav-preview-svg" viewBox="0 0 260 118" aria-hidden="true">
            <path className="nav-preview-route-shadow" d={preview.path} />
            <path className="nav-preview-route" d={preview.path} />
            <circle className="nav-preview-start" cx={preview.start[0]} cy={preview.start[1]} r="5" />
            <circle className="nav-preview-end" cx={preview.end[0]} cy={preview.end[1]} r="5" />
          </svg>
        ) : (
          <div className="nav-preview-empty">
            <Route size={19} />
            <span>路线缩略图</span>
          </div>
        )}
      </div>
      <div className="nav-preview-meta">
        <span>{result ? result.distance : '输入起终点'}</span>
        <strong>{result ? result.duration : '生成导航路线'}</strong>
      </div>
    </div>
  );
}

function buildPreviewGeometry(points: [number, number][]): { path: string; start: [number, number]; end: [number, number] } | null {
  if (points.length < 2) return null;
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;
  const coords = points.map(([lng, lat]) => {
    const x = 18 + ((lng - minLng) / lngSpan) * 224;
    const y = 104 - ((lat - minLat) / latSpan) * 90;
    return [x, y] as [number, number];
  });
  const path = coords
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  return {
    path,
    start: coords[0],
    end: coords[coords.length - 1],
  };
}

function formatStepMeta(distance: number, duration: number): string {
  const dist = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
  const mins = Math.max(1, Math.round(duration / 60));
  return `${dist} · ${mins} 分钟`;
}
