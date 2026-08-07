import { memo } from 'react';
import {
  ExternalLink,
  FileArchive,
  ImageUp,
  Loader2,
  Map as MapIcon,
  PenLine,
  PenOff,
  Play,
  Trash2,
  UploadCloud,
  Crosshair,
} from 'lucide-react';
import type { GeoJSONFeature } from '../types';
import type { Bounds, ManualDatasetSource } from '../utils/yoloDataset';

function formatBounds(b: Bounds): string {
  return b.west.toFixed(4) + ", " + b.south.toFixed(4) + " ~ " + b.east.toFixed(4) + ", " + b.north.toFixed(4);
}

function formatArea(m2: number): string {
  if (m2 >= 666.667) return (m2 / 666.667).toFixed(1) + ' 亩';
  return m2.toFixed(0) + ' m²';
}

interface ManualLabelCardProps {
  manualSource: ManualDatasetSource;
  setManualSource: (v: ManualDatasetSource) => void;
  labelFile: File | null;
  setLabelFile: (f: File | null) => void;
  labelFileRef: React.RefObject<HTMLInputElement>;
  imageBounds: Bounds | null;
  onSelectImageBounds: () => void;
  selectingImageBounds: boolean;
  manualLabelFeatures: GeoJSONFeature[];
  bounds: Bounds | null;
  labelMode: boolean;
  onActivateLabel: () => void;
  onDeactivateLabel: () => void;
  onDeleteFeature: (id: string) => void;
  handleExportYoloDataset: () => void;
  manualExporting: boolean;
  manualMessage: string;
  modelOutputName: string;
  setModelOutputName: (v: string) => void;
  trainTotalEpochs: number;
  setTrainTotalEpochs: (v: number) => void;
  training: boolean;
  trainEpoch: number;
  trainMetrics: Record<string, number>;
  trainMessage: string;
  handleTrainInBrowser: () => void;
  onOpenTraining?: () => void;
  onOpenTrainingWithDataset?: () => void;
  onOpenMapDraftTraining?: () => void;
  selectingMapDraft?: boolean;
}

export const ManualLabelCard = memo(function ManualLabelCard(props: ManualLabelCardProps) {
  const {
    manualSource, setManualSource, labelFile, setLabelFile, labelFileRef,
    imageBounds, onSelectImageBounds, selectingImageBounds,
    manualLabelFeatures, bounds, labelMode,
    onActivateLabel, onDeactivateLabel, onDeleteFeature,
    handleExportYoloDataset, manualExporting, manualMessage,
    modelOutputName, setModelOutputName,
    trainTotalEpochs, setTrainTotalEpochs,
    training, trainEpoch, trainMetrics, trainMessage, handleTrainInBrowser,
    onOpenTraining, onOpenTrainingWithDataset, onOpenMapDraftTraining, selectingMapDraft,
  } = props;

  const hasLabels = manualLabelFeatures.length > 0;

  const handleLocateFeature = (feature: GeoJSONFeature) => {
    const api = (window as any).__webgis;
    if (!api?.flyToFeature) return;
    api.flyToFeature(feature);
  };

  return (
    <div className="farm-step-card">
      <div className="farm-step-header">
        <span className={"farm-step-num " + (hasLabels ? "done" : "active")}>{hasLabels ? "✓" : "1"}</span>
        <span className="farm-step-title">绘制标注</span>
      </div>

      <div className="farm-source-toggle" role="group" aria-label="数据来源">
        <button type="button" className={manualSource === 'upload' ? 'active' : ''} onClick={() => setManualSource('upload')}>
          <UploadCloud size={13} />上传影像
        </button>
        <button type="button" className={manualSource === 'amap' ? 'active' : ''} onClick={() => setManualSource('amap')}>
          <MapIcon size={13} />高德底图
        </button>
      </div>

      {manualSource === 'upload' && (
        <>
          <label className="farm-file-picker" style={{ marginTop: 6 }}>
            <ImageUp size={14} className="farm-file-picker-icon" />
            <span className="farm-file-picker-label">
              {labelFile ? labelFile.name : '选择影像文件（GeoTIFF / PNG / JPG）'}
            </span>
            <input ref={labelFileRef} className="farm-file-picker-input" type="file" accept=".tif,.tiff,.png,.jpg,.jpeg"
              onChange={(e) => setLabelFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="farm-secondary-btn" type="button" onClick={onSelectImageBounds}
            disabled={!labelFile || selectingImageBounds} style={{ width: '100%', marginTop: 6 }}>
            {selectingImageBounds ? <Loader2 size={14} className="farm-spin" /> : <Crosshair size={14} />}
            {selectingImageBounds ? '框选影像范围...' : imageBounds ? '重新框选影像范围' : '框选影像真实范围'}
          </button>
          {imageBounds && <div className="farm-label-hint">影像范围：{formatBounds(imageBounds)}</div>}
        </>
      )}

      {!labelMode ? (
        <>
          <button className="farm-primary-btn" type="button"
            onClick={onActivateLabel}
            disabled={manualSource === 'upload' && (!labelFile || !imageBounds)}
            style={{ width: '100%' }}>
            <PenLine size={14} />开始标注
          </button>
          {manualSource === 'upload' && (!labelFile || !imageBounds) && (
            <div className="farm-label-hint" style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
              请先选择影像并框选其真实覆盖范围，再对照叠加影像标注
            </div>
          )}
        </>
      ) : (
        <button className="farm-danger-btn" type="button" onClick={onDeactivateLabel} style={{ width: '100%' }}>
          <PenOff size={14} />结束标注
        </button>
      )}

      <div className="farm-step-meta" style={{ marginTop: 4 }}>
        <span>已标注 <strong>{manualLabelFeatures.length}</strong> 个地块</span>
        {bounds && <span>范围 {formatBounds(bounds)}</span>}
      </div>

      {labelMode && (
        <div className="farm-label-hint" style={{
          marginTop: 4, fontSize: 11, color: 'var(--accent)', lineHeight: 1.5,
        }}>
          在地图上连续点击左键绘制多边形，右键或双击完成绘制。按 Esc 也可结束标注。
        </div>
      )}

      {hasLabels && (
        <div className="farm-label-list" style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
          {manualLabelFeatures.map((f, i) => (
            <div key={f.properties.id} className="farm-label-item" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '3px 6px', fontSize: 11, borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
            }}>
              <span onClick={() => handleLocateFeature(f)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Crosshair size={10} style={{ opacity: 0.5 }} />
                <span style={{ fontWeight: 600 }}>{f.properties.parcelCode || '地' + (i + 1)}</span>
                <span style={{ opacity: 0.6 }}>{formatArea(f.properties.parcelAreaSquareMeters || 0)}</span>
              </span>
              <button
                type="button"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--danger)' }}
                onClick={(e) => { e.stopPropagation(); onDeleteFeature(f.properties.id); }}
                title="删除此标注"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="farm-detect-note">
        高德底图模式会按标注范围保存对应卫星影像；上传模式必须先框选真实覆盖范围并确认叠加对齐。
      </div>

      <label className="farm-input-row" style={{ marginTop: 6 }}>
        <span>模型名</span>
        <input
          type="text"
          value={modelOutputName}
          onChange={(e) => setModelOutputName(e.currentTarget.value)}
          placeholder="farmland_seg"
        />
      </label>

      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <button className="farm-secondary-btn" type="button" onClick={handleExportYoloDataset}
          disabled={manualExporting || training} style={{ flex: 1 }}>
          {manualExporting ? <Loader2 size={14} className="farm-spin" /> : <FileArchive size={14} />}
          {manualExporting ? '导出中...' : '备份 ZIP'}
        </button>
        <button className="farm-primary-btn" type="button" onClick={handleTrainInBrowser}
          disabled={training || manualExporting || manualLabelFeatures.length === 0}
          style={{ flex: 1 }}>
          {training ? <Loader2 size={14} className="farm-spin" /> : <Play size={14} />}
          {training ? '训练中...' : '提交标注并训练'}
        </button>
      </div>

      <button className="farm-secondary-btn" type="button"
        onClick={() => (onOpenTrainingWithDataset || onOpenTraining)?.()}
        disabled={training || manualExporting || manualLabelFeatures.length === 0}
        style={{ width: '100%' }}>
        <ExternalLink size={14} />转入训练中心
        {training && <span className="farm-training-dot" />}
      </button>

      <button className="farm-secondary-btn" type="button"
        onClick={onOpenMapDraftTraining}
        disabled={training || manualExporting || selectingMapDraft}
        style={{ width: '100%', marginTop: 6 }}>
        {selectingMapDraft ? <Loader2 size={14} className="farm-spin" /> : <MapIcon size={14} />}
        {selectingMapDraft ? '框选地图区域...' : '框选地图去标注'}
      </button>

      <label className="farm-input-row" style={{ marginTop: 4 }}>
        <span>训练轮数</span>
        <input type="number" min={10} max={500} step={10} value={trainTotalEpochs}
          onChange={(e) => setTrainTotalEpochs(Number(e.currentTarget.value))} />
      </label>

      {training && (
        <div className="farm-training-progress">
          <div className="farm-progress-bar">
            <div className="farm-progress-fill" style={{
              width: (trainTotalEpochs > 0 ? (trainEpoch / trainTotalEpochs * 100) : 0) + "%",
            }} />
          </div>
          <span className="farm-progress-label">Epoch {trainEpoch}/{trainTotalEpochs}</span>
          {Object.keys(trainMetrics).length > 0 && (
            <div className="farm-progress-metrics">
              {Object.entries(trainMetrics).map(([k, v]) => (
                <span key={k}>{k}: {typeof v === 'number' ? v.toFixed(4) : v}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {manualMessage && (
        <div className={"farm-yolo-message" + (manualMessage.includes('失败') ? ' error' : '')} style={{ marginTop: 6 }}>
          {manualMessage}
        </div>
      )}

      {!training && trainMessage && (
        <div className={"farm-yolo-message" + (trainMessage.includes('失败') ? ' error' : ' success')} style={{ marginTop: 6 }}>
          {trainMessage}
        </div>
      )}
    </div>
  );
});
