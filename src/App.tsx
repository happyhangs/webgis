import { AppProvider } from './AppContext';
import Toolbar from './Toolbar';
import LayerPanel from './LayerPanel';
import FieldPanel from './FieldPanel';
import FieldDetectPanel from './FieldDetectPanel';
import PropertyPanel from './PropertyPanel';
import WeatherPanel from './WeatherPanel';
import MapView from './MapView';
import { FloatingPanelProvider } from './FloatingPanelContext';
import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import type { TrainingMapDraft } from './types';
import { useAppContext } from './AppContext';
import { mergeFeaturesBounds } from './utils/geoBounds';

const TrainingPage = lazy(() => import('./TrainingPage'));

function AppShell() {
  const [showTraining, setShowTraining] = useState(
    () => window.location.pathname.replace(/\/+$/, '') === '/train'
  );
  const [trainingDataset, setTrainingDataset] = useState<File | null>(null);
  const [trainingMapDraft, setTrainingMapDraft] = useState<TrainingMapDraft | null>(null);
  const { state } = useAppContext();
  const autoLocatedRef = useRef(false);

  // 启动后自动定位到已有数据的范围，避免打开页面落在默认视图看不到自己的标注。
  // 注意：本地状态恢复发生在父级 Provider 的 effect 中（晚于本 effect 首次执行），
  // 因此 features 为空时不能锁定标记，要等数据到达后再定位。
  useEffect(() => {
    if (autoLocatedRef.current || showTraining) return;
    if (state.features.length === 0) return;
    const bounds = mergeFeaturesBounds(state.features);
    if (!bounds) {
      autoLocatedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      const api = (window as Window & { __webgis?: { flyToBounds?: (b: typeof bounds) => void } }).__webgis;
      if (api?.flyToBounds) {
        api.flyToBounds(bounds);
        autoLocatedRef.current = true;
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [showTraining, state.features]);


  useEffect(() => {
    const onPop = () => {
      const isTrainingPath = window.location.pathname.replace(/\/+$/, '') === '/train';
      setShowTraining(isTrainingPath);
      if (!isTrainingPath) {
        setTrainingDataset(null);
        setTrainingMapDraft(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openTraining = useCallback((dataset: File | null = null, mapDraft: TrainingMapDraft | null = null) => {
    setTrainingDataset(dataset);
    setTrainingMapDraft(mapDraft);
    window.history.pushState({}, '', '/train');
    setShowTraining(true);
  }, []);

  const closeTraining = useCallback(() => {
    setTrainingDataset(null);
    setTrainingMapDraft(null);
    window.history.replaceState({}, '', '/');
    setShowTraining(false);
  }, []);

  if (showTraining) {
    return (
      <Suspense fallback={<div className="training-overlay-fallback">加载训练中心...</div>}>
        <TrainingPage onBack={closeTraining} initialDataset={trainingDataset} initialMapDraft={trainingMapDraft} />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar onOpenTraining={openTraining} />
      <div className="app-main">
        <LayerPanel />
        <div className="map-stage">
          <MapView />
          <FieldDetectPanel onOpenTraining={openTraining} />
          <FieldPanel />
          <WeatherPanel />
        </div>
        <PropertyPanel />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <FloatingPanelProvider>
        <AppShell />
      </FloatingPanelProvider>
    </AppProvider>
  );
}
