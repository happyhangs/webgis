import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../AppContext';
import { buildManualLabelUpdates, exportManualYoloDatasetToBlob } from '../utils/yoloDataset';
import { readSSEStream } from '../utils/sseStream';
import { readableTrainError } from '../utils/trainError';
import type { Bounds, ManualDatasetSource } from '../utils/yoloDataset';
import type { GeoJSONFeature } from '../types';
import { buildAmapDataset } from './useYoloExport';
import { DEFAULT_BACKEND_URL } from '../backendUrl';

const LAST_MODEL_PATH_KEY = 'webgis:lastTrainedModelPath';
const LAST_MODEL_NAME_KEY = 'webgis:lastTrainedModelName';

function readLastTrainedModel() {
  try {
    return {
      path: localStorage.getItem(LAST_MODEL_PATH_KEY) || '',
      name: localStorage.getItem(LAST_MODEL_NAME_KEY) || '',
    };
  } catch {
    return { path: '', name: '' };
  }
}

export function useYoloTraining(
  labelLayerId: string,
  manualLabelFeatures: GeoJSONFeature[],
  bounds: Bounds | null,
  imageBounds: Bounds | null,
  manualSource: ManualDatasetSource,
  labelFile: File | null,
  outputName: string,
  backendUrl: string = DEFAULT_BACKEND_URL,
) {
  const { state, dispatch } = useAppContext();
  const [training, setTraining] = useState(false);
  const [trainEpoch, setTrainEpoch] = useState(0);
  const [trainTotalEpochs, setTrainTotalEpochs] = useState(100);
  const [trainMetrics, setTrainMetrics] = useState<Record<string, number>>({});
  const [trainMessage, setTrainMessage] = useState('');
  const [trainedModelPath, setTrainedModelPath] = useState(() => readLastTrainedModel().path);
  const [trainedModelName, setTrainedModelName] = useState(() => readLastTrainedModel().name);

  const rememberTrainedModel = useCallback((path: string, name = '') => {
    setTrainedModelPath(path);
    setTrainedModelName(name);
    try {
      localStorage.setItem(LAST_MODEL_PATH_KEY, path);
      localStorage.setItem(LAST_MODEL_NAME_KEY, name);
      window.dispatchEvent(new Event('webgis-trained-model'));
    } catch {
      // localStorage can be blocked; component state is still usable.
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const last = readLastTrainedModel();
      setTrainedModelPath(last.path);
      setTrainedModelName(last.name);
    };
    window.addEventListener('webgis-trained-model', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('webgis-trained-model', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const handleTrainInBrowser = useCallback(async () => {
    setTrainMessage('');
    if (!labelLayerId || manualLabelFeatures.length === 0 || !bounds) {
      setTrainMessage('请先绘制标定面。'); return;
    }
    if (manualSource === 'upload' && !labelFile) {
      setTrainMessage('上传影像模式需先选择文件。'); return;
    }
    if (manualSource === 'upload' && !imageBounds) {
      setTrainMessage('请先设置影像覆盖范围，再提交训练。'); return;
    }
    setTraining(true); setTrainEpoch(0); setTrainMetrics({});
    try {
      const updates = buildManualLabelUpdates(manualLabelFeatures);
      updates.forEach((item) => dispatch({ type: 'UPDATE_FEATURE', id: item.id, updates: item.updates }));
      const blob = manualSource === 'amap'
        ? await buildAmapDataset(manualLabelFeatures, bounds)
        : await exportManualYoloDatasetToBlob({
          layers: state.layers, features: state.features,
          boundsLayerId: labelLayerId, labelLayerId,
          imageBounds, sourceMode: manualSource, uploadFile: labelFile, tileSize: 640,
        });
      const formData = new FormData();
      formData.append('dataset', blob, 'farmland_dataset.zip');
      formData.append('epochs', String(trainTotalEpochs));
      formData.append('patience', '30');
      formData.append('output_name', outputName || 'farmland_seg');
      const resp = await fetch(backendUrl + "/train", { method: 'POST', body: formData });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let errMsg = errText;
        try { const errJson = JSON.parse(errText); errMsg = errJson.error || errText; } catch {}
        throw new Error(errMsg || ("HTTP " + resp.status));
      }
      await readSSEStream(resp, (d: Record<string, any>) => {
        setTrainEpoch(d.epoch || 0);
        setTrainMetrics(d.metrics || {});
        if (d.modelPath) {
          rememberTrainedModel(String(d.modelPath), String(d.modelName || ''));
        }
        if (d.status === 'done') { setTrainMessage("训练完成！" + (d.modelPath || '')); setTraining(false); }
        else if (d.status === 'failed') { setTrainMessage("训练失败：" + readableTrainError(d.error || '未知错误')); setTraining(false); }
      });
    } catch (e: any) {
      setTrainMessage("训练失败：" + readableTrainError(e?.message || '未知错误'));
      setTraining(false);
    }
  }, [backendUrl, bounds, imageBounds, dispatch, labelFile, labelLayerId, manualLabelFeatures, manualSource, outputName, rememberTrainedModel, state.features, state.layers, trainTotalEpochs]);

  return {
    handleTrainInBrowser, training, trainEpoch, trainTotalEpochs,
    setTrainTotalEpochs, trainMetrics, trainMessage, setTrainMessage,
    trainedModelPath, trainedModelName,
  };
}
