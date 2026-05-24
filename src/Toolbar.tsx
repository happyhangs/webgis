import { useRef, useState, useCallback } from 'react';
import {
  MapPin,
  Minus,
  Square,
  Hexagon,
  Pencil,
  Trash2,
  Download,
  FileJson,
  Table,
  Layers,
  Package,
  Crosshair,
  Search,
} from 'lucide-react';
import { useAppContext } from './AppContext';
import { BASEMAP_OPTIONS } from './basemaps';
import { exportGeoJSON, importGeoJSON } from './utils/geojson';
import { exportCSV, importCSV } from './utils/csv';
import { convertFeatureCoords } from './utils/coord';
import type { CoordSystem } from './utils/coord';
import type { GeoJSONFeature } from './types';

type ActiveTool =
  | 'Marker'
  | 'Line'
  | 'Polygon'
  | 'Rectangle'
  | 'Edit'
  | 'Remove'
  | null;

export default function Toolbar() {
  const { state, dispatch } = useAppContext();
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shpInputRef = useRef<HTMLInputElement>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'geojson' | 'csv'>('geojson');
  const [importCS, setImportCS] = useState<string>(() => localStorage.getItem('webgis_import_cs') || 'wgs84');
  const [searchText, setSearchText] = useState('');

  const saveImportCS = (cs: string) => { setImportCS(cs); localStorage.setItem('webgis_import_cs', cs); };

  const api = () => (window as any).__webgis;

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) { alert('浏览器不支持GPS定位'); return; }
    const a = api();
    if (!a) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        a.flyTo(pos.coords.latitude, pos.coords.longitude, 16);
        a.placeMarker(pos.coords.latitude, pos.coords.longitude, `我的位置 (${pos.coords.accuracy.toFixed(0)}m 精度)`);
      },
      (err) => { alert('定位失败: ' + err.message); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    const a = api();
    if (!a) {
      alert('地图尚未就绪，请稍后再试。');
      return;
    }

    // 1) Try "lat, lng" coordinates
    const coordMatch = q.match(/^(-?\d+\.?\d*)\s*[,，\s]\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        alert('坐标范围错误：纬度 -90~90，经度 -180~180');
        return;
      }
      try {
        a.flyTo(lat, lng);
        a.placeMarker(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        setSearchText('');
      } catch (e: any) {
        alert('定位失败: ' + (e?.message || ''));
      }
      return;
    }

    // 2) Geocode via Amap API (with signature)
    try {
      const { geocodeAmap } = await import('./utils/amap');
      const result = await geocodeAmap(q);
      if (!result) {
        alert(`未找到「${q}」，请尝试更具体的名称。`);
        return;
      }
      a.flyTo(result.lat, result.lng);
      a.placeMarker(result.lat, result.lng, result.name);
      setSearchText('');
    } catch (e: any) {
      alert('搜索失败: ' + (e?.message || '网络异常'));
    }
  }, [searchText]);

  const handleToolClick = useCallback(
    (tool: ActiveTool) => {
      const a = api();
      if (!a) return;

      if (activeTool === tool) {
        // Toggle off
        a.disableDraw();
        a.disableEdit();
        a.disableRemoval();
        setActiveTool(null);
        return;
      }

      // Deactivate previous tool
      a.disableDraw();
      a.disableEdit();
      a.disableRemoval();

      switch (tool) {
        case 'Marker':
          a.enableDraw('Marker');
          break;
        case 'Line':
          a.enableDraw('Line');
          break;
        case 'Polygon':
          a.enableDraw('Polygon');
          break;
        case 'Rectangle':
          a.enableDraw('Rectangle');
          break;
        case 'Edit':
          if (!state.selectedFeatureId) {
            alert('请先在图层列表中选中一个要素，再点击编辑。');
            return;
          }
          a.enableEdit();
          break;
        case 'Remove':
          a.enableRemoval();
          break;
      }
      setActiveTool(tool);
    },
    [activeTool],
  );

  const handleExportGeoJSON = () => {
    const blob = new Blob([exportGeoJSON(state.features)], {
      type: 'application/geo+json',
    });
    downloadBlob(blob, 'webgis-export.geojson');
  };

  const handleExportCSV = () => {
    const blob = new Blob([exportCSV(state.features)], { type: 'text/csv' });
    downloadBlob(blob, 'webgis-points.csv');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const features =
          importType === 'geojson' ? importGeoJSON(text) : importCSV(text);
        const converted = features.map((f) => convertFeatureCoords(f, importCS as CoordSystem));
        if (converted.length === 0) {
          alert('未找到有效数据');
          return;
        }
        // Merge with existing — avoid duplicate IDs
        const existingIds = new Set(state.features.map((f) => f.properties.id));
        const newFeatures = converted.filter(
          (f) => !existingIds.has(f.properties.id),
        );
        dispatch({
          type: 'SET_FEATURES',
          features: [...state.features, ...newFeatures],
        });
        alert(`成功导入 ${newFeatures.length} 个要素 (${importCS.toUpperCase()})`);
      } catch {
        alert('文件解析失败，请检查格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleShpImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const shp = await import('shpjs');
      const buf = await file.arrayBuffer();
      const geojson: any = await shp.default(buf);
      const items: any[] =
        geojson.type === 'FeatureCollection'
          ? geojson.features
          : Array.isArray(geojson)
            ? geojson
            : [geojson];

      const layerId = crypto.randomUUID();
      const layerName = file.name.replace(/\.(zip|shp)$/i, '');
      const features: GeoJSONFeature[] = items
        .filter((f: any) => f?.geometry)
        .map((f: any, i: number) => {
          const gt = f.geometry.type;
          let shapeType: GeoJSONFeature['properties']['shapeType'] = 'Polygon';
          if (gt === 'Point' || gt === 'MultiPoint') shapeType = 'Marker';
          else if (gt === 'LineString' || gt === 'MultiLineString') shapeType = 'Line';

          return {
            ...f,
            properties: {
              id: crypto.randomUUID(),
              name: f.properties?.NAME || f.properties?.name || `${layerName}_${i + 1}`,
              description: f.properties?.description || '',
              color: '#3388ff',
              shapeType,
              layerId,
            },
          };
        });

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      const converted = features.map((f) => convertFeatureCoords(f, importCS as CoordSystem));
      dispatch({ type: 'BATCH_ADD_FEATURES', features: converted });
      alert(`成功导入 SHP: ${converted.length} 个要素 → 图层「${layerName}」 (${importCS.toUpperCase()})`);
    } catch (err: any) {
      alert(`SHP 解析失败: ${err.message || '未知错误'}`);
    }
    e.target.value = '';
  };

  const handleKmlImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');
      const errNode = xml.querySelector('parsererror');
      if (errNode) throw new Error('XML 解析失败');

      const { kml } = await import('@tmcw/togeojson');
      const geojson: any = kml(xml);

      const items: any[] =
        geojson.type === 'FeatureCollection'
          ? geojson.features
          : Array.isArray(geojson)
            ? geojson
            : geojson.type === 'Feature'
              ? [geojson]
              : [];

      if (items.length === 0) {
        alert('KML 文件中未找到有效要素');
        return;
      }

      const layerId = crypto.randomUUID();
      const layerName = file.name.replace(/\.kml$/i, '');
      const features: GeoJSONFeature[] = items
        .filter((f: any) => f?.geometry)
        .map((f: any, i: number) => {
          const gt = f.geometry.type;
          let shapeType: GeoJSONFeature['properties']['shapeType'] = 'Polygon';
          if (gt === 'Point' || gt === 'MultiPoint') shapeType = 'Marker';
          else if (gt === 'LineString' || gt === 'MultiLineString') shapeType = 'Line';

          return {
            ...f,
            properties: {
              id: crypto.randomUUID(),
              name: f.properties?.name || f.properties?.NAME || `${layerName}_${i + 1}`,
              description: f.properties?.description || '',
              color: f.properties?.stroke || '#3388ff',
              shapeType,
              layerId,
            },
          };
        });

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      const converted = features.map((f) => convertFeatureCoords(f, importCS as CoordSystem));
      dispatch({ type: 'BATCH_ADD_FEATURES', features: converted });
      alert(`成功导入 KML: ${converted.length} 个要素 → 图层「${layerName}」 (${importCS.toUpperCase()})`);
    } catch (err: any) {
      alert(`KML 解析失败: ${err.message || '未知错误'}`);
    }
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group search-group">
        <input
          className="search-input"
          type="text"
          placeholder="地名或坐标，如 北京 / 39.9,116.4"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <button className="toolbar-btn" onClick={handleSearch} title="搜索定位">
          <Search size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleLocate} title="我的位置 (GPS)">
          <Crosshair size={16} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${activeTool === 'Marker' ? 'active' : ''}`}
          title="绘制点"
          onClick={() => handleToolClick('Marker')}
        >
          <MapPin size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Line' ? 'active' : ''}`}
          title="绘制线"
          onClick={() => handleToolClick('Line')}
        >
          <Minus size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Polygon' ? 'active' : ''}`}
          title="绘制面"
          onClick={() => handleToolClick('Polygon')}
        >
          <Hexagon size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Rectangle' ? 'active' : ''}`}
          title="绘制矩形"
          onClick={() => handleToolClick('Rectangle')}
        >
          <Square size={18} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${activeTool === 'Edit' ? 'active' : ''}`}
          title="编辑几何"
          onClick={() => handleToolClick('Edit')}
        >
          <Pencil size={18} />
        </button>
        <button
          className={`toolbar-btn danger ${activeTool === 'Remove' ? 'active' : ''}`}
          title="删除要素"
          onClick={() => handleToolClick('Remove')}
        >
          <Trash2 size={18} />
        </button>
      </div>

      <div className="toolbar-group">
        <span className="toolbar-separator" />
        <Layers size={15} className="toolbar-inline-icon" />
        <select
          className="basemap-select"
          value={state.basemap}
          onChange={(e) =>
            dispatch({ type: 'SET_BASEMAP', basemap: e.target.value })
          }
        >
          {BASEMAP_OPTIONS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <select
          className="cs-select"
          value={importCS}
          onChange={(e) => saveImportCS(e.target.value)}
          title="导入坐标系"
        >
          <option value="wgs84">WGS-84</option>
          <option value="gcj02">GCJ-02</option>
          <option value="bd09">BD-09</option>
        </select>
        <button
          className="toolbar-btn"
          title="导入 KML"
          onClick={() => kmlInputRef.current?.click()}
        >
          <span className="toolbar-label">KML</span>
        </button>
        <button
          className="toolbar-btn"
          title="导入 SHP (ZIP)"
          onClick={() => shpInputRef.current?.click()}
        >
          <Package size={18} />
        </button>
        <button
          className="toolbar-btn"
          title="导入 GeoJSON"
          onClick={() => {
            setImportType('geojson');
            fileInputRef.current?.click();
          }}
        >
          <FileJson size={18} />
        </button>
        <button
          className="toolbar-btn"
          title="导入 CSV"
          onClick={() => {
            setImportType('csv');
            fileInputRef.current?.click();
          }}
        >
          <Table size={18} />
        </button>
        <button
          className="toolbar-btn"
          title="导出 GeoJSON"
          onClick={handleExportGeoJSON}
        >
          <Download size={18} />
          <span className="toolbar-label">GEO</span>
        </button>
        <button
          className="toolbar-btn"
          title="导出 CSV（仅点位）"
          onClick={handleExportCSV}
        >
          <Download size={18} />
          <span className="toolbar-label">CSV</span>
        </button>
      </div>

      <input
        ref={kmlInputRef}
        type="file"
        accept=".kml"
        style={{ display: 'none' }}
        onChange={handleKmlImport}
      />
      <input
        ref={shpInputRef}
        type="file"
        accept=".zip,.shp"
        style={{ display: 'none' }}
        onChange={handleShpImport}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={importType === 'geojson' ? '.geojson,.json' : '.csv'}
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
