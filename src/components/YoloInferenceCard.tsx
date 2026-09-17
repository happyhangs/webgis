import { useEffect, useMemo, useState } from 'react';
import { Camera, Crosshair, FileImage, FileUp, Loader2, MapPinned, PenLine, ScanSearch, Square } from 'lucide-react';
import { adminCityNames, loadAdminIndex, loadAdminRegions } from '../utils/adminRegions';
import type { AdminIndex, AdminRegion } from '../utils/adminRegions';
import type { Bounds } from '../utils/yoloDataset';

interface YoloInferenceCardProps {
  captureDisabled: boolean;
  inferring: boolean;
  message: string;
  onCancelInference: () => void;
  modelFile: File | null;
  trainedModelPath: string;
  trainedModelName: string;
  yoloConfidence: number;
  setYoloConfidence: (value: number) => void;
  yoloIou: number;
  setYoloIou: (value: number) => void;
  minAreaM2: number;
  setMinAreaM2: (value: number) => void;
  localImageFile: File | null;
  localImageBounds: Bounds | null;
  localImageStatus: string;
  selectingLocalBounds: boolean;
  onLocalImageFileChange: (file: File | null) => void;
  onSelectLocalBounds: () => void;
  onRunLocalImage: () => void;
  onOpenLocalTraining: () => void;
  onModelFileChange: (file: File | null) => void;
  onCaptureAndRun: () => void;
  onSelectAndRun: () => void;
  onAdminRegionSelected: (region: AdminRegion) => void;
  onRunAdminRegion: (region: AdminRegion) => void;
}

type RecognitionSource = 'local' | 'map' | 'admin';

export function YoloInferenceCard({
  captureDisabled,
  inferring,
  message,
  onCancelInference,
  modelFile,
  trainedModelPath,
  trainedModelName,
  yoloConfidence,
  setYoloConfidence,
  yoloIou,
  setYoloIou,
  minAreaM2,
  setMinAreaM2,
  localImageFile,
  localImageBounds,
  localImageStatus,
  selectingLocalBounds,
  onLocalImageFileChange,
  onSelectLocalBounds,
  onRunLocalImage,
  onOpenLocalTraining,
  onModelFileChange,
  onCaptureAndRun,
  onSelectAndRun,
  onAdminRegionSelected,
  onRunAdminRegion,
}: YoloInferenceCardProps) {
  const [source, setSource] = useState<RecognitionSource>('local');
  return (
    <div className="farm-step-card">
      <div className="farm-step-header">
        <span className="farm-step-num active"><ScanSearch size={14} /></span>
        <span className="farm-step-title">选择识别范围</span>
      </div>

      <div className="farm-source-toggle farm-recognition-sources" role="group" aria-label="识别范围来源">
        <button type="button" className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')}>
          <FileImage size={13} />本地影像
        </button>
        <button type="button" className={source === 'map' ? 'active' : ''} onClick={() => setSource('map')}>
          <Crosshair size={13} />地图框选
        </button>
        <button type="button" className={source === 'admin' ? 'active' : ''} onClick={() => setSource('admin')}>
          <MapPinned size={13} />行政区域
        </button>
      </div>

      {source === 'local' && (
        <>
          <label className="farm-file-picker">
            <FileImage size={14} className="farm-file-picker-icon" />
            <span className="farm-file-picker-label">
              {localImageFile ? localImageFile.name : '选择本地影像（GeoTIFF / PNG / JPG）'}
            </span>
            <input className="farm-file-picker-input" type="file" accept=".tif,.tiff,.png,.jpg,.jpeg"
              disabled={inferring}
              onChange={(event) => onLocalImageFileChange(event.target.files?.[0] ?? null)} />
          </label>
          {localImageFile && (
            <>
              <button className="farm-secondary-btn" type="button" onClick={onSelectLocalBounds}
                disabled={selectingLocalBounds || inferring} style={{ width: '100%' }}>
                {selectingLocalBounds ? <Loader2 size={14} className="farm-spin" /> : <Crosshair size={14} />}
                {selectingLocalBounds ? '请在地图上拖框...' : localImageBounds ? '重新框选影像位置' : '在地图上框选影像位置'}
              </button>
              <div className="farm-label-hint">
                {localImageStatus || (localImageBounds ? '影像位置已就绪。' : 'GeoTIFF 可自动定位；普通图片需要框选位置。')}
              </div>
              <div className="farm-inline-actions">
                <button className="farm-primary-btn" type="button" onClick={onRunLocalImage}
                  disabled={!localImageBounds || inferring}>
                  {inferring ? <Loader2 size={14} className="farm-spin" /> : <ScanSearch size={14} />}
                  识别本地影像
                </button>
                <button className="farm-secondary-btn" type="button" onClick={onOpenLocalTraining}
                  disabled={!localImageBounds || inferring}>
                  <PenLine size={14} />去标注训练
                </button>
              </div>
            </>
          )}
          <div className="farm-label-hint">影像和坐标只在浏览器与 127.0.0.1 本地后端之间处理。</div>
        </>
      )}
      {source === 'map' && (
        <>
          <div className="farm-label-hint">地图显示和识别会访问在线地图及高德卫星服务。</div>
          <button className="farm-primary-btn" type="button" onClick={onSelectAndRun}
            disabled={captureDisabled || inferring} style={{ width: '100%' }}>
            {inferring ? <Loader2 size={14} className="farm-spin" /> : <Crosshair size={14} />}
            {inferring ? '识别中...' : '框选地图区域并识别'}
          </button>
          <button className="farm-secondary-btn" type="button" onClick={onCaptureAndRun}
            disabled={captureDisabled || inferring} style={{ width: '100%' }}>
            {inferring ? <Loader2 size={14} className="farm-spin" /> : <Camera size={14} />}
            识别当前视图
          </button>
        </>
      )}
      {source === 'admin' && (
        <AdminRegionPicker
          disabled={captureDisabled || inferring}
          onSelected={onAdminRegionSelected}
          onRun={onRunAdminRegion}
        />
      )}
      <label className="farm-file-picker">
        <FileUp size={14} className="farm-file-picker-icon" />
        <span className="farm-file-picker-label">
          {modelFile ? modelFile.name : '导入训练模型（.pt，可选）'}
        </span>
        <input className="farm-file-picker-input" type="file" accept=".pt"
          disabled={inferring}
          onChange={(e) => onModelFileChange(e.target.files?.[0] ?? null)} />
      </label>
      {trainedModelPath && !modelFile && (
        <div className="farm-step-meta" style={{ marginTop: 4 }}>
          <span>当前模型 <strong>{trainedModelName || trainedModelPath.split(/[\\/]/).pop()}</strong></span>
        </div>
      )}
      <label className="farm-input-row" style={{ marginTop: 6 }}>
        <span>置信度</span>
        <input type="number" min={0.01} max={0.9} step={0.01} value={yoloConfidence}
          onChange={(e) => setYoloConfidence(Number(e.currentTarget.value))} />
      </label>
      <label className="farm-input-row">
        <span>IoU</span>
        <input type="number" min={0.1} max={0.9} step={0.05} value={yoloIou}
          onChange={(e) => setYoloIou(Number(e.currentTarget.value))} />
      </label>
      <label className="farm-input-row">
        <span>最小面积m2</span>
        <input type="number" min={1} max={10000} step={10} value={minAreaM2}
          onChange={(e) => setMinAreaM2(Number(e.currentTarget.value))} />
      </label>
      {message && (
        <div className={"farm-yolo-message" + (message.includes('失败') ? ' error' : ' success')} style={{ marginTop: 6 }}>
          <span>{message}</span>
          {inferring && (
            <button className="farm-stop-btn" type="button" onClick={onCancelInference}
              title="停止识别，已完成的部分会保留" aria-label="停止识别">
              <Square size={11} />停止
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AdminRegionPicker({
  disabled,
  onSelected,
  onRun,
}: {
  disabled: boolean;
  onSelected: (region: AdminRegion) => void;
  onRun: (region: AdminRegion) => void;
}) {
  const [index, setIndex] = useState<AdminIndex | null>(null);
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [regions, setRegions] = useState<AdminRegion[]>([]);
  const [regionId, setRegionId] = useState('');
  const [status, setStatus] = useState('正在加载本地行政区数据...');

  useEffect(() => {
    let cancelled = false;
    loadAdminIndex()
      .then((value) => {
        if (cancelled) return;
        setIndex(value);
        setProvince(value['新疆维吾尔自治区'] ? '新疆维吾尔自治区' : Object.keys(value)[0] || '');
        setStatus('请依次选择省、市和县。');
      })
      .catch((error) => !cancelled && setStatus(error instanceof Error ? error.message : '行政区索引加载失败'));
    return () => { cancelled = true; };
  }, []);

  const provinces = useMemo(() => Object.keys(index || {}), [index]);
  const cities = useMemo(() => adminCityNames(index?.[province]), [index, province]);

  useEffect(() => {
    if (!index || !province || !city) return;
    let cancelled = false;
    setRegions([]);
    setRegionId('');
    setStatus('正在加载县级行政区...');
    loadAdminRegions(index, province, city)
      .then((value) => {
        if (cancelled) return;
        setRegions(value);
        setStatus(value.length ? '选择一个行政区后可定位或识别。' : '该市没有可用的县级行政区。');
      })
      .catch((error) => !cancelled && setStatus(error instanceof Error ? error.message : '行政区加载失败'));
    return () => { cancelled = true; };
  }, [city, index, province]);

  const selected = regions.find((region) => region.id === regionId) || null;

  return (
    <>
      <div className="farm-admin-selects">
        <select aria-label="选择省级行政区" value={province} disabled={!index || disabled}
          onChange={(event) => { setProvince(event.target.value); setCity(''); setRegions([]); setRegionId(''); }}>
          <option value="">选择省</option>
          {provinces.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="选择市级行政区" value={city} disabled={!province || disabled}
          onChange={(event) => setCity(event.target.value)}>
          <option value="">选择市</option>
          {cities.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="选择县级行政区" value={regionId} disabled={regions.length === 0 || disabled}
          onChange={(event) => {
            setRegionId(event.target.value);
            const region = regions.find((item) => item.id === event.target.value);
            if (region) onSelected(region);
          }}>
          <option value="">选择县 / 区</option>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select>
      </div>
      <div className="farm-label-hint">
        {selected ? `已选择 ${selected.name}；大范围会自动分瓦片批量识别（最多约 256 张，耗时较长）。` : status}
      </div>
      <div className="farm-inline-actions">
        <button className="farm-secondary-btn" type="button" disabled={!selected || disabled}
          onClick={() => selected && onSelected(selected)}>
          <MapPinned size={14} />定位行政区
        </button>
        <button className="farm-primary-btn" type="button" disabled={!selected || disabled}
          onClick={() => selected && onRun(selected)}>
          {disabled ? <Loader2 size={14} className="farm-spin" /> : <ScanSearch size={14} />}
          识别所选行政区
        </button>
      </div>
      <div className="farm-label-hint">行政区显示和识别会访问在线地图及高德卫星服务。</div>
    </>
  );
}
