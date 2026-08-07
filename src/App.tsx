import { AppProvider } from './AppContext';
import Toolbar from './Toolbar';
import LayerPanel from './LayerPanel';
import FieldPanel from './FieldPanel';
import FieldDetectPanel from './FieldDetectPanel';
import PropertyPanel from './PropertyPanel';
import WeatherPanel from './WeatherPanel';
import MapView from './MapView';
import { FloatingPanelProvider } from './FloatingPanelContext';
import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import type { TrainingMapDraft } from './types';

const TrainingPage = lazy(() => import('./TrainingPage'));

function AppShell() {
  const [showTraining, setShowTraining] = useState(
    () => window.location.pathname.replace(/\/+$/, '') === '/train'
  );
  const [trainingDataset, setTrainingDataset] = useState<File | null>(null);
  const [trainingMapDraft, setTrainingMapDraft] = useState<TrainingMapDraft | null>(null);

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
