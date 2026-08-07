import { CloudSun, Grid3x3, ScanEye } from 'lucide-react';
import type { FloatingPanelId } from './FloatingPanelContext';
import { stopFloatingPanelButtonEvent, useFloatingPanels } from './FloatingPanelContext';

const dockItems: Array<{
  id: FloatingPanelId;
  label: string;
  title: string;
  icon: typeof ScanEye;
}> = [
  { id: 'farm', label: '农田', title: '农田识别浮窗', icon: ScanEye },
  { id: 'field', label: '地块', title: '地块管理浮窗', icon: Grid3x3 },
  { id: 'weather', label: '天气', title: '天气查询浮窗', icon: CloudSun },
];

export default function FloatingPanelDock({ compact = false }: { compact?: boolean }) {
  const { isPanelOpen, togglePanel } = useFloatingPanels();

  return (
    <div className={`floating-dock ${compact ? 'compact' : ''}`}>
      {!compact && <span className="floating-dock-label">浮窗</span>}
      <div className="floating-dock-buttons">
        {dockItems.map((item) => {
          const Icon = item.icon;
          const open = isPanelOpen(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`floating-dock-btn ${open ? 'active' : ''}`}
              onPointerDown={stopFloatingPanelButtonEvent}
              onClick={(event) => {
                stopFloatingPanelButtonEvent(event);
                togglePanel(item.id);
              }}
              title={`${open ? '最小化' : '打开'}${item.title}`}
              aria-label={`${open ? '最小化' : '打开'}${item.title}`}
              aria-pressed={open}
            >
              <Icon size={14} />
              {!compact && <span>{item.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
