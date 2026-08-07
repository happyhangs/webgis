import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type FloatingPanelId = 'farm' | 'field' | 'weather';

type FloatingPanelState = Record<FloatingPanelId, boolean>;

interface FloatingPanelContextValue {
  openPanels: FloatingPanelState;
  isPanelOpen: (id: FloatingPanelId) => boolean;
  openPanel: (id: FloatingPanelId) => void;
  closePanel: (id: FloatingPanelId) => void;
  togglePanel: (id: FloatingPanelId) => void;
}

const initialOpenPanels: FloatingPanelState = {
  farm: false,
  field: false,
  weather: false,
};

const FloatingPanelContext = createContext<FloatingPanelContextValue | null>(null);

export function FloatingPanelProvider({ children }: { children: ReactNode }) {
  const [openPanels, setOpenPanels] = useState<FloatingPanelState>(initialOpenPanels);
  const isPanelOpen = useCallback((id: FloatingPanelId) => openPanels[id], [openPanels]);
  const openPanel = useCallback((id: FloatingPanelId) => {
    setOpenPanels((current) => ({ ...current, [id]: true }));
  }, []);
  const closePanel = useCallback((id: FloatingPanelId) => {
    setOpenPanels((current) => ({ ...current, [id]: false }));
  }, []);
  const togglePanel = useCallback((id: FloatingPanelId) => {
    setOpenPanels((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const value = useMemo<FloatingPanelContextValue>(() => ({
    openPanels,
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
  }), [closePanel, isPanelOpen, openPanel, openPanels, togglePanel]);

  return (
    <FloatingPanelContext.Provider value={value}>
      {children}
    </FloatingPanelContext.Provider>
  );
}

export function useFloatingPanels() {
  const ctx = useContext(FloatingPanelContext);
  if (!ctx) throw new Error('useFloatingPanels must be used within FloatingPanelProvider');
  return ctx;
}

export function stopFloatingPanelButtonEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}
