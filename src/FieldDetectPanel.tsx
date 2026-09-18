import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsLeft, Database, Loader2, Map as MapIcon, ScanEye, Sparkles, Square } from 'lucide-react';
import { useDraggablePanel } from './useDraggablePanel';
import { stopFloatingPanelButtonEvent, useFloatingPanels } from './FloatingPanelContext';
import { useManualLabelLayer } from './hooks/useManualLabelLayer';
import { useAppContext } from './AppContext';
import { persistDatasetFile } from './hooks/useYoloExport';
import { buildAmapDataset } from './utils/amapDataset';
import { RESULT_LAYER_NAME, useYoloInference } from './hooks/useYoloInference';
import { YoloInferenceCard } from './components/YoloInferenceCard';
import AnnotationToolbar from './components/AnnotationToolbar';
import type { AnnotationTool } from './components/AnnotationToolbar';
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
  const {
    manualLabelFeatures,
    bounds,
    labelMode,
    activateLabelLayer,
    deactivateLabelLayer,
    importRecognitionFeatures,
    startLabelDrawing,
    startLabelRemoval,
    undoLastBlock,
    canUndo,
  } = useManualLabelLayer();

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
  const [annTool, setAnnTool] = useState<AnnotationTool>('draw');
  const localPreviewUrlRef = useRef('');
  /** 数据集生成（逐地块取图）的停止标记。 */
  const prepareCancelRef = useRef(false);

  const {
    handleInference,
    handleCaptureAndInfer,
    handleSelectAndInfer,
    handleBoundsAndInfer,
    cancelInference,
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
    prepareCancelRef.current = false;
    setTrainingMessage(`正在生成训练样本（逐地块高清取样 0/${manualLabelFeatures.length}）...`);
    try {
      const result = await buildAmapDataset(manualLabelFeatures, {
        onProgress: ({ done, total }) =>
          setTrainingMessage(`正在生成训练样本 ${done}/${total}（逐地块高清取样，可停止）...`),
        shouldCancel: () => prepareCancelRef.current,
      });
      const file = new File(
        [result.blob],
        `farmland_labels_${new Date().toISOString().slice(0, 10)}.zip`,
        { type: 'application/zip' },
      );
      await persistDatasetFile(file);
      const failNote = result.failedCount > 0 ? `，${result.failedCount} 个样本取图失败已跳过` : '';
      if (result.cancelled) {
        // 用户主动停止：保留已完成的样本，但不强制跳转训练中心
        setTrainingMessage(
          `已停止（生成 ${result.sampleCount}/${result.plannedCount} 个样本${failNote}，已保存到训练数据列表，可随时重试）。`,
        );
      } else {
        setTrainingMessage(
          `已生成 ${result.sampleCount} 个训练样本${failNote}（对应 ${manualLabelFeatures.length} 个标注），转入训练中心。`,
        );
        onOpenTraining?.(file, null);
      }
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

  const handleFinishHomeLabeling = useCallback(() => {
    deactivateLabelLayer();
    setAnnTool('draw');
    dispatch({ type: 'SET_CURRENT_LAYER', id: '__default__' });
  }, [deactivateLabelLayer, dispatch]);

  const handleSelectDrawTool = useCallback(() => {
    setAnnTool('draw');
    startLabelDrawing();
  }, [startLabelDrawing]);

  const handleSelectRemoveTool = useCallback(() => {
    setAnnTool('remove');
    startLabelRemoval();
  }, [startLabelRemoval]);

  const handleUndoBlock = useCallback(() => {
    undoLastBlock();
  }, [undoLastBlock]);

  const handleOpenHomeLabeling = useCallback(async () => {
    const api = (window as Window & { __webgis?: MapAPI }).__webgis;
    if (labelMode) return;
    setSelectingMapDraft(true);
    setTrainingMessage('请在地图上拖拽框选标注区域，按 Esc 可取消。');
    try {
      const snapshot = await (api?.selectMapSnapshot?.() || Promise.resolve(api?.getMapSnapshot?.() || null));
      if (!snapshot) {
        setTrainingMessage('未选择地图区域。');
        return;
      }
      const satBasemap = state.basemap === 'amap_sat' || state.basemap === 'amap_hybrid' || state.basemap === 'google_sat';
      setTrainingMessage(
        satBasemap
          ? '已进入标注模式：请沿农田边界连续勾画地块，自动编号。'
          : '已进入标注模式：请沿农田边界连续勾画地块。提示：切换到卫星底图更容易看清田块边界。',
      );
      // 飞到选区（selectionBounds 为用户拖框的真实范围；无则用整幅视图）
      const target = snapshot.selectionBounds ?? snapshot.bounds;
      window.setTimeout(() => {
        api?.flyTo((target.south + target.north) / 2, (target.west + target.east) / 2);
      }, 0);
      // 直接在主页面进入农田人工标定层连续标注模式
      setAnnTool('draw');
      activateLabelLayer();
    } catch (error) {
      setTrainingMessage(error instanceof Error ? error.message : '地图选区读取失败。');
    } finally {
      setSelectingMapDraft(false);
    }
  }, [activateLabelLayer, labelMode, state.basemap]);

  // 地图卸载（例如进入训练中心）时退出标注模式，避免状态悬空
  const deactivateRef = useRef(deactivateLabelLayer);
  deactivateRef.current = deactivateLabelLayer;
  useEffect(() => () => {
    deactivateRef.current();
  }, []);

  // 「农田模型识别」图层中的识别结果（可一键转为人工标定做修正）
  const recognitionFeatures = useMemo(() => {
    const resultLayer = state.layers.find((layer) => layer.name === RESULT_LAYER_NAME);
    if (!resultLayer) return [] as GeoJSONFeature[];
    return state.features.filter(
      (feature) =>
        feature.properties.layerId === resultLayer.id &&
        (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'),
    );
  }, [state.features, state.layers]);

  const handleAdoptRecognition = useCallback(() => {
    if (recognitionFeatures.length === 0) return;
    const { added, skipped, lowConfidence } = importRecognitionFeatures(recognitionFeatures);
    if (added > 0) {
      const resultLayer = state.layers.find((layer) => layer.name === RESULT_LAYER_NAME);
      if (resultLayer) dispatch({ type: 'CLEAR_LAYER_FEATURES', layerId: resultLayer.id });
      const base = `已把 ${added} 块识别结果转为人工标定${skipped > 0 ? `（跳过 ${skipped} 块与已有标定重复）` : ''}`;
      setTrainingMessage(
        lowConfidence > 0
          ? `${base}；其中 ${lowConfidence} 块置信度低于 50%，建议在「地块管理」按置信度排序优先核对。`
          : `${base}，可在「地块管理」逐块核对后训练。`,
      );
    } else {
      setTrainingMessage(`识别结果与已有标定重复（${skipped} 块），无需转换。`);
    }
  }, [dispatch, importRecognitionFeatures, recognitionFeatures, state.layers]);

  return (
    <>
      {labelMode && (
        <AnnotationToolbar
          count={manualLabelFeatures.length}
          tool={annTool}
          canUndo={canUndo}
          onSelectDraw={handleSelectDrawTool}
          onSelectRemove={handleSelectRemoveTool}
          onUndo={handleUndoBlock}
          onFinish={handleFinishHomeLabeling}
        />
      )}
      {isPanelOpen('farm') && (
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
          onCancelInference={cancelInference}
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
            {recognitionFeatures.length > 0 && (
              <span>识别结果 <strong>{recognitionFeatures.length}</strong> 块待处理</span>
            )}
          </div>
          {recognitionFeatures.length > 0 && (
            <button className="farm-secondary-btn" type="button" onClick={handleAdoptRecognition}
              disabled={preparingDataset || selectingMapDraft}
              style={{ width: '100%', marginTop: 8 }}>
              <Sparkles size={14} />
              {`把识别结果转为人工标定（${recognitionFeatures.length} 块）`}
            </button>
          )}
          <button className="farm-primary-btn" type="button" onClick={handleOpenTrainingWithLabels}
            disabled={preparingDataset || selectingMapDraft || manualLabelFeatures.length === 0}
            style={{ width: '100%', marginTop: 8 }}>
            {preparingDataset ? <Loader2 size={14} className="farm-spin" /> : <Database size={14} />}
            {preparingDataset ? '正在整理训练集...' : `用现有 ${manualLabelFeatures.length} 个标注训练`}
          </button>
          <button className="farm-secondary-btn" type="button" onClick={handleOpenHomeLabeling}
            disabled={preparingDataset || selectingMapDraft || labelMode} style={{ width: '100%', marginTop: 6 }}>
            {selectingMapDraft ? <Loader2 size={14} className="farm-spin" /> : <MapIcon size={14} />}
            {selectingMapDraft ? '等待地图框选...' : labelMode ? '标注进行中…' : '框选地图并去标注'}
          </button>
          {labelMode && (
            <button className="farm-primary-btn" type="button" onClick={handleFinishHomeLabeling}
              style={{ width: '100%', marginTop: 6 }}>
              <Check size={14} />
              {`完成标注（已标 ${manualLabelFeatures.length} 块）`}
            </button>
          )}
          <button className="farm-secondary-btn" type="button" onClick={() => onOpenTraining?.(null, null)}
            disabled={preparingDataset || selectingMapDraft} style={{ width: '100%', marginTop: 6 }}>
            打开训练中心
          </button>
          {trainingMessage && (
            <div className={`farm-yolo-message${trainingMessage.includes('失败') ? ' error' : ' success'}`} style={{ marginTop: 6 }}>
              <span>{trainingMessage}</span>
              {preparingDataset && (
                <button className="farm-stop-btn" type="button"
                  onClick={() => { prepareCancelRef.current = true; }}
                  title="停止生成，已完成的样本会保留" aria-label="停止生成训练样本">
                  <Square size={11} />停止
                </button>
              )}
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
      )}
    </>
  );
}
