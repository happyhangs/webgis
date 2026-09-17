import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsLeft, Database, Loader2, Map as MapIcon, ScanEye } from 'lucide-react';
import { useDraggablePanel } from './useDraggablePanel';
import { stopFloatingPanelButtonEvent, useFloatingPanels } from './FloatingPanelContext';
import { useManualLabelLayer } from './hooks/useManualLabelLayer';
import { useAppContext } from './AppContext';
import { DEFAULT_BACKEND_URL } from './backendUrl';
import { buildAmapDataset, persistDatasetFile } from './hooks/useYoloExport';
import { useYoloInference } from './hooks/useYoloInference';
import { YoloInferenceCard } from './components/YoloInferenceCard';
import { createUploadedImageBlob, readGeoTiffBounds } from './utils/yoloDataset';
import type { Bounds } from './utils/yoloDataset';
import type { AdminRegion } from './utils/adminRegions';
import type { GeoJSONFeature, TrainingMapDraft } from './types';
import type { MapAPI } from './utils/mapAPI';

const ADMIN_RANGE_LAYER_NAME = '行政区识别范围';

type OpenTraining = (dataset?: File | null, mapDraft?: TrainingMapDraft | null) => void;

function readLastTrainedModel() {
  if (typeof window === 'undefined') return { path: '', name: '' };
  try {
    return {
      path: localStorage.getItem('webgis:lastTrainedModelPath') || '',
      name: localStorage.getItem('webgis:lastTrainedModelName') || '',
    };
  } catch {
    return { path: '', name: '' };
  }
}

export default function FieldDetectPanel({ onOpenTraining }: { onOpenTraining?: OpenTraining }) {
  const { state, dispatch } = useAppContext();
  const { isPanelOpen, closePanel } = useFloatingPanels();
  const { panelRef, panelStyle, dragging, dragHandleProps, resizeHandle } = useDraggablePanel();
  const { manualLabelFeatures, bounds } = useManualLabelLayer();

  const [modelFile, setModelFile] = useState<File | null>(null);
  const [trainedModel, setTrainedModel] = useState(readLastTrainedModel);
  const [yoloConfidence, setYoloConfidence] = useState(0.25);
  const [yoloIou, setYoloIou] = useState(0.45);
  const [minAreaM2, setMinAreaM2] = useState(200);
  const [selectingMapDraft, setSelectingMapDraft] = useState(false);
  const [preparingDataset, setPreparingDataset] = useState(false);
  const [trainingMessage, setTrainingMessage] = useState('');
  const [localImageFile, setLocalImageFile] = useState<File | null>(null);
  const [localImageBounds, setLocalImageBounds] = useState<Bounds | null>(null);
  const [localImageStatus, setLocalImageStatus] = useState('');
  const [selectingLocalBounds, setSelectingLocalBounds] = useState(false);
  const localPreviewUrlRef = useRef('');

  const {
    handleInference,
    handleCaptureAndInfer,
    handleSelectAndInfer,
    handleBoundsAndInfer,
    inferring,
    inferenceMessage,
  } = useYoloInference(
    localImageFile,
    localImageBounds,
    localImageBounds,
    'upload',
    modelFile,
    trainedModel.path,
    yoloConfidence,
    yoloIou,
    minAreaM2,
  );

  useEffect(() => {
    const refresh = () => setTrainedModel(readLastTrainedModel());
    window.addEventListener('webgis-trained-model', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('webgis-trained-model', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => () => {
    (window as Window & { __webgis?: MapAPI }).__webgis?.clearTrainingImage();
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
  }, []);

  const showLocalPreview = useCallback(async (file: File, imageBounds: Bounds) => {
    const blob = await createUploadedImageBlob(file, 640);
    if (!blob) throw new Error('本地影像读取失败。');
    const api = (window as Window & { __webgis?: MapAPI }).__webgis;
    api?.clearTrainingImage();
    if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    localPreviewUrlRef.current = URL.createObjectURL(blob);
    dispatch({ type: 'SET_BASEMAP', basemap: 'offline' });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    api?.showTrainingImage(localPreviewUrlRef.current, imageBounds);
  }, [dispatch]);

  const handleLocalImageFileChange = useCallback(async (file: File | null) => {
    setLocalImageFile(file);
    setLocalImageBounds(null);
    setLocalImageStatus('');
    (window as Window & { __webgis?: MapAPI }).__webgis?.clearTrainingImage();
    if (localPreviewUrlRef.current) {
      URL.revokeObjectURL(localPreviewUrlRef.current);
      localPreviewUrlRef.current = '';
    }
    if (!file) return;
    if (!/\.(tif|tiff)$/i.test(file.name)) {
      setLocalImageStatus('普通图片没有定位信息，请点击“在地图上框选影像位置”。');
      return;
    }
    try {
      const imageBounds = await readGeoTiffBounds(file);
      if (!imageBounds) {
        setLocalImageStatus('该 GeoTIFF 不是 WGS84/CGCS2000 经纬度坐标，请在地图上框选位置。');
        return;
      }
      setLocalImageBounds(imageBounds);
      setLocalImageStatus('已从 GeoTIFF 自动读取位置，并切换到离线底图。');
      await showLocalPreview(file, imageBounds);
    } catch (error) {
      setLocalImageStatus(error instanceof Error ? error.message : 'GeoTIFF 读取失败，请手动框选位置。');
    }
  }, [showLocalPreview]);

  const handleSelectLocalBounds = useCallback(async () => {
    if (!localImageFile) return;
    const api = (window as Window & { __webgis?: MapAPI }).__webgis;
    setSelectingLocalBounds(true);
    setLocalImageStatus('请在地图上拖框，框住这张影像对应的真实位置。');
    try {
      const snapshot = await api?.selectMapSnapshot();
      const imageBounds = snapshot?.selectionBounds ?? snapshot?.bounds;
      if (!imageBounds) {
        setLocalImageStatus('没有选择影像位置。');
        return;
      }
      setLocalImageBounds(imageBounds);
      setLocalImageStatus('影像位置已设置，并切换到离线底图。');
      await showLocalPreview(localImageFile, imageBounds);
    } catch (error) {
      setLocalImageStatus(error instanceof Error ? error.message : '影像位置设置失败。');
    } finally {
      setSelectingLocalBounds(false);
    }
  }, [localImageFile, showLocalPreview]);

  const handleOpenLocalTraining = useCallback(async () => {
    if (!localImageFile || !localImageBounds) return;
    setTrainingMessage('正在读取本地影像...');
    try {
      const blob = await createUploadedImageBlob(localImageFile, 640);
      if (!blob) throw new Error('本地影像读取失败。');
      onOpenTraining?.(null, {
        imageUrl: URL.createObjectURL(blob),
        sourceType: 'local',
        amapCenter: [
          (localImageBounds.west + localImageBounds.east) / 2,
          (localImageBounds.south + localImageBounds.north) / 2,
        ],
        bounds: localImageBounds,
        zoom: 0,
        sourceName: `本地影像：${localImageFile.name}`,
        createdAt: Date.now(),
      });
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : '本地影像无法进入训练中心。');
    }
  }, [localImageBounds, localImageFile, onOpenTraining]);

  const handleOpenTrainingWithLabels = useCallback(async () => {
    if (!bounds || manualLabelFeatures.length === 0) {
      setTrainingMessage('还没有可复用的面标注，请先框选地图进入训练中心标注。');
      return;
    }
    setPreparingDataset(true);
    setTrainingMessage('正在把历史标注与对应卫星影像整理为训练集...');
    try {
      const blob = await buildAmapDataset(manualLabelFeatures, bounds);
      const file = new File(
        [blob],
        `farmland_labels_${new Date().toISOString().slice(0, 10)}.zip`,
        { type: 'application/zip' },
      );
      await persistDatasetFile(file);
      setTrainingMessage(`已保存并转入 ${manualLabelFeatures.length} 个历史标注。`);
      onOpenTraining?.(file, null);
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : '历史标注训练集生成失败。');
    } finally {
      setPreparingDataset(false);
    }
  }, [bounds, manualLabelFeatures, onOpenTraining]);

  const handleAdminRegionSelected = useCallback((region: AdminRegion) => {
    const existingLayer = state.layers.find((layer) => layer.name === ADMIN_RANGE_LAYER_NAME);
    const layerId = existingLayer?.id || crypto.randomUUID();
    const feature: GeoJSONFeature = {
      type: 'Feature',
      geometry: region.geometry as unknown as GeoJSONFeature['geometry'],
      properties: {
        id: crypto.randomUUID(),
        name: region.name,
        description: '农田识别行政区范围',
        color: '#0a84ff',
        fillColor: '#a5d8ff',
        fillEnabled: true,
        strokeStyle: 'dashed',
        strokeWidth: 2,
        shapeType: 'Polygon',
        layerId,
        parcelRole: 'boundary',
        source: 'admin-region',
      },
    };
    if (existingLayer) dispatch({ type: 'CLEAR_LAYER_FEATURES', layerId });
    else dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: ADMIN_RANGE_LAYER_NAME, visible: true } });
    dispatch({ type: 'BATCH_ADD_FEATURES', features: [feature] });
    dispatch({ type: 'SET_CURRENT_LAYER', id: layerId });
    window.setTimeout(() => (window as Window & { __webgis?: MapAPI }).__webgis?.flyToFeature(feature), 0);
  }, [dispatch, state.layers]);

  const handleAdminRegionInference = useCallback(async (region: AdminRegion) => {
    handleAdminRegionSelected(region);
    await handleBoundsAndInfer(region.bounds, region.name);
  }, [handleAdminRegionSelected, handleBoundsAndInfer]);

  const handleOpenMapDraftTraining = useCallback(async () => {
    const api = (window as Window & { __webgis?: MapAPI }).__webgis;
    setSelectingMapDraft(true);
    setTrainingMessage('请在地图上拖拽框选训练区域，按 Esc 可取消。');
    try {
      const snapshot = await (api?.selectMapSnapshot?.() || Promise.resolve(api?.getMapSnapshot?.() || null));
      if (!snapshot) {
        setTrainingMessage('未选择地图区域。');
        return;
      }
      const [lng, lat] = snapshot.amapCenter;
      const zoom = snapshot.zoom;
      const mapDraft: TrainingMapDraft = {
        imageUrl: `${DEFAULT_BACKEND_URL}/amap-static?location=${lng.toFixed(6)},${lat.toFixed(6)}&zoom=${zoom}&size=640*640&style=satellite`,
        amapCenter: [lng, lat],
        bounds: snapshot.bounds,
        zoom,
        sourceName: `地图选区 z${zoom}`,
        createdAt: Date.now(),
      };
      setTrainingMessage('已把地图选区转入训练中心。');
      onOpenTraining?.(null, mapDraft);
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : '地图选区读取失败。');
    } finally {
      setSelectingMapDraft(false);
    }
  }, [onOpenTraining]);

  if (!isPanelOpen('farm')) return null;

  return (
    <aside ref={panelRef} className={`panel floating-panel farm-detect-panel${dragging ? ' is-dragging' : ''}`} style={panelStyle}>
      <div className="farm-detect-header floating-panel-drag-handle" {...dragHandleProps}>
        <span className="farm-detect-title"><ScanEye size={15} />农田识别</span>
        <button className="panel-toggle" onPointerDown={stopFloatingPanelButtonEvent}
          onClick={(event) => { stopFloatingPanelButtonEvent(event); closePanel('farm'); }}
          title="最小化至属性栏" aria-label="最小化农田识别面板"><ChevronsLeft size={14} /></button>
      </div>
      <div className="farm-detect-body">
        <YoloInferenceCard
          captureDisabled={false}
          inferring={inferring}
          message={inferenceMessage}
          modelFile={modelFile}
          trainedModelPath={trainedModel.path}
          trainedModelName={trainedModel.name}
          yoloConfidence={yoloConfidence}
          setYoloConfidence={setYoloConfidence}
          yoloIou={yoloIou}
          setYoloIou={setYoloIou}
          minAreaM2={minAreaM2}
          setMinAreaM2={setMinAreaM2}
          localImageFile={localImageFile}
          localImageBounds={localImageBounds}
          localImageStatus={localImageStatus}
          selectingLocalBounds={selectingLocalBounds}
          onLocalImageFileChange={handleLocalImageFileChange}
          onSelectLocalBounds={handleSelectLocalBounds}
          onRunLocalImage={handleInference}
          onOpenLocalTraining={handleOpenLocalTraining}
          onModelFileChange={setModelFile}
          onCaptureAndRun={handleCaptureAndInfer}
          onSelectAndRun={handleSelectAndInfer}
          onAdminRegionSelected={handleAdminRegionSelected}
          onRunAdminRegion={handleAdminRegionInference}
        />

        <div className="farm-step-card">
          <div className="farm-step-header">
            <span className="farm-step-num"><Database size={14} /></span>
            <span className="farm-step-title">训练与标注</span>
          </div>
          <div className="farm-detect-note">
            数据准备、标注、训练参数、实时曲线和日志统一放在训练中心。
          </div>
          <div className="farm-step-meta">
            <span>历史面标注 <strong>{manualLabelFeatures.length}</strong> 个</span>
          </div>
          <button className="farm-primary-btn" type="button" onClick={handleOpenTrainingWithLabels}
            disabled={preparingDataset || selectingMapDraft || manualLabelFeatures.length === 0}
            style={{ width: '100%', marginTop: 8 }}>
            {preparingDataset ? <Loader2 size={14} className="farm-spin" /> : <Database size={14} />}
            {preparingDataset ? '正在整理训练集...' : `用现有 ${manualLabelFeatures.length} 个标注训练`}
          </button>
          <button className="farm-secondary-btn" type="button" onClick={handleOpenMapDraftTraining}
            disabled={preparingDataset || selectingMapDraft} style={{ width: '100%', marginTop: 6 }}>
            {selectingMapDraft ? <Loader2 size={14} className="farm-spin" /> : <MapIcon size={14} />}
            {selectingMapDraft ? '等待地图框选...' : '框选地图并去标注'}
          </button>
          <button className="farm-secondary-btn" type="button" onClick={() => onOpenTraining?.(null, null)}
            disabled={preparingDataset || selectingMapDraft} style={{ width: '100%', marginTop: 6 }}>
            打开训练中心
          </button>
          {trainingMessage && (
            <div className={`farm-yolo-message${trainingMessage.includes('失败') ? ' error' : ' success'}`} style={{ marginTop: 6 }}>
              {trainingMessage}
            </div>
          )}
        </div>
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
