import { useCallback, useState } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  ScanEye,
  Loader2,
  MapPin,
  Grid3x3,
  Ruler,
} from 'lucide-react';
import { useAppContext } from './AppContext';
import { detectVegetation } from './utils/vegdetect';
import type { GeoJSONFeature } from './types';

const LOCATIONS = [
  { name: '石河子', lat: 44.3061, lng: 86.0806, z: 15 },
  { name: '北屯', lat: 47.3567, lng: 87.8244, z: 15 },
  { name: '奇台', lat: 44.0207, lng: 89.5819, z: 15 },
  { name: '新源', lat: 43.4341, lng: 83.2588, z: 15 },
];

export default function FieldDetectPanel() {
  const { dispatch } = useAppContext();
  const [collapsed, setCollapsed] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [results, setResults] = useState<{ name: string; count: number; mu: number }[]>([]);
  const [selectedLoc, setSelectedLoc] = useState(LOCATIONS[0]);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    setResults([]);
    const api = (window as any).__webgis;
    if (!api) return;

    try {
      // Fly to location first
      api.flyTo(selectedLoc.lat, selectedLoc.lng, selectedLoc.z);
      await new Promise((r) => setTimeout(r, 800));

      // Use ESRI satellite tile for vegetation detection
      const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${selectedLoc.z}/{y}/{x}`;

      // Compute tile coords for the location
      const n = Math.pow(2, selectedLoc.z);
      const latRad = (selectedLoc.lat * Math.PI) / 180;
      const tileX = Math.floor(((selectedLoc.lng + 180) / 360) * n);
      const tileY = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
      );
      const tileLngWest = (tileX / n) * 360 - 180;
      const tileLngEast = ((tileX + 1) / n) * 360 - 180;
      const tileLatNorth =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) / Math.PI;
      const tileLatSouth =
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + 1)) / n))) * 180) / Math.PI;

      const tileBounds = {
        west: tileLngWest,
        south: tileLatSouth,
        east: tileLngEast,
        north: tileLatNorth,
      };

      const url = tileUrl
        .replace('{z}', String(selectedLoc.z))
        .replace('{x}', String(tileX))
        .replace('{y}', String(tileY));

      const result = await detectVegetation(url, tileBounds);

      if (result.polygons.length === 0) {
        alert('未检测到明显植被区域，请尝试其他位置或放大到农田区域。');
        return;
      }

      // Create features
      const layerId = crypto.randomUUID();
      const layerName = `${selectedLoc.name}农田检测`;
      const features: GeoJSONFeature[] = result.polygons.map((ring, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
        properties: {
          id: crypto.randomUUID(),
          name: `${selectedLoc.name}地块 ${String(i + 1).padStart(3, '0')}`,
          description: `自动检测地块\n植被覆盖率: ${result.coverage}%`,
          color: '#2f7d32',
          fillColor: '#8fd17a',
          fillEnabled: true,
          strokeStyle: 'solid' as const,
          strokeWidth: 2,
          shapeType: 'Polygon' as const,
          layerId,
        },
      }));

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      dispatch({ type: 'BATCH_ADD_FEATURES', features });

      // Calculate areas
      const { default: area } = await import('@turf/area');
      const totalMu = features.reduce((sum, f) => sum + area(f) / 666.667, 0);

      setResults([{ name: layerName, count: features.length, mu: totalMu }]);
    } catch (e: any) {
      alert(`检测失败: ${e?.message || '请确保使用ESRI卫星底图'}`);
    } finally {
      setDetecting(false);
    }
  }, [selectedLoc, dispatch]);

  if (collapsed) {
    return (
      <button className="detect-launcher" type="button" onClick={() => setCollapsed(false)} title="农田检测">
        <ScanEye size={18} />
        <span>检测</span>
        <ChevronsRight size={14} />
      </button>
    );
  }

  return (
    <aside className="panel field-panel">
      <div className="field-header">
        <span className="field-title"><ScanEye size={15} /> 农田检测</span>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化">
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="field-body">
        <div className="field-section-title"><MapPin size={12} /> 选择地点</div>
        <div className="field-loc-grid">
          {LOCATIONS.map((loc) => (
            <button
              key={loc.name}
              className={`field-loc-btn ${selectedLoc.name === loc.name ? 'active' : ''}`}
              onClick={() => setSelectedLoc(loc)}
            >
              {loc.name}
            </button>
          ))}
        </div>

        <button
          className="field-detect-btn"
          onClick={handleDetect}
          disabled={detecting}
        >
          {detecting ? (
            <><Loader2 size={15} className="builtin-spinner" /> 检测中...</>
          ) : (
            <><ScanEye size={15} /> 开始检测 {selectedLoc.name} 农田</>
          )}
        </button>

        <div className="field-hint">
          切换到 <strong>ESRI卫星</strong> 底图效果最佳。<br />
          基于像素植被指数 (ExG) 自动识别植被区域并圈出地块边界。
        </div>

        {results.length > 0 && (
          <div className="field-result">
            <div className="field-section-title"><Grid3x3 size={12} /> 检测结果</div>
            {results.map((r, i) => (
              <div key={i} className="field-result-card">
                <div className="field-result-name">{r.name}</div>
                <div className="field-result-stats">
                  <span><Grid3x3 size={13} /> {r.count} 块</span>
                  <span><Ruler size={13} /> {r.mu.toFixed(1)} 亩</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
