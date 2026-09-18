import { useRef, useState, useCallback, useEffect } from 'react';
import {
  MapPin,
  Minus,
  Square,
  Hexagon,
  Pencil,
  Trash2,
  Download,
  Upload,
  Layers,
  Crosshair,
  Network,
  Loader2,
} from 'lucide-react';
import { useAppContext } from './AppContext';
import { BASEMAP_OPTIONS, CUSTOM_BASEMAP_KEY, saveCustomBasemap, loadCustomBasemap, clearCustomBasemap } from './basemaps';
import { exportGeoJSON, importGeoJSON } from './utils/geojson';
import { exportCSV, importCSV } from './utils/csv';
import { getDefaultFeatureStyle } from './utils/featureStyle';
import { getXmlParserError, validateKmlSource } from './utils/kml';
import type { GeoJSONFeature } from './types';

type ActiveTool =
  | 'Marker'
  | 'Line'
  | 'Polygon'
  | 'Rectangle'
  | 'Edit'
  | 'Remove'
  | null;

const SHP_SIDECAR_EXTS = new Set(['shp', 'dbf', 'prj', 'cpg']);

type ShpFileGroup = {
  stem: string;
  files: Partial<Record<'shp' | 'dbf' | 'prj' | 'cpg', File>>;
};

function collectGeoJSONFeatures(input: any): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(collectGeoJSONFeatures);
  if (input.type === 'FeatureCollection') return Array.isArray(input.features) ? input.features : [];
  if (input.type === 'Feature') return [input];
  return [];
}

function getFileExt(file: File) {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
}

function getFileStem(file: File) {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(0, dot) : file.name;
}

function groupShpSidecarFiles(files: File[]) {
  const groups = new Map<string, ShpFileGroup>();
  for (const file of files) {
    const ext = getFileExt(file);
    if (!SHP_SIDECAR_EXTS.has(ext)) continue;
    const stem = getFileStem(file);
    const key = stem.toLowerCase();
    const group = groups.get(key) || { stem, files: {} };
    group.files[ext as keyof ShpFileGroup['files']] = file;
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.files.shp);
}

function formatShpImportError(err: any) {
  const message = String(err?.message || err || '').trim();
  if (/but-unzip~1/.test(message)) {
    return 'SHP 解析失败：ZIP 使用了暂不支持的压缩方式。请重新压缩为普通 ZIP，或把同名 .shp、.dbf、.prj、.cpg 文件一起选中导入。';
  }
  if (/but-unzip~[23]/.test(message)) {
    return 'SHP 解析失败：当前文件不是可读取的普通 SHP ZIP，或 ZIP 结构不兼容。请直接选中同名 .shp、.dbf、.prj、.cpg 文件导入，或重新压缩为普通 ZIP 后再试。';
  }
  if (/no layers founds/i.test(message)) {
    return 'SHP 解析失败：文件中没有找到 .shp 图层，请确认 ZIP 内包含同名 .shp/.dbf/.prj 文件。';
  }
  return `SHP 解析失败：${message || '未知错误'}`;
}

export default function Toolbar({ onOpenTraining, visible }: { onOpenTraining?: () => void; visible?: boolean }) {
  const { state, dispatch } = useAppContext();
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shpInputRef = useRef<HTMLInputElement>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'geojson' | 'csv'>('geojson');
  const [searchText, setSearchText] = useState('');
  const [locating, setLocating] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customAttr, setCustomAttr] = useState('');
  const [customMaxZoom, setCustomMaxZoom] = useState('');

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = () => {
      setImportMenuOpen(false);
      setExportMenuOpen(false);
    };
    if (importMenuOpen || exportMenuOpen) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [importMenuOpen, exportMenuOpen]);

  // Reset activeTool when component becomes visible again (e.g. returning from TrainingPage)
  useEffect(() => {
    if (visible && !state.labelMode) {
      const a = api();
      a?.disableDraw();
      a?.disableEdit();
      a?.disableRemoval();
      setActiveTool(null);
    }
  }, [visible, state.labelMode]);

  const api = () => (window as any).__webgis;

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) { alert('浏览器不支持GPS定位'); return; }
    const a = api();
    if (!a) return;

    setLocating(true);

    let bestPos: GeolocationPosition | null = null;
    let resolved = false;

    const done = () => {
      setLocating(false);
      navigator.geolocation.clearWatch(watchId);
    };

    const tryResolve = (pos: GeolocationPosition) => {
      if (bestPos && pos.coords.accuracy >= bestPos.coords.accuracy) return;
      bestPos = pos;
      a.flyTo(pos.coords.latitude, pos.coords.longitude, 16);
      a.placeMarker(
        pos.coords.latitude,
        pos.coords.longitude,
        `我的位置 (${pos.coords.accuracy.toFixed(0)}m 精度)`,
      );
      if (pos.coords.accuracy < 30) {
        resolved = true;
        done();
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => tryResolve(pos),
      (err) => {
        if (!bestPos) alert('定位失败: ' + err.message);
        done();
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );

    setTimeout(() => {
      if (!resolved) done();
    }, 15000);
  }, [api]);

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

    alert(`未找到「${q}」，请输入有效坐标（如 39.9,116.4）。`);
  }, [searchText]);

  const handleToolClick = useCallback(
    (tool: ActiveTool) => {
      const a = api();
      if (!a) return;

      // 标注模式由地图顶部的标注工具条接管，通用工具全部停用（按钮已 disabled，此处兜底）
      if (state.labelMode) return;

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
        case 'Line':
          a.enableDraw(tool);
          break;
        case 'Polygon':
        case 'Rectangle':
          a.enableDraw(
            tool === 'Polygon' ? 'Polygon' : 'Rectangle',
          );
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
    [activeTool, state.labelMode, state.selectedFeatureId],
  );

  const handleExportGeoJSON = () => {
    const exportFeatures = state.features.filter(f => !f.properties.farmlandId);
    const blob = new Blob([exportGeoJSON(exportFeatures)], {
      type: 'application/geo+json',
    });
    downloadBlob(blob, 'webgis-export.geojson');
  };

  const handleExportCSV = () => {
    const exportFeatures = state.features.filter(f => !f.properties.farmlandId);
    const blob = new Blob([exportCSV(exportFeatures)], { type: 'text/csv' });
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
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const shp: any = await import('shpjs');
      const zipFiles = files.filter((file) => getFileExt(file) === 'zip');
      const geojsonResults: any[] = [];
      let layerName = '';

      if (zipFiles.length > 0) {
        for (const file of zipFiles) {
          const buf = await file.arrayBuffer();
          geojsonResults.push(await shp.default(buf));
        }
        layerName = zipFiles.length === 1 ? getFileStem(zipFiles[0]) : `SHP导入_${zipFiles.length}个压缩包`;
      } else {
        const groups = groupShpSidecarFiles(files);
        if (groups.length === 0) {
          throw new Error('请选择 .zip，或至少选择一个 .shp 文件。建议同时选择同名 .dbf/.prj/.cpg 文件。');
        }

        for (const group of groups) {
          geojsonResults.push(
            await (shp.default as any)({
              shp: await group.files.shp!.arrayBuffer(),
              dbf: group.files.dbf ? await group.files.dbf.arrayBuffer() : undefined,
              prj: group.files.prj ? await group.files.prj.arrayBuffer() : undefined,
              cpg: group.files.cpg ? await group.files.cpg.arrayBuffer() : undefined,
            }),
          );
        }
        layerName = groups.length === 1 ? groups[0].stem : `SHP导入_${groups.length}个图层`;
      }

      const items = geojsonResults.flatMap(collectGeoJSONFeatures);
      if (items.length === 0) {
        throw new Error('未找到可导入的几何要素。');
      }

      const layerId = crypto.randomUUID();
      const features: GeoJSONFeature[] = items
        .filter((f: any) => f?.geometry)
        .map((f: any, i: number) => {
          const gt = f.geometry.type;
          let shapeType: GeoJSONFeature['properties']['shapeType'] = 'Polygon';
          if (gt === 'Point' || gt === 'MultiPoint') shapeType = 'Marker';
          else if (gt === 'LineString' || gt === 'MultiLineString') shapeType = 'Line';
          const sourceProperties = f.properties || {};

          return {
            ...f,
            properties: {
              ...sourceProperties,
              id: crypto.randomUUID(),
              name: sourceProperties.NAME || sourceProperties.name || `${layerName}_${i + 1}`,
              description: sourceProperties.description || '',
              ...getDefaultFeatureStyle(shapeType),
              shapeType,
              layerId,
            },
          };
        });

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      alert(`成功导入 SHP: ${features.length} 个要素 → 图层&quot;${layerName}&quot;`);
    } catch (err: any) {
      console.error(err);
      alert(formatShpImportError(err));
    }
    e.target.value = '';
  };

  const handleBasemapChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === CUSTOM_BASEMAP_KEY) {
        const existing = loadCustomBasemap();
        if (existing) {
          setCustomName(existing.name);
          setCustomUrl(existing.url);
          setCustomAttr(existing.attribution || '');
          setCustomMaxZoom(existing.maxZoom ? String(existing.maxZoom) : '');
        } else {
          setCustomName('');
          setCustomUrl('');
          setCustomAttr('');
          setCustomMaxZoom('');
        }
        setCustomFormOpen(true);
        return;
      }
      dispatch({ type: 'SET_BASEMAP', basemap: value });
    },
    [dispatch],
  );

  const handleCustomSubmit = useCallback(() => {
    const name = customName.trim();
    const url = customUrl.trim();
    if (!name || !url) {
      alert('请填写底图名称和瓦片 URL');
      return;
    }
    if (!url.includes('{z}') && !url.includes('{x}') && !url.includes('{y}')) {
      alert('URL 模板需包含 {z}/{x}/{y} 占位符');
      return;
    }
    const attr = customAttr.trim();
    const maxZoomNum = customMaxZoom.trim() ? parseInt(customMaxZoom, 10) : undefined;
    const cfg = {
      name,
      url,
      attribution: attr || undefined,
      maxZoom: maxZoomNum && maxZoomNum > 0 ? maxZoomNum : undefined,
    };
    saveCustomBasemap(cfg);
    dispatch({ type: 'SET_CUSTOM_BASEMAP', customBasemap: cfg });
    dispatch({ type: 'SET_BASEMAP', basemap: CUSTOM_BASEMAP_KEY });
    setCustomFormOpen(false);
  }, [customName, customUrl, customAttr, customMaxZoom, dispatch]);

  const handleCustomCancel = useCallback(() => {
    setCustomFormOpen(false);
  }, []);

  const handleCustomRemove = useCallback(() => {
    clearCustomBasemap();
    dispatch({ type: 'SET_CUSTOM_BASEMAP', customBasemap: null });
    dispatch({ type: 'SET_BASEMAP', basemap: 'osm' });
    setCustomFormOpen(false);
    setCustomName('');
    setCustomUrl('');
    setCustomAttr('');
    setCustomMaxZoom('');
  }, [dispatch]);

  const handleKmlImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = validateKmlSource(await file.text());
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'text/xml');
      const parserError = getXmlParserError(xml);
      if (parserError) throw new Error(`XML 解析失败：${parserError}`);

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
      const features: GeoJSONFeature[] = [];
      let featureIndex = 0;

      for (const item of items) {
        if (!item?.geometry) continue;
        const gt = item.geometry.type;

        if (gt === 'GeometryCollection') {
          // KML MultiGeometry → GeoJSON GeometryCollection: split into individual features
          const subGeoms: any[] = item.geometry.geometries || [];
          for (const subGeom of subGeoms) {
            const sgt = subGeom?.type;
            if (!sgt) continue;
            let shapeType: GeoJSONFeature['properties']['shapeType'] = 'Polygon';
            if (sgt === 'Point' || sgt === 'MultiPoint') shapeType = 'Marker';
            else if (sgt === 'LineString' || sgt === 'MultiLineString') shapeType = 'Line';
            featureIndex++;
            const subFeature: GeoJSONFeature = {
              type: 'Feature',
              geometry: subGeom,
              properties: {
                id: crypto.randomUUID(),
                name: item.properties?.name || item.properties?.NAME
                  ? `${item.properties.name || item.properties.NAME}_${featureIndex}`
                  : `${layerName}_${featureIndex}`,
                description: item.properties?.description || '',
                ...getDefaultFeatureStyle(shapeType, item.properties?.stroke || '#3388ff'),
                shapeType,
                layerId,
              },
            };
            features.push(subFeature);
          }
        } else {
          let shapeType: GeoJSONFeature['properties']['shapeType'] = 'Polygon';
          if (gt === 'Point' || gt === 'MultiPoint') shapeType = 'Marker';
          else if (gt === 'LineString' || gt === 'MultiLineString') shapeType = 'Line';
          featureIndex++;
          features.push({
            ...item,
            properties: {
              id: crypto.randomUUID(),
              name: item.properties?.name || item.properties?.NAME || `${layerName}_${featureIndex}`,
              description: item.properties?.description || '',
              ...getDefaultFeatureStyle(shapeType, item.properties?.stroke || '#3388ff'),
              shapeType,
              layerId,
            },
          });
        }
      }

      if (features.length === 0) {
        if (items.length > 0) {
          const sampleItem = items[0];
          const hasGeom = !!sampleItem?.geometry;
          const geomType = sampleItem?.geometry?.type;
          alert(`KML 解析后未找到有效要素。文件包含 ${items.length} 个 Feature，首个要素: 有几何=${hasGeom}, 几何类型=${geomType || '无'}`);
        } else {
          alert('KML 文件中未找到有效要素');
        }
        return;
      }

      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: layerName, visible: true } });
      dispatch({ type: 'BATCH_ADD_FEATURES', features });
      alert(`成功导入 KML: ${features.length} 个要素 → 图层&quot;${layerName}&quot;`);
    } catch (err: any) {
      console.error('[KML Import]', err);
      const detail = err?.message || '未知错误';
      alert(`KML 导入失败：${detail}`);
    }
    e.target.value = '';
  };

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <span className="toolbar-brand-mark">
          <img src="/point-tool-icon.svg" alt="" />
        </span>
        <span className="toolbar-brand-title">点位工具</span>
      </div>

      <div className="toolbar-group">
        <button className="toolbar-btn analysis-btn" type="button" onClick={onOpenTraining} title="打开训练中心">
          <Network size={16} />
          <span className="toolbar-label">训练中心</span>
        </button>
      </div>

      <div className="toolbar-group search-group">
        <input
          className="search-input"
          type="text"
          aria-label="坐标搜索"
          placeholder="输入坐标，如 39.9,116.4"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
        <button className="toolbar-btn" onClick={handleSearch} title="坐标定位" aria-label="坐标定位">
          <MapPin size={16} />
        </button>
        <button className="toolbar-btn" onClick={handleLocate} disabled={locating} title={locating ? "定位中…" : "我的位置 (GPS)"} aria-label={locating ? '定位中' : '我的位置'}>
          {locating ? <Loader2 size={16} className="spin" /> : <Crosshair size={16} />}
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${activeTool === 'Marker' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请用地图顶部的标注工具' : '绘制点'}
          aria-label="绘制点"
          disabled={state.labelMode}
          onClick={() => handleToolClick('Marker')}
        >
          <MapPin size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Line' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请用地图顶部的标注工具' : '绘制线'}
          aria-label="绘制线"
          disabled={state.labelMode}
          onClick={() => handleToolClick('Line')}
        >
          <Minus size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Polygon' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请用地图顶部的标注工具' : '绘制面'}
          aria-label="绘制面"
          disabled={state.labelMode}
          onClick={() => handleToolClick('Polygon')}
        >
          <Hexagon size={18} />
        </button>
        <button
          className={`toolbar-btn ${activeTool === 'Rectangle' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请用地图顶部的标注工具' : '绘制矩形'}
          aria-label="绘制矩形"
          disabled={state.labelMode}
          onClick={() => handleToolClick('Rectangle')}
        >
          <Square size={18} />
        </button>
      </div>

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${activeTool === 'Edit' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请先完成标注' : '编辑几何'}
          aria-label="编辑几何"
          disabled={state.labelMode}
          onClick={() => handleToolClick('Edit')}
        >
          <Pencil size={18} />
        </button>
        <button
          className={`toolbar-btn danger ${activeTool === 'Remove' ? 'active' : ''}`}
          title={state.labelMode ? '标注模式中：请用标注工具条的「删错块」' : '删除要素'}
          aria-label="删除要素"
          disabled={state.labelMode}
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
          aria-label="选择底图"
          value={state.basemap}
          onChange={handleBasemapChange}
        >
          {BASEMAP_OPTIONS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.name}
            </option>
          ))}
          <option value={CUSTOM_BASEMAP_KEY}>
            {state.customBasemap ? `自定义: ${state.customBasemap.name}` : '自定义瓦片…'}
          </option>
        </select>
        {customFormOpen && (
          <div className="custom-basemap-overlay" onClick={handleCustomCancel}>
            <div className="custom-basemap-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>自定义瓦片底图</h3>
              <label>
                底图名称 <span className="required">*</span>
                <input
                  type="text"
                  placeholder="例如：我的无人机正射影像"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                  autoFocus
                />
              </label>
              <label>
                瓦片 URL 模板 <span className="required">*</span>
                <input
                  type="text"
                  placeholder="https://.../{z}/{x}/{y}.png"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                />
                <span className="hint">支持 {`{z}`}/{`{x}`}/{`{y}`} 和 {`{s}`} 子域占位符</span>
              </label>
              <label>
                最大缩放级别
                <input
                  type="number"
                  min="1"
                  max="22"
                  placeholder="默认 19"
                  value={customMaxZoom}
                  onChange={(e) => setCustomMaxZoom(e.target.value)}
                />
              </label>
              <label>
                版权标注
                <input
                  type="text"
                  placeholder="例如：&copy; MyOrg"
                  value={customAttr}
                  onChange={(e) => setCustomAttr(e.target.value)}
                />
              </label>
              <div className="custom-basemap-actions">
                <button className="toolbar-btn primary" onClick={handleCustomSubmit}>
                  确认添加
                </button>
                <button className="toolbar-btn" onClick={handleCustomCancel}>
                  取消
                </button>
                {state.customBasemap && (
                  <button className="toolbar-btn danger" onClick={handleCustomRemove}>
                    移除自定义
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="toolbar-group">
      </div>

      <div className="toolbar-group">
        <div className="toolbar-dropdown">
          <button
            className="toolbar-btn"
            title="导入"
            onClick={(e) => { e.stopPropagation(); setImportMenuOpen(!importMenuOpen); }}
          >
            <Upload size={18} />
            <span className="toolbar-label">导入</span>
          </button>
          {importMenuOpen && (
            <div className="toolbar-dropdown-menu">
              <button onClick={(e) => { e.stopPropagation(); kmlInputRef.current?.click(); setImportMenuOpen(false); }}>KML</button>
              <button onClick={(e) => { e.stopPropagation(); shpInputRef.current?.click(); setImportMenuOpen(false); }}>SHP (ZIP)</button>
              <button onClick={(e) => { e.stopPropagation(); setImportType('geojson'); fileInputRef.current?.click(); setImportMenuOpen(false); }}>GeoJSON</button>
              <button onClick={(e) => { e.stopPropagation(); setImportType('csv'); fileInputRef.current?.click(); setImportMenuOpen(false); }}>CSV</button>
            </div>
          )}
        </div>
        <div className="toolbar-dropdown">
          <button
            className="toolbar-btn"
            title="导出"
            onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
          >
            <Download size={18} />
            <span className="toolbar-label">导出</span>
          </button>
          {exportMenuOpen && (
            <div className="toolbar-dropdown-menu">
              <button onClick={(e) => { e.stopPropagation(); handleExportGeoJSON(); setExportMenuOpen(false); }}>GeoJSON</button>
              <button onClick={(e) => { e.stopPropagation(); handleExportCSV(); setExportMenuOpen(false); }}>CSV</button>
            </div>
          )}
        </div>
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
        accept=".zip,.shp,.dbf,.prj,.cpg"
        multiple
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
