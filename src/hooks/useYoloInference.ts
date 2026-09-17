import { useCallback, useRef, useState } from 'react';
import { useAppContext } from '../AppContext';
import { getDefaultFeatureStyle } from '../utils/featureStyle';
import { AMAP_STATIC_SIZE, fitAmapStaticToWgsBounds, normalizeAmapStaticZoom } from '../utils/amapStatic';
import { clipPolygonCoordinatesToBounds, polygonAreaSquareMeters } from '../utils/geoBounds';
import { dedupeOverlappingParcels, intersectBounds, planAmapTileGrid } from '../utils/tileBatch';
import type { TileGridPlan } from '../utils/tileBatch';
import { wgs2gcj } from '../utils/coord';
import { createUploadedImageBlob } from '../utils/yoloDataset';
import type { GeoJSONFeature } from '../types';
import type { Bounds, ManualDatasetSource } from '../utils/yoloDataset';
import type { MapViewSnapshot } from '../utils/mapAPI';
import { DEFAULT_BACKEND_URL } from '../backendUrl';

const RESULT_LAYER_NAME = '农田模型识别';
/** 瓦片批处理的张数上限；超过则规划阶段自动降低缩放。 */
const MAX_TILES = 256;
/** 瓦片规划的最低缩放：再低地块像素过小，宁可不识别。 */
const MIN_TILE_ZOOM = 12;
/** 低于该缩放的识别结果精度下降，完成消息中提示。 */
const LOW_RES_ZOOM = 14;
/** 瓦片间节流间隔（毫秒），避免连续请求压垮本地代理与高德瓦片服务。 */
const TILE_THROTTLE_MS = 150;

type RawYoloFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties?: Record<string, any>;
};

type SegmentedItem = {
  item: RawYoloFeature;
  areaSquareMeters: number;
};

/**
 * Fetch a static map image from the backend amap-static proxy and return it as a Blob.
 */
async function fetchAmapStaticBlob(
  backendUrl: string,
  amapCenter: [number, number],
  zoom: number,
): Promise<Blob> {
  const [lng, lat] = amapCenter;
  const staticZoom = normalizeAmapStaticZoom(zoom);
  const url = `${backendUrl}/amap-static?location=${lng.toFixed(6)},${lat.toFixed(6)}&zoom=${staticZoom}&size=${AMAP_STATIC_SIZE}*${AMAP_STATIC_SIZE}&style=satellite`;
  const response = await fetch(url);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try { const err = await response.json(); if (err.error) detail = err.error; } catch { /* ignore */ }
    throw new Error(`获取地图静态图失败：${detail}`);
  }
  return response.blob();
}

/**
 * Convert a Blob to a JPEG File with a given name.
 */
async function blobToJpegFile(blob: Blob, name = 'map_snapshot'): Promise<File> {
  if (blob.type === 'image/jpeg') {
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建画布。');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(new File([b], `${name}.jpg`, { type: 'image/jpeg' }));
      else reject(new Error('图片编码失败。'));
    }, 'image/jpeg', 0.92);
  });
}

export function useYoloInference(
  labelFile: File | null,
  bounds: Bounds | null,
  imageBounds: Bounds | null,
  manualSource: ManualDatasetSource,
  modelFile: File | null = null,
  trainedModelPath = '',
  yoloConfidence = 0.15,
  yoloIou = 0.45,
  minAreaM2 = 50,
  backendUrl: string = DEFAULT_BACKEND_URL,
) {
  const { state, dispatch } = useAppContext();
  const [inferring, setInferring] = useState(false);
  const [inferenceMessage, setInferenceMessage] = useState('');
  /** 用户请求停止：长批次在下一张瓦片前退出（已收集的结果仍会写入）。 */
  const cancelRef = useRef(false);

  const cancelInference = useCallback(() => {
    if (!cancelRef.current) {
      cancelRef.current = true;
      setInferenceMessage('正在停止识别...已完成的部分会保留。');
    }
  }, []);

  /** POST 单张影像到 /segment，返回校验过的原始面要素（不做裁剪与写图层）。 */
  const postSegmentImage = useCallback(async (
    imageBlob: Blob,
    segmentBounds: Bounds,
    imageFileName: string,
  ): Promise<RawYoloFeature[]> => {
    const formData = new FormData();
    formData.append('image', imageBlob, imageFileName);
    formData.append('west', String(segmentBounds.west));
    formData.append('south', String(segmentBounds.south));
    formData.append('east', String(segmentBounds.east));
    formData.append('north', String(segmentBounds.north));
    formData.append('max_size_px', '960');
    formData.append('yolo_conf', String(yoloConfidence));
    formData.append('yolo_iou', String(yoloIou));
    formData.append('min_area_m2', String(minAreaM2));
    formData.append('layer_name', RESULT_LAYER_NAME);
    if (modelFile) {
      formData.append('model', modelFile, modelFile.name || 'farmland_model.pt');
    } else if (trainedModelPath) {
      formData.append('model_path', trainedModelPath);
    }

    const response = await fetch(`${backendUrl}/segment`, {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return Array.isArray(payload.features)
      ? payload.features.filter((item: any) =>
        item?.type === 'Feature' &&
        item?.geometry?.type === 'Polygon' &&
        Array.isArray(item.geometry.coordinates),
      )
      : [];
  }, [backendUrl, minAreaM2, modelFile, trainedModelPath, yoloConfidence, yoloIou]);

  /** 把识别结果裁剪到约束范围（如框选/瓦片边界）。 */
  const clipFeatures = useCallback((rawFeatures: RawYoloFeature[], constraintBounds?: Bounds | null): RawYoloFeature[] => {
    if (!constraintBounds) return rawFeatures;
    return rawFeatures.flatMap((item) => {
      const coordinates = clipPolygonCoordinatesToBounds(item.geometry.coordinates, constraintBounds);
      return coordinates ? [{ ...item, geometry: { ...item.geometry, coordinates } }] : [];
    });
  }, []);

  /** 计算面积并按最小面积过滤。 */
  const rankItemsByArea = useCallback((features: RawYoloFeature[]): SegmentedItem[] => {
    return features
      .map((item) => ({
        item,
        areaSquareMeters: Number(polygonAreaSquareMeters(item.geometry.coordinates).toFixed(2)),
      }))
      .filter(({ areaSquareMeters }) => areaSquareMeters >= minAreaM2);
  }, [minAreaM2]);

  /** 把识别结果一次性写入结果图层（清空旧结果），并给出完成消息。 */
  const writeResultFeatures = useCallback((items: SegmentedItem[], suffix = '') => {
    const existingLayer = state.layers.find((layer) => layer.name === RESULT_LAYER_NAME);
    const layerId = existingLayer?.id || crypto.randomUUID();
    if (!existingLayer) {
      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: RESULT_LAYER_NAME, visible: true } });
    }

    const features: GeoJSONFeature[] = items.map(({ item, areaSquareMeters }, index: number) => {
      const confidence = Number(item.properties?.parcelConfidence || 0);
      const parcelCode = item.properties?.parcelCode || `YOLO-${String(index + 1).padStart(3, '0')}`;
      return {
        type: 'Feature',
        geometry: item.geometry,
        properties: {
          id: crypto.randomUUID(),
          name: `模型识别-${parcelCode}`,
          description: `YOLO 农田识别，置信度 ${(confidence * 100).toFixed(1)}%`,
          ...getDefaultFeatureStyle('Polygon', '#2f9e62'),
          shapeType: 'Polygon',
          layerId,
          parcelCode,
          parcelIndex: index + 1,
          parcelGroup: '模型识别',
          parcelAreaMu: Number((areaSquareMeters / 666.667).toFixed(2)),
          parcelAreaSquareMeters: areaSquareMeters,
          parcelConfidence: confidence,
          parcelRole: 'parcel',
          source: String(item.properties?.source || 'yolov11-seg'),
        },
      };
    });

    if (existingLayer) {
      dispatch({ type: 'CLEAR_LAYER_FEATURES', layerId });
    }
    dispatch({ type: 'BATCH_ADD_FEATURES', features });
    dispatch({ type: 'SET_CURRENT_LAYER', id: layerId });
    window.setTimeout(() => (window as any).__webgis?.flyToFeature?.(features[0]), 0);

    const totalAreaMu = features.reduce((sum, feature) => sum + (feature.properties.parcelAreaMu || 0), 0);
    setInferenceMessage(
      `识别完成：${features.length} 个地块${totalAreaMu > 0 ? `，约 ${totalAreaMu.toFixed(2)} 亩` : ''}，已写入"${RESULT_LAYER_NAME}"图层${suffix}。`,
    );
  }, [dispatch, state.layers]);

  /**
   * Core segment logic: image blob + bounds → POST /segment → dispatch results.
   */
  const runSegment = useCallback(async (
    imageBlob: Blob,
    segmentBounds: Bounds,
    imageFileName: string,
    constraintBounds?: Bounds | null,
  ) => {
    const rawFeatures = await postSegmentImage(imageBlob, segmentBounds, imageFileName);
    const boundedFeatures = clipFeatures(rawFeatures, constraintBounds);
    if (boundedFeatures.length === 0) {
      setInferenceMessage(
        constraintBounds
          ? `识别完成，但框选范围内没有发现地块。可尝试降低置信度到 ${(Math.max(0.05, yoloConfidence - 0.05)).toFixed(2)}，或调小最小面积。`
          : `识别完成，但没有发现地块。可尝试降低置信度到 ${(Math.max(0.05, yoloConfidence - 0.05)).toFixed(2)}，或调小最小面积。`,
      );
      return;
    }
    const boundedFeaturesWithArea = rankItemsByArea(boundedFeatures);
    if (boundedFeaturesWithArea.length === 0) {
      setInferenceMessage(
        constraintBounds
          ? '识别完成，但框选范围内没有满足最小面积的地块。可调小最小面积后重试。'
          : '识别完成，但没有满足最小面积的地块。可调小最小面积后重试。',
      );
      return;
    }
    writeResultFeatures(boundedFeaturesWithArea, constraintBounds ? '，已约束到框选范围' : '');
  }, [clipFeatures, postSegmentImage, rankItemsByArea, writeResultFeatures, yoloConfidence]);

  /**
   * 瓦片批处理：把大范围按网格逐张识别，合并结果并按重叠去重。
   * 单张瓦片失败不中断整体，全部失败才报错。
   * outerBounds 用于把每张瓦片结果再裁剪回整体范围（如行政区边界）。
   */
  const runTiledSegment = useCallback(async (plan: TileGridPlan, label: string, outerBounds?: Bounds | null) => {
    const total = plan.tiles.length;
    const collected: SegmentedItem[] = [];
    let failed = 0;
    let done = 0;
    let cancelled = false;

    for (let i = 0; i < total; i += 1) {
      if (cancelRef.current) { cancelled = true; break; }
      const tile = plan.tiles[i];
      setInferenceMessage(`正在识别 ${label}：第 ${i + 1}/${total} 张瓦片（z${plan.zoom}）...`);
      try {
        const [lng, lat] = tile.center;
        const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
        const imageBlob = await fetchAmapStaticBlob(backendUrl, [gcjLng, gcjLat], plan.zoom);
        const jpegFile = await blobToJpegFile(imageBlob, `tile_${i + 1}`);
        const resized = await createUploadedImageBlob(jpegFile, AMAP_STATIC_SIZE);
        if (!resized) throw new Error('瓦片影像预处理失败。');
        const rawFeatures = await postSegmentImage(resized, tile.bounds, `tile_${i + 1}.jpg`);
        const clipBounds = outerBounds ? (intersectBounds(tile.bounds, outerBounds) ?? tile.bounds) : tile.bounds;
        collected.push(...rankItemsByArea(clipFeatures(rawFeatures, clipBounds)));
      } catch {
        failed += 1;
      }
      done += 1;
      if (i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, TILE_THROTTLE_MS));
      }
    }

    const stopNote = cancelled ? `，已手动停止（完成 ${done}/${total} 张）` : '';

    if (collected.length === 0) {
      if (!cancelled && failed === total) {
        throw new Error(`全部 ${total} 张瓦片识别失败，请检查本地后端与网络后重试。`);
      }
      setInferenceMessage(
        `${label}：${done} 张瓦片中未发现地块${failed > 0 ? `（${failed} 张失败）` : ''}${stopNote}。可尝试降低置信度或调小最小面积。`,
      );
      return;
    }

    const deduped = dedupeOverlappingParcels(collected.map(({ item, areaSquareMeters }) => ({
      item,
      areaSquareMeters,
      coordinates: item.geometry.coordinates,
      confidence: Number(item.properties?.parcelConfidence || 0),
    })));
    const removed = collected.length - deduped.length;
    const lowResNote = plan.zoom < LOW_RES_ZOOM ? `；z${plan.zoom} 分辨率较低，建议改选更小范围` : '';
    writeResultFeatures(
      deduped.map(({ item, areaSquareMeters }) => ({ item, areaSquareMeters })),
      `，由 ${done} 张瓦片合并${removed > 0 ? `（去掉 ${removed} 个重复）` : ''}${failed > 0 ? `，${failed} 张失败` : ''}${stopNote}${lowResNote}`,
    );
  }, [backendUrl, clipFeatures, postSegmentImage, rankItemsByArea, writeResultFeatures]);

  const handleInference = useCallback(async () => {
    setInferenceMessage('');
    if (manualSource !== 'upload') {
      setInferenceMessage('模型识别需要上传一张 GeoTIFF、PNG 或 JPG 影像。');
      return;
    }
    if (!labelFile) {
      setInferenceMessage('请先选择要识别的影像。');
      return;
    }
    const segmentBounds = imageBounds || bounds;
    if (!segmentBounds) {
      setInferenceMessage('请先设置影像覆盖范围。');
      return;
    }

    cancelRef.current = false;
    setInferring(true);
    try {
      const imageBlob = await createUploadedImageBlob(labelFile, 640);
      if (!imageBlob) throw new Error('影像预处理失败。');
      await runSegment(imageBlob, segmentBounds, 'farmland_inference.jpg');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setInferenceMessage(
        message.includes('Failed to fetch')
          ? '识别失败：无法连接后端，请重新运行 start.bat。'
          : `识别失败：${message.split(/\r?\n/)[0]}`,
      );
    } finally {
      setInferring(false);
    }
  }, [bounds, imageBounds, labelFile, manualSource, runSegment]);

  /** Capture current map view → fetch /amap-static → POST /segment. */
  const handleCaptureAndInfer = useCallback(async () => {
    setInferenceMessage('');
    const gis = (window as any).__webgis;
    if (!gis?.getMapSnapshot) {
      setInferenceMessage('地图尚未就绪，请稍后再试。');
      return;
    }
    const snapshot: MapViewSnapshot | null = gis.getMapSnapshot();
    if (!snapshot) {
      setInferenceMessage('无法获取当前地图视图。');
      return;
    }

    cancelRef.current = false;
    setInferring(true);
    try {
      const imageBlob = await fetchAmapStaticBlob(backendUrl, snapshot.amapCenter, snapshot.zoom);
      const jpegFile = await blobToJpegFile(imageBlob);
      const resized = await createUploadedImageBlob(jpegFile, 640);
      if (!resized) throw new Error('截图预处理失败。');
      await runSegment(resized, snapshot.bounds, 'map_snapshot.jpg');
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setInferenceMessage(
        message.includes('Failed to fetch')
          ? '识别失败：无法连接后端，请重新运行 start.bat。'
          : `识别失败：${message.split(/\r?\n/)[0]}`,
      );
    } finally {
      setInferring(false);
    }
  }, [backendUrl, runSegment]);

  const handleSelectAndInfer = useCallback(async () => {
    setInferenceMessage('请在地图上拖拽框选要识别的区域。');
    const gis = (window as any).__webgis;
    if (!gis?.selectMapSnapshot) {
      setInferenceMessage('地图尚未提供框选能力，请刷新后再试。');
      return;
    }
    const snapshot: MapViewSnapshot | null = await gis.selectMapSnapshot();
    if (!snapshot) {
      setInferenceMessage('未选择识别区域。');
      return;
    }

    cancelRef.current = false;
    setInferring(true);
    try {
      // 大框选同样走瓦片批处理（单瓦片保持原单图路径）
      const selection = snapshot.selectionBounds ?? snapshot.bounds;
      const plan = snapshot.selectionBounds
        ? planAmapTileGrid(selection, { maxTiles: MAX_TILES, minZoom: MIN_TILE_ZOOM })
        : null;
      if (plan && plan.tiles.length > 1) {
        await runTiledSegment(plan, '框选区域', selection);
        return;
      }
      const imageBlob = await fetchAmapStaticBlob(backendUrl, snapshot.amapCenter, snapshot.zoom);
      const jpegFile = await blobToJpegFile(imageBlob, 'map_selection');
      const resized = await createUploadedImageBlob(jpegFile, 640);
      if (!resized) throw new Error('截图预处理失败。');
      await runSegment(resized, snapshot.bounds, 'map_selection.jpg', snapshot.selectionBounds);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setInferenceMessage(
        message.includes('Failed to fetch')
          ? '识别失败：无法连接后端，请重新运行 start.bat。'
          : `识别失败：${message.split(/\r?\n/)[0]}`,
      );
    } finally {
      setInferring(false);
    }
  }, [backendUrl, runSegment, runTiledSegment]);

  const handleBoundsAndInfer = useCallback(async (targetBounds: Bounds, label: string) => {
    setInferenceMessage(`正在获取 ${label} 的卫星影像...`);
    cancelRef.current = false;
    setInferring(true);
    try {
      const plan = planAmapTileGrid(targetBounds, { maxTiles: MAX_TILES, minZoom: MIN_TILE_ZOOM });
      if (plan && plan.tiles.length > 1) {
        // 大范围：分瓦片逐张识别，合并去重（结果仍裁剪回行政区范围）
        await runTiledSegment(plan, label, targetBounds);
        return;
      }
      // 小范围（或区域过大无法规划）：整幅单图识别
      const fitted = fitAmapStaticToWgsBounds(targetBounds);
      const imageBlob = await fetchAmapStaticBlob(backendUrl, fitted.amapCenter, fitted.zoom);
      const jpegFile = await blobToJpegFile(imageBlob, 'admin_region');
      const resized = await createUploadedImageBlob(jpegFile, 640);
      if (!resized) throw new Error('行政区影像预处理失败。');
      await runSegment(
        resized,
        fitted.bounds,
        'admin_region.jpg',
        targetBounds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setInferenceMessage(
        message.includes('Failed to fetch')
          ? '识别失败：无法连接本地后端，请重新运行 start.bat。'
          : `识别失败：${message.split(/\r?\n/)[0]}`,
      );
    } finally {
      setInferring(false);
    }
  }, [backendUrl, runSegment, runTiledSegment]);

  return {
    handleInference,
    handleCaptureAndInfer,
    handleSelectAndInfer,
    handleBoundsAndInfer,
    cancelInference,
    inferring,
    inferenceMessage,
  };
}
