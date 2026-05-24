import { AppProvider } from './AppContext';
import Toolbar from './Toolbar';
import LayerPanel from './LayerPanel';
import PropertyPanel from './PropertyPanel';
import MapView from './MapView';

export default function App() {
  return (
    <AppProvider>
      <div className="app-shell">
        <Toolbar />
        <div className="app-main">
          <LayerPanel />
          <MapView />
          <PropertyPanel />
        </div>
      </div>
    </AppProvider>
  );
}
