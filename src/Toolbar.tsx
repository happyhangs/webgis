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
} from 'lucide-react';
import { useAppContext } from './AppContext';
import { BASEMAP_OPTIONS } from './basemaps';
import { exportGeoJSON, importGeoJSON } from './utils/geojson';
import { exportCSV, importCSV } from './utils/csv';
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
  const [importType, setImportType] = useState<'geojson' | 'csv'>('geojson');

  const api = () => (window as any).__webgis;

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
        if (features.length === 0) {
          alert('未找到有效数据');
          return;
        }
        // Merge with existing — avoid duplicate IDs
        const existingIds = new Set(state.features.map((f) => f.properties.id));
        const newFeatures = features.filter(
          (f) => !existingIds.has(f.properties.id),
        );
        dispatch({
          type: 'SET_FEATURES',
          features: [...state.features, ...newFeatures],
        });
        alert(`成功导入 ${newFeatures.length} 个要素`);
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
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      alert(`成功导入 SHP: ${features.length} 个要素 → 图层「${layerName}」`);
    } catch (err: any) {
      alert(`SHP 解析失败: ${err.message || '未知错误'}`);
    }
    e.target.value = '';
  };

  return (
    <div className="toolbar">
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
