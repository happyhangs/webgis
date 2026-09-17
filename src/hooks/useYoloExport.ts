import { useCallback, useState } from 'react';
import { useAppContext } from '../AppContext';
import { buildManualLabelUpdates, buildYoloDatasetZipFromImage, exportManualYoloDatasetToBlob } from '../utils/yoloDataset';
import { fitAmapStaticToWgsBounds } from '../utils/amapStatic';
import { DEFAULT_BACKEND_URL } from '../backendUrl';
import type { Bounds, ManualDatasetSource } from '../utils/yoloDataset';
import type { GeoJSONFeature } from '../types';

export function useYoloExport(
  labelLayerId: string,
  manualLabelFeatures: GeoJSONFeature[],
  bounds: Bounds | null,
  imageBounds: Bounds | null,
  manualSource: ManualDatasetSource,
  labelFile: File | null,
) {
  const { state, dispatch } = useAppContext();
  const [manualExporting, setManualExporting] = useState(false);
  const [manualMessage, setManualMessage] = useState('');

  const buildYoloDatasetFile = useCallback(async (_requireTrainImage = true): Promise<File | null> => {
    setManualMessage('');
    if (!labelLayerId || manualLabelFeatures.length === 0) {
      setManualMessage('请先绘制标定面。'); return null;
    }
    if (!bounds) { setManualMessage('无法计算标注范围。'); return null; }
    if (manualSource === 'upload' && !labelFile) {
      setManualMessage('上传影像模式需先选择文件。'); return null;
    }
    if (manualSource === 'upload' && !imageBounds) {
      setManualMessage('请先设置影像覆盖范围。'); return null;
    }
    const updates = buildManualLabelUpdates(manualLabelFeatures);
    updates.forEach((item) => dispatch({ type: 'UPDATE_FEATURE', id: item.id, updates: item.updates }));
    const blob = manualSource === 'amap'
      ? await buildAmapDataset(manualLabelFeatures, bounds)
      : await exportManualYoloDatasetToBlob({
        layers: state.layers, features: state.features,
        boundsLayerId: labelLayerId, labelLayerId,
        imageBounds, sourceMode: manualSource, uploadFile: labelFile, tileSize: 640,
    });
    const name = "farmland_manual_yolo_" + new Date().toISOString().slice(0, 10) + ".zip";
    const file = new File([blob], name, { type: 'application/zip' });
    await persistDatasetFile(file);
    return file;
  }, [labelLayerId, manualLabelFeatures, bounds, imageBounds, manualSource, labelFile, dispatch, state.features, state.layers]);

  const handleExportYoloDataset = useCallback(async () => {
    setManualExporting(true);
    try {
      const file = await buildYoloDatasetFile(false);
      if (!file) return;
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setManualMessage("已导出 " + file.name + "。浏览器通常会保存到系统下载目录；直接训练不需要这个文件。");
    } catch (e: any) {
      setManualMessage(e.message || '导出失败');
    } finally {
      setManualExporting(false);
    }
  }, [buildYoloDatasetFile]);

  const handleBuildTrainingDataset = useCallback(async () => {
    setManualExporting(true);
    try {
      const file = await buildYoloDatasetFile(true);
      if (file) setManualMessage(`已转入训练中心：${file.name}`);
      return file;
    } catch (e: any) {
      setManualMessage(e.message || '生成训练数据失败');
      return null;
    } finally {
      setManualExporting(false);
    }
  }, [buildYoloDatasetFile]);

  return { handleBuildTrainingDataset, handleExportYoloDataset, manualExporting, manualMessage, setManualMessage };
}

export async function buildAmapDataset(features: GeoJSONFeature[], bounds: Bounds): Promise<Blob> {
  const fit = fitAmapStaticToWgsBounds(bounds);
  const [lng, lat] = fit.amapCenter;
  const response = await fetch(
    `${DEFAULT_BACKEND_URL}/amap-static?location=${lng.toFixed(6)},${lat.toFixed(6)}&zoom=${fit.zoom}&size=640*640&style=satellite`,
  );
  if (!response.ok) throw new Error('无法获取与历史标注匹配的卫星训练影像。');
  return buildYoloDatasetZipFromImage(await response.blob(), features, fit.bounds, `amap_labels_z${fit.zoom}`);
}

export async function persistDatasetFile(file: File): Promise<void> {
  const form = new FormData();
  form.append('dataset', file, file.name);
  const response = await fetch(`${DEFAULT_BACKEND_URL}/datasets`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '真实标注集保存失败。');
}
