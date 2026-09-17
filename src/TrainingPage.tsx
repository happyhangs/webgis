import { DEFAULT_BACKEND_URL } from './backendUrl';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  FileArchive,
  FolderCheck,
  LineChart,
  Loader2,
  Map as MapIcon,
  MapPin,
  Minus,
  Play,
  Radio,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useAppContext } from './AppContext';
import { useFloatingPanels } from './FloatingPanelContext';
import type { GeoJSONFeature, TrainingMapDraft } from './types';
import { getDefaultFeatureStyle } from './utils/featureStyle';
import { readableTrainError } from './utils/trainError';
import { buildYoloDatasetZipFromImage } from './utils/yoloDataset';
import { AMAP_STATIC_SIZE } from './utils/amapStatic';
import JSZip from 'jszip';

interface TrainStatus {
  status: string;
  epoch: number;
  totalEpochs: number;
  metrics: Record<string, number>;
  history: MetricHistoryPoint[];
  error?: string | null;
  modelPath?: string | null;
  modelName?: string | null;
  outputName?: string | null;
  datasetId?: string | null;
  datasetPath?: string | null;
  running?: boolean;
}

interface MetricHistoryPoint {
  epoch: number;
  metrics: Record<string, number>;
}

interface DatasetPreview {
  url: string;
  name: string;
  polygons: string[];
}

interface TimelineStep {
  id: string;
  title: string;
  detail: string;
  state: 'waiting' | 'active' | 'done' | 'error';
}

interface LogItem {
  id: string;
  time: string;
  tone: 'info' | 'success' | 'error';
  text: string;
}

type DraftShapeType = 'point' | 'line' | 'polygon';
type DraftTool = DraftShapeType | 'delete';
type DraftDock = 'left' | 'right' | 'top';

interface DraftShape {
  id: string;
  type: DraftShapeType;
  points: DraftPoint[];
}

interface DraftPoint {
  x: number;
  y: number;
}

interface DraftTile {
  id: string;
  url: string;
  style: CSSProperties;
}

interface DraftView {
  zoom: number;
  x: number;
  y: number;
}

const MANUAL_LABEL_LAYER_NAME = '农田人工标定';
const DEFAULT_DRAFT_COLOR = '#2f8f5b';
const DEFAULT_DRAFT_SIZE = 520;
const TILE_SIZE = 256;
const DRAFT_MIN_ZOOM = 1;
const DRAFT_MAX_ZOOM = 6;
const DEFAULT_DRAFT_VIEW: DraftView = { zoom: 1, x: 0.5, y: 0.5 };
const POLYGON_CLOSE_DISTANCE = 0.025;
const DRAFT_DOCK_LABELS: Record<DraftDock, string> = {
  left: '左侧',
  right: '右侧',
  top: '上方',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function createDraftId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function svgPointList(points: DraftPoint[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
}

function isNearDraftPoint(a: DraftPoint, b: DraftPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= POLYGON_CLOSE_DISTANCE;
}

function clampDraftView(view: DraftView): DraftView {
  const zoom = Math.max(DRAFT_MIN_ZOOM, Math.min(DRAFT_MAX_ZOOM, view.zoom));
  const half = 0.5 / zoom;
  return {
    zoom,
    x: Math.max(half, Math.min(1 - half, view.x)),
    y: Math.max(half, Math.min(1 - half, view.y)),
  };
}

function formatDraftBounds(bounds: TrainingMapDraft['bounds']): string {
  return `${bounds.west.toFixed(5)}, ${bounds.south.toFixed(5)} ~ ${bounds.east.toFixed(5)}, ${bounds.north.toFixed(5)}`;
}

function estimateAreaSquareMeters(west: number, south: number, east: number, north: number): number {
  const midLat = ((south + north) / 2) * Math.PI / 180;
  const width = Math.abs(east - west) * 111320 * Math.max(0.1, Math.cos(midLat));
  const height = Math.abs(north - south) * 110540;
  return Math.round(width * height);
}

function draftPointToLngLat(point: DraftPoint, bounds: TrainingMapDraft['bounds']): [number, number] {
  return [
    bounds.west + point.x * (bounds.east - bounds.west),
    bounds.north - point.y * (bounds.north - bounds.south),
  ];
}

function draftShapeToFeature(
  shape: DraftShape,
  bounds: TrainingMapDraft['bounds'],
  layerId: string,
  index: number,
  color: string,
): GeoJSONFeature {
  const coords = shape.points.map((point) => draftPointToLngLat(point, bounds));
  const shapeType = shape.type === 'point' ? 'Marker' : shape.type === 'line' ? 'Line' : 'Polygon';
  const style = getDefaultFeatureStyle(shapeType, color);
  const geometry = shape.type === 'point'
    ? { type: 'Point', coordinates: coords[0] }
    : shape.type === 'line'
      ? { type: 'LineString', coordinates: coords }
      : { type: 'Polygon', coordinates: [[...coords, coords[0]]] };
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);
  const area = shape.type === 'polygon'
    ? estimateAreaSquareMeters(Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats))
    : undefined;

  return {
    type: 'Feature',
    geometry,
    properties: {
      id: createDraftId('map-draft-feature'),
      name: `训练中心标注 ${index + 1}`,
      description: '从训练中心地图草稿写回的可编辑区域',
      ...style,
      shapeType,
      layerId,
      parcelCode: `训练标注-${index + 1}`,
      parcelIndex: index + 1,
      parcelGroup: '训练中心',
      parcelAreaSquareMeters: area,
      parcelAreaMu: area ? area / 666.667 : undefined,
      areaApproximate: shape.type === 'polygon',
      parcelRole: 'parcel',
      source: 'training-map-draft',
    },
  };
}

function buildAmapSatelliteTiles(center: [number, number], zoom: number): DraftTile[] {
  const [lng, lat] = center;
  const n = 2 ** zoom;
  const latRad = lat * Math.PI / 180;
  const globalX = ((lng + 180) / 360) * n * TILE_SIZE;
  const globalY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE;
  const centerTileX = Math.floor(globalX / TILE_SIZE);
  const centerTileY = Math.floor(globalY / TILE_SIZE);
  const tiles: DraftTile[] = [];

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const rawX = centerTileX + dx;
      const rawY = centerTileY + dy;
      if (rawY < 0 || rawY >= n) continue;
      const x = ((rawX % n) + n) % n;
      const y = rawY;
      const sub = ((Math.abs(rawX + rawY) % 4) + 1).toString();
      tiles.push({
        id: `${zoom}-${x}-${y}`,
        url: `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${zoom}`,
        style: {
          left: `${((AMAP_STATIC_SIZE / 2 + rawX * TILE_SIZE - globalX) / AMAP_STATIC_SIZE) * 100}%`,
          top: `${((AMAP_STATIC_SIZE / 2 + rawY * TILE_SIZE - globalY) / AMAP_STATIC_SIZE) * 100}%`,
          width: `${(TILE_SIZE / AMAP_STATIC_SIZE) * 100}%`,
          height: `${(TILE_SIZE / AMAP_STATIC_SIZE) * 100}%`,
        },
      });
    }
  }

  return tiles;
}

function flyToFeatureAfterReturn(feature: GeoJSONFeature): void {
  window.setTimeout(() => {
    const api = (window as Window & { __webgis?: { flyToFeature?: (f: GeoJSONFeature) => void } }).__webgis;
    api?.flyToFeature?.(feature);
  }, 180);
}

function readableStatusLabel(status: string): string {
  switch (status) {
    case 'idle': return '等待任务';
    case 'starting': return '准备数据';
    case 'training': return '训练中';
    case 'done': return '已完成';
    case 'failed': return '失败';
    default: return status || '未知';
  }
}

function statusTone(status: string): 'idle' | 'running' | 'success' | 'error' {
  if (status === 'failed') return 'error';
  if (status === 'done') return 'success';
  if (status === 'starting' || status === 'training') return 'running';
  return 'idle';
}

function metricValue(metrics: Record<string, number>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatMetric(value: number | null, digits = 4): string {
  return value === null ? '-' : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function normalizeMetricHistory(value: unknown, totalEpochs = 0): MetricHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  const points = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const point = item as Partial<MetricHistoryPoint>;
    const epoch = Number(point.epoch);
    if (!Number.isFinite(epoch) || !point.metrics || typeof point.metrics !== 'object') return [];
    return [{ epoch, metrics: point.metrics }];
  });
  const lastEpoch = points[points.length - 1]?.epoch || 0;
  const legacyOffset = totalEpochs > 0 && lastEpoch === totalEpochs + 1 ? 1 : 0;
  return points.map((point) => ({ ...point, epoch: Math.max(0, point.epoch - legacyOffset) }));
}

function MetricHistoryChart({
  title,
  history,
  keys,
  color,
  percent = false,
}: {
  title: string;
  history: MetricHistoryPoint[];
  keys: string[];
  color: string;
  percent?: boolean;
}) {
  const values = history.flatMap((point) => {
    const value = metricValue(point.metrics, keys);
    return value === null ? [] : [{ epoch: point.epoch, value }];
  });
  if (values.length < 2) return null;
  const width = 260;
  const height = 86;
  const padding = 8;
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const span = max - min || 1;
  const points = values.map((point, index) => {
    const x = padding + index / (values.length - 1) * (width - padding * 2);
    const y = height - padding - (point.value - min) / span * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const latest = values[values.length - 1];
  return (
    <div className="training-history-chart">
      <div><strong>{title}</strong><span>Epoch {latest.epoch} · {percent ? formatPercent(latest.value) : formatMetric(latest.value, 4)}</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 随 Epoch 变化曲线`}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <polyline points={points} style={{ stroke: color }} />
      </svg>
    </div>
  );
}

function nowLabel(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function buildTimeline(status: TrainStatus, hasZip: boolean): TimelineStep[] {
  const current = status.status || 'idle';
  const hasProgress = status.epoch > 0;
  const done = current === 'done';
  const failed = current === 'failed';
  return [
    {
      id: 'dataset',
      title: '训练数据',
      detail: hasZip ? '已选择 YOLO ZIP' : '等待选择数据集',
      state: hasZip || current !== 'idle' ? 'done' : 'waiting',
    },
    {
      id: 'prepare',
      title: '校验与解压',
      detail: current === 'starting' ? '检查数据并拆分独立 train/val' : '检查数据结构与验证集',
      state: failed && !hasProgress ? 'error' : current === 'starting' ? 'active' : (hasProgress || done || current === 'training') ? 'done' : 'waiting',
    },
    {
      id: 'train',
      title: '模型训练',
      detail: status.totalEpochs > 0 ? `Epoch ${status.epoch}/${status.totalEpochs}` : '等待训练开始',
      state: failed && hasProgress ? 'error' : current === 'training' ? 'active' : done ? 'done' : 'waiting',
    },
    {
      id: 'save',
      title: '保存结果',
      detail: status.modelName || '生成新的 .pt 模型文件',
      state: failed ? 'error' : done ? 'done' : 'waiting',
    },
  ];
}

function statusSignature(status: TrainStatus): string {
  const metrics = status.metrics || {};
  const metricSignature = Object.keys(metrics)
    .sort()
    .map((key) => `${key}:${metrics[key]}`)
    .join('|');
  return [
    status.status,
    status.epoch,
    status.totalEpochs,
    status.running ? '1' : '0',
    status.error || '',
    status.modelPath || '',
    status.modelName || '',
    status.outputName || '',
    status.datasetId || '',
    metricSignature,
    `${status.history.length}:${status.history[status.history.length - 1]?.epoch || 0}`,
  ].join('::');
}

export default function TrainingPage({
  onBack,
  initialDataset,
  initialMapDraft,
}: {
  onBack?: () => void;
  initialDataset?: File | null;
  initialMapDraft?: TrainingMapDraft | null;
}) {
  const backendUrl = DEFAULT_BACKEND_URL;
  const { state, dispatch } = useAppContext();
  const { openPanel } = useFloatingPanels();
  const [zipFile, setZipFile] = useState<File | null>(() => initialDataset ?? null);
  const [mapDraft, setMapDraft] = useState<TrainingMapDraft | null>(() => initialMapDraft ?? null);
  const [draftTool, setDraftTool] = useState<DraftTool>('polygon');
  const [draftShapes, setDraftShapes] = useState<DraftShape[]>([]);
  const [activePoints, setActivePoints] = useState<DraftPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<DraftPoint | null>(null);
  const [draftSize, setDraftSize] = useState(DEFAULT_DRAFT_SIZE);
  const [draftColor, setDraftColor] = useState(DEFAULT_DRAFT_COLOR);
  const [draftView, setDraftView] = useState<DraftView>(DEFAULT_DRAFT_VIEW);
  const [draftDock, setDraftDock] = useState<DraftDock>('left');
  const [epochs, setEpochs] = useState(100);
  const [batch, setBatch] = useState(8);
  const [outputName, setOutputName] = useState('farmland_seg');
  const [training, setTraining] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [datasetPreview, setDatasetPreview] = useState<DatasetPreview | null>(null);
  const [logItems, setLogItems] = useState<LogItem[]>([
    { id: 'init', time: nowLabel(), tone: 'info', text: '训练中心已就绪，等待选择 YOLO 数据集。' },
  ]);
  const [status, setStatus] = useState<TrainStatus>({
    status: 'idle',
    epoch: 0,
    totalEpochs: 100,
    metrics: {},
    history: [],
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const draftCanvasRef = useRef<HTMLDivElement>(null);
  const eventKeyRef = useRef('');
  const sseDoneReceivedRef = useRef(false);
  const statusSignatureRef = useRef(statusSignature(status));
  const lastStatusCommitAtRef = useRef(0);
  const pendingStatusRef = useRef<{ next: TrainStatus; source: 'poll' | 'stream' } | null>(null);
  const statusCommitTimerRef = useRef<number | null>(null);

  const pushLog = useCallback((text: string, tone: LogItem['tone'] = 'info', key?: string) => {
    const nextKey = key || `${tone}:${text}`;
    if (key && eventKeyRef.current === nextKey) return;
    if (key) eventKeyRef.current = nextKey;
    setLogItems((items) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: nowLabel(), tone, text },
      ...items,
    ].slice(0, 8));
  }, []);

  const rememberTrainingModel = useCallback((modelPath?: string | null, modelName?: string | null) => {
    if (!modelPath) return;
    try {
      localStorage.setItem('webgis:lastTrainedModelPath', modelPath);
      localStorage.setItem('webgis:lastTrainedModelName', modelName || '');
      window.dispatchEvent(new Event('webgis-trained-model'));
    } catch {
      // localStorage can be blocked; the result card still shows the path.
    }
  }, []);

  useEffect(() => {
    if (!initialDataset) return;
    setZipFile(initialDataset);
    setMessage(`已从标注页面接收训练数据：${initialDataset.name}`);
    pushLog('已从标注页面接收训练数据，可直接开始训练。', 'success', `dataset:${initialDataset.name}:${initialDataset.size}`);
  }, [initialDataset, pushLog]);

  useEffect(() => {
    if (!initialMapDraft) return;
    setMapDraft(initialMapDraft);
    setDraftShapes([]);
    setActivePoints([]);
    setHoverPoint(null);
    setDraftView(DEFAULT_DRAFT_VIEW);
    setMessage('已接收当前地图视图，可在卫星草图上点、线、面标注需要训练的区域。');
    pushLog('已接收当前地图视图，可在训练中心标注后写回当前图层。', 'success', `map-draft:${initialMapDraft.createdAt}`);
  }, [initialMapDraft, pushLog]);

  const normalizeStatus = useCallback((data: Partial<TrainStatus>): TrainStatus => {
    const totalEpochs = Number(data.totalEpochs || epochs);
    const rawEpoch = Number(data.epoch || 0);
    return {
      status: data.status || 'idle',
      epoch: totalEpochs > 0 ? Math.min(rawEpoch, totalEpochs) : rawEpoch,
      totalEpochs,
      metrics: data.metrics || {},
      history: normalizeMetricHistory(data.history, totalEpochs),
      error: data.error,
      modelPath: data.modelPath,
      modelName: data.modelName,
      outputName: data.outputName,
      datasetId: data.datasetId,
      datasetPath: data.datasetPath,
      running: Boolean(data.running),
    };
  }, [epochs]);

  useEffect(() => {
    let cancelled = false;
    let previewUrl = '';
    setDatasetPreview(null);
    if (!zipFile) return () => undefined;
    JSZip.loadAsync(zipFile).then(async (zip) => {
      const image = Object.values(zip.files).find((entry) =>
        !entry.dir && /^images\/train\/[^/]+\.(jpg|jpeg|png)$/i.test(entry.name),
      );
      if (!image) return;
      const stem = image.name.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      const label = zip.file(`labels/train/${stem}.txt`);
      const [blob, labelText] = await Promise.all([
        image.async('blob'),
        label ? label.async('string') : Promise.resolve(''),
      ]);
      previewUrl = URL.createObjectURL(blob);
      const polygons = labelText.split(/\r?\n/).flatMap((line) => {
        const values = line.trim().split(/\s+/).slice(1).map(Number);
        if (values.length < 6 || values.some((value) => !Number.isFinite(value))) return [];
        const points: string[] = [];
        for (let index = 0; index < values.length; index += 2) {
          points.push(`${values[index] * 100},${values[index + 1] * 100}`);
        }
        return [points.join(' ')];
      });
      if (!cancelled) setDatasetPreview({ url: previewUrl, name: image.name, polygons });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [zipFile]);

  const noteStatus = useCallback((next: TrainStatus, source: 'poll' | 'stream' = 'stream') => {
    const statusKey = `${source}:${next.status}:${next.epoch}:${next.error || next.modelPath || ''}`;
    if (next.status === 'starting') {
      pushLog('后端已接收任务，正在校验并解压数据集。', 'info', statusKey);
    } else if (next.status === 'training') {
      const epochText = next.totalEpochs > 0 ? `${next.epoch}/${next.totalEpochs}` : String(next.epoch);
      pushLog(`训练进行中，当前 Epoch ${epochText}。`, 'info', statusKey);
    } else if (next.status === 'done') {
      pushLog(`训练完成，模型已保存为 ${next.modelName || next.outputName || 'best.pt'}。`, 'success', statusKey);
    } else if (next.status === 'failed') {
      pushLog(readableTrainError(next.error || '未知错误'), 'error', statusKey);
    }
  }, [pushLog]);

  const commitStatus = useCallback((next: TrainStatus, source: 'poll' | 'stream' = 'stream') => {
    const nextSignature = statusSignature(next);
    if (statusSignatureRef.current === nextSignature) {
      setTraining(Boolean(next.running));
      return;
    }
    statusSignatureRef.current = nextSignature;
    lastStatusCommitAtRef.current = Date.now();
    setStatus(next);
    setTraining(Boolean(next.running));
    noteStatus(next, source);
  }, [noteStatus]);

  const flushPendingStatus = useCallback(() => {
    if (statusCommitTimerRef.current !== null) {
      window.clearTimeout(statusCommitTimerRef.current);
      statusCommitTimerRef.current = null;
    }
    const pending = pendingStatusRef.current;
    pendingStatusRef.current = null;
    if (pending) commitStatus(pending.next, pending.source);
  }, [commitStatus]);

  const applyStatus = useCallback((next: TrainStatus, source: 'poll' | 'stream' = 'stream') => {
    const isFinal = next.status === 'done' || next.status === 'failed' || next.status === 'starting';
    if (source === 'poll' || isFinal) {
      if (statusCommitTimerRef.current !== null) {
        window.clearTimeout(statusCommitTimerRef.current);
        statusCommitTimerRef.current = null;
      }
      pendingStatusRef.current = null;
      commitStatus(next, source);
      return;
    }

    pendingStatusRef.current = { next, source };
    const elapsed = Date.now() - lastStatusCommitAtRef.current;
    if (elapsed >= 900) {
      flushPendingStatus();
      return;
    }
    if (statusCommitTimerRef.current === null) {
      statusCommitTimerRef.current = window.setTimeout(flushPendingStatus, 900 - elapsed);
    }
  }, [commitStatus, flushPendingStatus]);

  const handleCopyModelPath = useCallback(async () => {
    if (!status.modelPath) return;
    try {
      await navigator.clipboard.writeText(status.modelPath);
      setCopied(true);
      pushLog('模型路径已复制到剪贴板。', 'success', `copy:${status.modelPath}`);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      pushLog('浏览器不允许直接复制，请手动选择模型路径。', 'error', 'copy-failed');
    }
  }, [pushLog, status.modelPath]);

  const getDraftPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>): DraftPoint | null => {
    const node = draftCanvasRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const screenX = clamp01((event.clientX - rect.left) / rect.width);
    const screenY = clamp01((event.clientY - rect.top) / rect.height);
    return {
      x: clamp01(draftView.x + (screenX - 0.5) / draftView.zoom),
      y: clamp01(draftView.y + (screenY - 0.5) / draftView.zoom),
    };
  }, [draftView]);

  const handleDraftWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!mapDraft) return;
    event.preventDefault();
    const node = draftCanvasRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const screenX = clamp01((event.clientX - rect.left) / rect.width);
    const screenY = clamp01((event.clientY - rect.top) / rect.height);
    setDraftView((view) => {
      const contentX = view.x + (screenX - 0.5) / view.zoom;
      const contentY = view.y + (screenY - 0.5) / view.zoom;
      const nextZoom = Math.max(
        DRAFT_MIN_ZOOM,
        Math.min(DRAFT_MAX_ZOOM, view.zoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18)),
      );
      return clampDraftView({
        zoom: nextZoom,
        x: contentX - (screenX - 0.5) / nextZoom,
        y: contentY - (screenY - 0.5) / nextZoom,
      });
    });
  }, [mapDraft]);

  const handleDeleteDraftShape = useCallback((event: ReactPointerEvent<SVGElement>, id: string) => {
    if (draftTool !== 'delete') return;
    event.preventDefault();
    event.stopPropagation();
    setDraftShapes((items) => items.filter((shape) => shape.id !== id));
  }, [draftTool]);

  const handleDraftPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!mapDraft) return;
    if (draftTool === 'delete') return;
    const point = getDraftPoint(event);
    if (!point) return;
    if (draftTool === 'point') {
      setDraftShapes((items) => [...items, { id: createDraftId('map-draft-point'), type: 'point', points: [point] }]);
      return;
    }
    if (draftTool === 'polygon' && activePoints.length >= 3 && isNearDraftPoint(point, activePoints[0])) {
      setDraftShapes((items) => [
        ...items,
        { id: createDraftId('map-draft-polygon'), type: 'polygon', points: activePoints },
      ]);
      setActivePoints([]);
      setHoverPoint(null);
      return;
    }
    setActivePoints((points) => [...points, point]);
  }, [activePoints, draftTool, getDraftPoint, mapDraft]);

  const handleDraftPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (draftTool === 'point' || draftTool === 'delete' || activePoints.length === 0) return;
    const point = getDraftPoint(event);
    if (!point) return;
    setHoverPoint(draftTool === 'polygon' && activePoints.length >= 3 && isNearDraftPoint(point, activePoints[0])
      ? activePoints[0]
      : point);
  }, [activePoints, draftTool, getDraftPoint]);

  const handleDraftPointerLeave = useCallback(() => {
    setHoverPoint(null);
  }, []);

  const canFinishDraftShape = draftTool === 'line'
    ? activePoints.length >= 2
    : draftTool === 'polygon' && activePoints.length >= 3;

  const handleFinishDraftShape = useCallback(() => {
    if (!canFinishDraftShape || draftTool === 'delete') return;
    setDraftShapes((items) => [
      ...items,
      { id: createDraftId(`map-draft-${draftTool}`), type: draftTool, points: activePoints },
    ]);
    setActivePoints([]);
    setHoverPoint(null);
  }, [activePoints, canFinishDraftShape, draftTool]);

  const handleUndoDraftPoint = useCallback(() => {
    setActivePoints((points) => points.slice(0, -1));
    setHoverPoint(null);
  }, []);

  const handleClearDraftRects = useCallback(() => {
    setDraftShapes([]);
    setActivePoints([]);
    setHoverPoint(null);
  }, []);

  const handleAddDraftToLayer = useCallback(() => {
    if (!mapDraft || draftShapes.length === 0) return;
    let layerId = state.layers.find((layer) => layer.name === MANUAL_LABEL_LAYER_NAME)?.id;
    if (!layerId) {
      layerId = crypto.randomUUID();
      dispatch({ type: 'ADD_LAYER', layer: { id: layerId, name: MANUAL_LABEL_LAYER_NAME, visible: true } });
    }
    const offset = state.features.length;
    const features = draftShapes.map((shape, index) => draftShapeToFeature(shape, mapDraft.bounds, layerId, offset + index, draftColor));
    dispatch({ type: 'BATCH_ADD_FEATURES', features });
    dispatch({ type: 'SET_CURRENT_LAYER', id: layerId });
    setMessage(`已添加 ${features.length} 个地图标注到“${MANUAL_LABEL_LAYER_NAME}”，草图仍保留。`);
    pushLog(`已添加 ${features.length} 个地图标注到“${MANUAL_LABEL_LAYER_NAME}”。`, 'success', `map-draft-added:${features.length}:${mapDraft.createdAt}`);
    flyToFeatureAfterReturn(features[0]);
  }, [dispatch, draftColor, draftShapes, mapDraft, pushLog, state.currentLayerId, state.features.length, state.layers]);

  const handleUseDraftAsDataset = useCallback(async () => {
    if (!mapDraft) return;
    const pendingPolygon: DraftShape | null = draftTool === 'polygon' && activePoints.length >= 3
      ? { id: createDraftId('map-draft-polygon'), type: 'polygon', points: activePoints }
      : null;
    const trainingShapes = pendingPolygon ? [...draftShapes, pendingPolygon] : draftShapes;
    const polygonShapes = trainingShapes.filter((shape) => shape.type === 'polygon');
    if (polygonShapes.length === 0) {
      setMessage('YOLO 分割训练需要面标注；请先选择“面”并圈出至少一个地块。');
      pushLog('地图草图没有可训练的面标注，未生成训练数据。', 'error', 'map-draft-no-polygons');
      return;
    }

    try {
      const response = await fetch(mapDraft.imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const imageBlob = await response.blob();
      const layerId = state.layers.find((layer) => layer.name === MANUAL_LABEL_LAYER_NAME)?.id || 'training-map-draft';
      const features = polygonShapes.map((shape, index) =>
        draftShapeToFeature(shape, mapDraft.bounds, layerId, index, draftColor),
      );
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const zipBlob = await buildYoloDatasetZipFromImage(
        imageBlob,
        features,
        mapDraft.bounds,
        `map_draft_${stamp}`,
      );
      const zipName = `map_draft_yolo_${new Date().toISOString().slice(0, 10)}.zip`;
      const nextFile = new File([zipBlob], zipName, { type: 'application/zip' });
      setZipFile(nextFile);
      setMapDraft(null);
      setDraftShapes([]);
      setActivePoints([]);
      setHoverPoint(null);
      setDraftView(DEFAULT_DRAFT_VIEW);
      setMessage(`已将草图面标注和整幅地图底图转为训练数据：${polygonShapes.length} 个面。草图编辑已退出，可直接开始训练。`);
      pushLog(`已生成地图草图训练数据：${polygonShapes.length} 个面标注。`, 'success', `map-draft-dataset:${zipName}:${polygonShapes.length}`);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '地图草图训练数据生成失败。';
      setMessage(`训练数据生成失败：${errorText}`);
      pushLog(errorText, 'error', `map-draft-dataset-error:${errorText}`);
    }
  }, [activePoints, draftColor, draftShapes, draftTool, mapDraft, pushLog, state.layers]);

  // Check backend availability on mount
  useEffect(() => {
    fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(3000) })
      .then((r) => {
        setBackendAvailable(r.ok);
        pushLog(r.ok ? '本地训练后端已连接。' : '本地训练后端响应异常。', r.ok ? 'success' : 'error', `health:${r.ok}`);
      })
      .catch(() => {
        setBackendAvailable(false);
        pushLog('未连接到本地训练后端，请先启动后端服务。', 'error', 'health:false');
      });
  }, [backendUrl, pushLog]);

  const refreshStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${backendUrl}/train/status`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return;
      const data = await resp.json();
      const next = normalizeStatus(data);
      setBackendAvailable(true);
      applyStatus(next, 'poll');
    } catch {
      // Training status is best-effort; actual actions surface connection errors.
    }
  }, [applyStatus, backendUrl, normalizeStatus]);

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, training ? 4000 : 12000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, training]);

  useEffect(() => () => {
    if (statusCommitTimerRef.current !== null) {
      window.clearTimeout(statusCommitTimerRef.current);
      statusCommitTimerRef.current = null;
    }
  }, []);

  const handleTrain = useCallback(async () => {
    setMessage('');
    setCopied(false);
    if (!zipFile) {
      setMessage('请先选择从主界面导出的 YOLO ZIP 文件。');
      pushLog('还没有选择 YOLO ZIP，训练未开始。', 'error', 'missing-zip');
      return;
    }

    setTraining(true);
    sseDoneReceivedRef.current = false;
    const starting: TrainStatus = { status: 'starting', epoch: 0, totalEpochs: epochs, metrics: {}, history: [] };
    statusSignatureRef.current = statusSignature(starting);
    setStatus(starting);
    pushLog(`提交训练任务：${zipFile.name}，${epochs} 轮，Batch ${batch}。`, 'info', `submit:${zipFile.name}:${epochs}:${batch}`);
    try {
      const form = new FormData();
      form.append('dataset', zipFile, zipFile.name);
      form.append('epochs', String(epochs));
      form.append('batch', String(batch));
      form.append('output_name', outputName || 'farmland_seg');
      const resp = await fetch(`${backendUrl}/train`, { method: 'POST', body: form });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let errMsg = errText;
        try { const errJson = JSON.parse(errText); errMsg = errJson.error || errText; } catch {}
        throw new Error(errMsg || `HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error('后端没有返回训练流。');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let lineEnd = buffer.indexOf('\n');
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const next = normalizeStatus({ ...data, status: data.status || 'training' });
              applyStatus(next, 'stream');
              if (data.status === 'done') {
                sseDoneReceivedRef.current = true;
                flushPendingStatus();
                rememberTrainingModel(data.modelPath, data.modelName || data.outputName);
                setMessage(`训练完成！模型已保存到 ${data.modelPath || 'backend/models/farmland_seg_best.pt'}`);
              }
              if (data.status === 'failed') {
                sseDoneReceivedRef.current = true;
                flushPendingStatus();
                setMessage(`训练失败：${readableTrainError(data.error || '未知错误')}`);
              }
            } catch { /* skip malformed SSE line */ }
          }
          lineEnd = buffer.indexOf('\n');
        }
      }
    } catch (error) {
      const errorText = readableTrainError(error);
      setMessage(`训练失败：${errorText}`);
      pushLog(errorText, 'error', `train-error:${errorText}`);
    } finally {
      flushPendingStatus();
      if (!sseDoneReceivedRef.current) {
        window.setTimeout(() => { setTraining(false); }, 3000);
      } else {
        setTraining(false);
      }
      refreshStatus();
    }
  }, [applyStatus, backendUrl, batch, epochs, flushPendingStatus, normalizeStatus, outputName, pushLog, refreshStatus, rememberTrainingModel, zipFile]);

  const handleOpenMapInference = useCallback(() => {
    rememberTrainingModel(status.modelPath, status.modelName || status.outputName || outputName);
    openPanel('farm');
    onBack?.();
  }, [onBack, openPanel, outputName, rememberTrainingModel, status.modelName, status.modelPath, status.outputName]);

  const progress = status.totalEpochs > 0
    ? Math.max(0, Math.min(100, (status.epoch / status.totalEpochs) * 100))
    : 0;
  const tone = statusTone(status.status);
  const hasHistoricalResult = !training && !zipFile && status.status === 'done' && Boolean(status.modelPath);
  const timeline = useMemo(
    () => buildTimeline(status, Boolean(zipFile) || hasHistoricalResult),
    [hasHistoricalResult, status, zipFile],
  );
  const metricCards = useMemo(() => {
    const metrics = status.metrics || {};
    return [
      {
        label: 'mAP50',
        value: formatPercent(metricValue(metrics, ['metrics/mAP50(M)', 'metrics/mAP50(B)', 'mAP50', 'map50'])),
        hint: 'IoU 0.5 平均精度',
      },
      {
        label: 'mAP50-95',
        value: formatPercent(metricValue(metrics, ['metrics/mAP50-95(M)', 'metrics/mAP50-95(B)', 'mAP50-95', 'map'])),
        hint: '多阈值平均精度',
      },
      {
        label: 'Recall',
        value: formatPercent(metricValue(metrics, ['metrics/recall(M)', 'metrics/recall(B)', 'recall'])),
        hint: '验证集召回率',
      },
      {
        label: 'Seg Loss',
        value: formatMetric(metricValue(metrics, ['val/seg_loss', 'train/seg_loss']), 3),
        hint: '分割损失，越低越好',
      },
    ];
  }, [status.metrics]);
  const hasMetrics = Object.keys(status.metrics || {}).length > 0;
  const map50 = metricValue(status.metrics || {}, ['metrics/mAP50(M)', 'metrics/mAP50(B)', 'mAP50', 'map50']);
  const qualityWarning = status.status === 'done' && map50 !== null && map50 < 0.3
    ? `当前验证集 mAP50 为 ${formatPercent(map50)}，仅适合验证训练流程；增加不同区域、时相和地块形态的真实样本后再用于自动分割。`
    : '';
  const satelliteTiles = useMemo(
    () => (mapDraft && mapDraft.sourceType !== 'local' ? buildAmapSatelliteTiles(mapDraft.amapCenter, mapDraft.zoom) : []),
    [mapDraft],
  );
  const draftPolygonCount = useMemo(
    () => draftShapes.filter((shape) => shape.type === 'polygon').length,
    [draftShapes],
  );
  const draftTrainingPolygonCount = draftPolygonCount + (
    draftTool === 'polygon' && activePoints.length >= 3 ? 1 : 0
  );
  const draftLayoutStyle = useMemo(
    () => ({ '--draft-map-size': `${draftSize}px`, '--draft-color': draftColor }) as CSSProperties,
    [draftColor, draftSize],
  );
  const draftViewStyle = useMemo(
    () => ({
      left: `${(0.5 - draftView.x * draftView.zoom) * 100}%`,
      top: `${(0.5 - draftView.y * draftView.zoom) * 100}%`,
      transform: `scale(${draftView.zoom})`,
    }) as CSSProperties,
    [draftView],
  );
  const activePreviewPoints = draftTool === 'point' || draftTool === 'delete' || activePoints.length === 0
    ? []
    : [...activePoints, hoverPoint || activePoints[activePoints.length - 1]];

  return (
    <main className="training-page">
      <header className="training-header">
        <button className="training-back-btn" type="button" onClick={() => onBack?.()}>
          <ArrowLeft size={16} />返回地图
        </button>
        <div>
          <h1>农田训练中心</h1>
          <p>从标注页面直接接收数据，或手动选择 YOLO ZIP，训练 YOLOv11 分割模型。</p>
        </div>
        {backendAvailable && (
          <span className="training-backend-badge">后端已连接</span>
        )}
        {!backendAvailable && (
          <span className="training-backend-badge off">后端未连接 — 请运行 npm run dev:all</span>
        )}
      </header>

      <section className="training-overview">
        <div className={`training-hero-card ${tone}`}>
          <div className="training-hero-main">
            <div className="training-status-icon">
              {tone === 'success' ? <CheckCircle2 size={24} /> : tone === 'error' ? <AlertTriangle size={24} /> : tone === 'running' ? <Loader2 size={24} className="farm-spin" /> : <Activity size={24} />}
            </div>
            <div>
              <span className="training-eyebrow">{hasHistoricalResult ? '最近一次训练' : '当前训练状态'}</span>
              <h2>{readableStatusLabel(status.status)}</h2>
              <p>
                {tone === 'running'
                  ? `正在执行 Epoch ${status.epoch}/${status.totalEpochs}`
                  : tone === 'success'
                    ? hasHistoricalResult
                      ? '上次训练已完成；选择新数据集即可开始下一次训练。'
                      : '训练已经完成，可以在结果区查看模型文件。'
                    : tone === 'error'
                      ? '训练中断，请查看实时日志中的错误提示。'
                      : '选择数据集后即可启动新的分割模型训练。'}
              </p>
            </div>
          </div>
          <div className="training-hero-progress">
            <div className="training-progress-bar">
              <div className="training-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="training-summary-card">
          <Database size={18} />
          <span>{hasHistoricalResult ? '新任务数据集' : '数据集'}</span>
          <strong>{zipFile ? zipFile.name : '未选择'}</strong>
        </div>
        <div className="training-summary-card">
          <Clock3 size={18} />
          <span>{hasHistoricalResult ? '新任务参数' : '训练参数'}</span>
          <strong>{epochs} 轮 / Batch {batch}</strong>
        </div>
        <div className="training-summary-card">
          <FolderCheck size={18} />
          <span>{hasHistoricalResult ? '最近模型' : '输出模型'}</span>
          <strong>{status.modelName || `${outputName || 'farmland_seg'}_best.pt`}</strong>
        </div>
      </section>

      <section className="training-grid training-grid-rich">
        {mapDraft && (
          <div className="training-card training-map-draft-card">
            <div className="training-card-header">
              <MapIcon size={17} />
              <strong>地图标注草稿</strong>
              <span className="training-map-chip">{draftShapes.length} 个标注 · {draftTrainingPolygonCount} 个可训练面</span>
            </div>
            <div className="training-map-tools" role="group" aria-label="地图标注工具">
              <button type="button" className={draftTool === 'point' ? 'active' : ''} onClick={() => setDraftTool('point')}><MapPin size={14} />点</button>
              <button type="button" className={draftTool === 'line' ? 'active' : ''} onClick={() => setDraftTool('line')}><Minus size={14} />线</button>
              <button type="button" className={draftTool === 'polygon' ? 'active' : ''} onClick={() => setDraftTool('polygon')}><Square size={14} />面</button>
              <button type="button" className={draftTool === 'delete' ? 'active' : ''} onClick={() => { setDraftTool('delete'); setActivePoints([]); setHoverPoint(null); }}><Trash2 size={14} />删除</button>
              <button type="button" onClick={handleFinishDraftShape} disabled={!canFinishDraftShape}><CheckCircle2 size={14} />{draftTool === 'polygon' ? '闭合面' : '完成当前'}</button>
              <button type="button" onClick={handleUndoDraftPoint} disabled={activePoints.length === 0}>撤销点</button>
            </div>
            <div className={`training-map-draft-layout dock-${draftDock}`} style={draftLayoutStyle}>
              <div
                ref={draftCanvasRef}
                className={`training-map-canvas ${draftTool === 'delete' ? 'delete-mode' : ''}`}
                onPointerDown={handleDraftPointerDown}
                onPointerMove={handleDraftPointerMove}
                onPointerLeave={handleDraftPointerLeave}
                onWheel={handleDraftWheel}
              >
                <div className="training-map-zoom-layer" style={draftViewStyle}>
                  <img className="training-map-static-fallback" src={mapDraft.imageUrl} alt="" draggable={false} decoding="async" />
                  <div className="training-map-tiles" aria-hidden="true">
                    {satelliteTiles.map((tile) => (
                      <img key={tile.id} src={tile.url} style={tile.style} alt="" draggable={false} decoding="async" />
                    ))}
                  </div>
                  <svg className="training-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="当前标注">
                    {draftShapes.map((shape) => shape.type === 'point' ? (
                      <circle key={shape.id} className={`training-map-point ${draftTool === 'delete' ? 'training-map-deletable' : ''}`} cx={shape.points[0].x * 100} cy={shape.points[0].y * 100} r="0.9" onPointerDown={(event) => handleDeleteDraftShape(event, shape.id)} />
                    ) : shape.type === 'line' ? (
                      <polyline key={shape.id} className={`training-map-line ${draftTool === 'delete' ? 'training-map-deletable' : ''}`} points={svgPointList(shape.points)} onPointerDown={(event) => handleDeleteDraftShape(event, shape.id)} />
                    ) : (
                      <polygon key={shape.id} className={`training-map-polygon ${draftTool === 'delete' ? 'training-map-deletable' : ''}`} points={svgPointList(shape.points)} onPointerDown={(event) => handleDeleteDraftShape(event, shape.id)} />
                    ))}
                    {activePreviewPoints.length > 0 && (
                      draftTool === 'polygon'
                        ? <polygon className="training-map-polygon preview" points={svgPointList(activePreviewPoints)} />
                        : <polyline className="training-map-line preview" points={svgPointList(activePreviewPoints)} />
                    )}
                    {activePoints.map((point, index) => (
                      <circle
                        key={`active-${index}`}
                        className={`training-map-point preview ${draftTool === 'polygon' && activePoints.length >= 3 && index === 0 ? 'close-target' : ''}`}
                        cx={point.x * 100}
                        cy={point.y * 100}
                        r={draftTool === 'polygon' && activePoints.length >= 3 && index === 0 ? '1' : '0.65'}
                      />
                    ))}
                  </svg>
                </div>
              </div>
              <div className="training-map-side">
                <p className="training-muted">
                  {mapDraft.sourceType === 'local'
                    ? '当前使用本地影像；文件和坐标只在浏览器与 127.0.0.1 本地后端之间处理。'
                    : '当前底图使用卫星图层；面标注至少 3 个点后点击起点即可闭合，也可点“闭合面”结束。'}
                </p>
                <div className="training-map-coordinate-grid">
                  <span><strong>来源</strong>{mapDraft.sourceName}</span>
                  {mapDraft.sourceType !== 'local' && <span><strong>缩放</strong>{mapDraft.zoom}</span>}
                  <span className="wide"><strong>WGS84 边界</strong>{formatDraftBounds(mapDraft.bounds)}</span>
                </div>
                <div className="training-map-control-grid" aria-label="草图显示设置">
                  <label className="training-map-size-control">
                    <span>标注画布大小 <strong>{draftSize}px</strong></span>
                    <input
                      type="range"
                      min={360}
                      max={980}
                      step={20}
                      value={draftSize}
                      onChange={(event) => setDraftSize(Number(event.currentTarget.value))}
                    />
                  </label>
                  <div className="training-map-dock-control">
                    <span>草图位置</span>
                    <div className="training-map-dock-buttons">
                      {(['left', 'right', 'top'] as DraftDock[]).map((dock) => (
                        <button
                          key={dock}
                          type="button"
                          className={draftDock === dock ? 'active' : ''}
                          onClick={() => setDraftDock(dock)}
                        >
                          {DRAFT_DOCK_LABELS[dock]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="training-map-color-control">
                    <span>草稿颜色 <strong>{draftColor}</strong></span>
                    <input
                      type="color"
                      value={draftColor}
                      onChange={(event) => setDraftColor(event.currentTarget.value)}
                    />
                  </label>
                  <span className="training-map-position-hint">滚轮缩放不改变框选范围：{Math.round(draftView.zoom * 100)}% · {DRAFT_DOCK_LABELS[draftDock]} · {draftSize}px</span>
                </div>
                <div className="training-map-actions">
                  <a className="training-secondary-btn" href={mapDraft.imageUrl} target="_blank" rel="noreferrer" download="webgis-map-draft.jpg">
                    <FileArchive size={14} />下载底图
                  </a>
                  <button className="training-secondary-btn" type="button" onClick={handleUseDraftAsDataset} disabled={draftTrainingPolygonCount === 0}>
                    <Database size={14} />作为训练数据
                  </button>
                  <button className="training-secondary-btn" type="button" onClick={handleClearDraftRects} disabled={draftShapes.length === 0 && activePoints.length === 0}>
                    <Trash2 size={14} />清空
                  </button>
                  <button className="training-primary-btn" type="button" onClick={handleAddDraftToLayer} disabled={draftShapes.length === 0}>
                    <CheckCircle2 size={15} />添加至图层
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="training-card training-card-setup">
          <div className="training-card-header">
            <FileArchive size={17} />
            <strong>数据与参数</strong>
          </div>
          <button className="training-upload" type="button" onClick={() => fileRef.current?.click()}>
            <UploadCloud size={16} />
            <span>{zipFile ? zipFile.name : '选择 YOLO ZIP'}</span>
          </button>
          <input ref={fileRef} hidden type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] || null)} />
          {datasetPreview && (
            <div className="training-dataset-preview">
              <div><strong>实际训练样本预览</strong><span>{datasetPreview.name} · {datasetPreview.polygons.length} 个面</span></div>
              <div className="training-dataset-preview-canvas">
                <img src={datasetPreview.url} alt="实际写入训练集的样本" />
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="训练标注叠加预览">
                  {datasetPreview.polygons.map((points, index) => <polygon key={index} points={points} />)}
                </svg>
              </div>
            </div>
          )}
          <p className="training-muted">
            可从农田识别面板直接转入；也可以手动选择已备份的 YOLO ZIP。
          </p>
          <label className="training-input-row">
            <span>训练轮数</span>
            <input type="number" min={10} max={500} step={10} value={epochs} onChange={(e) => setEpochs(Number(e.currentTarget.value))} />
          </label>
          <label className="training-input-row">
            <span>Batch</span>
            <input type="number" min={1} max={64} step={1} value={batch} onChange={(e) => setBatch(Number(e.currentTarget.value))} />
          </label>
          <label className="training-input-row training-input-row-text">
            <span>模型名</span>
            <input type="text" value={outputName} onChange={(e) => setOutputName(e.currentTarget.value)} />
          </label>
          <button className="training-primary-btn" type="button" onClick={handleTrain} disabled={training || !zipFile}>
            {training ? <Loader2 size={15} className="farm-spin" /> : <Play size={15} />}
            {training ? '训练中...' : '开始训练'}
          </button>
        </div>

        <div className="training-card training-card-wide">
          <div className="training-card-header">
            <LineChart size={17} />
            <strong>{hasHistoricalResult ? '最近训练过程' : '训练过程'}</strong>
          </div>
          <div className="training-timeline">
            {timeline.map((step) => (
              <div className={`training-step ${step.state}`} key={step.id}>
                <span className="training-step-dot" />
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="training-metric-grid">
            {metricCards.map((metric) => (
              <div className="training-metric-card" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </div>
            ))}
          </div>

          <div className="training-history-grid">
            <MetricHistoryChart
              title="分割 Loss"
              history={status.history}
              keys={['val/seg_loss', 'train/seg_loss', 'val/box_loss', 'train/box_loss']}
              color="#e97732"
            />
            <MetricHistoryChart
              title="mAP50"
              history={status.history}
              keys={['metrics/mAP50(M)', 'metrics/mAP50(B)', 'mAP50', 'map50']}
              color="#2f8f5b"
              percent
            />
          </div>

          {qualityWarning && (
            <div className="training-quality-warning">
              <AlertTriangle size={15} />
              <span>{qualityWarning}</span>
            </div>
          )}

          {hasMetrics && (
            <details className="training-raw-metrics">
              <summary>查看原始训练指标</summary>
              <div className="training-metrics">
                {Object.entries(status.metrics).map(([key, value]) => (
                  <span key={key}>{key}: {typeof value === 'number' ? value.toFixed(4) : value}</span>
                ))}
              </div>
            </details>
          )}
          {status.error && <div className="training-message error">{readableTrainError(status.error)}</div>}
          {message && (
            <div className={`training-message ${message.includes('失败') ? 'error' : 'success'}`}>
              {message}
            </div>
          )}
        </div>

        <div className="training-card training-card-log">
          <div className="training-card-header">
            <TerminalSquare size={17} />
            <strong>实时日志</strong>
            {training && <span className="training-live"><Radio size={13} /> Live</span>}
          </div>
          <div className="training-log-list">
            {logItems.map((item) => (
              <div className={`training-log-item ${item.tone}`} key={item.id}>
                <time>{item.time}</time>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="training-card training-result-card">
          <div className="training-card-header">
            <CheckCircle2 size={17} />
            <strong>训练结果</strong>
          </div>
          {status.modelPath ? (
            <div className="training-result-main">
              <span>可用于农田地块分割的模型文件</span>
              <strong>{status.modelName || `${outputName || 'farmland_seg'}_best.pt`}</strong>
              <code>{status.modelPath}</code>
              {status.datasetPath && <code>数据集：{status.datasetPath}</code>}
              <button className="training-secondary-btn" type="button" onClick={handleCopyModelPath}>
                <Copy size={14} />
                {copied ? '已复制' : '复制路径'}
              </button>
              <button className="training-primary-btn" type="button" onClick={handleOpenMapInference}>
                <MapIcon size={14} />
                返回地图识别区域
              </button>
            </div>
          ) : (
            <div className="training-result-empty">
              <Clock3 size={18} />
              <span>暂无模型产物，完成训练后自动记录最新模型。</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
