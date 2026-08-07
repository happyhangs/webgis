import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';

interface PanelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_PADDING = 8;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 140;
const INTERACTIVE_SELECTOR = 'button,input,select,textarea,a,[role="button"],[data-no-drag]';
let floatingPanelZIndex = 1000;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(INTERACTIVE_SELECTOR);
}

function applyPanelPosition(panel: HTMLElement, position: PanelPosition, zIndex?: number) {
  const style = panel.style;
  style.left = `${position.x}px`;
  style.top = `${position.y}px`;
  style.right = 'auto';
  style.bottom = 'auto';
  style.width = `${position.width}px`;
  style.height = `${position.height}px`;
  style.maxWidth = 'calc(100% - 16px)';
  style.maxHeight = 'calc(100% - 16px)';
  if (zIndex) style.zIndex = String(zIndex);
}

export function useDraggablePanel() {
  const panelRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(false);
  const dragFrameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zIndex, setZIndex] = useState<number | null>(null);

  const bringToFront = useCallback(() => {
    floatingPanelZIndex += 1;
    setZIndex(floatingPanelZIndex);
    return floatingPanelZIndex;
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    document.body.classList.remove('floating-panel-dragging');
  }, []);

  useEffect(() => {
    const mounted = !!panelRef.current;
    if (mounted && !mountedRef.current) {
      mountedRef.current = true;
      bringToFront();
    }
    if (!mounted) {
      mountedRef.current = false;
    }
  });

  const getClampedPosition = useCallback((next: PanelPosition): PanelPosition | null => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return null;

    const parentRect = parent.getBoundingClientRect();
    const width = Math.min(
      next.width,
      Math.max(MIN_WIDTH, parentRect.width - EDGE_PADDING * 2),
    );
    const height = Math.min(
      next.height,
      Math.max(MIN_HEIGHT, parentRect.height - EDGE_PADDING * 2),
    );
    const maxX = parentRect.width - width - EDGE_PADDING;
    const maxY = parentRect.height - height - EDGE_PADDING;

    return {
      x: clamp(next.x, EDGE_PADDING, maxX),
      y: clamp(next.y, EDGE_PADDING, maxY),
      width,
      height,
    };
  }, []);

  useEffect(() => {
    if (!position) return undefined;
    const handleResize = () => {
      setPosition((current) => (current ? getClampedPosition(current) : current));
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [getClampedPosition, position]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;

    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const start = getClampedPosition(position || {
      x: rect.left - parentRect.left,
      y: rect.top - parentRect.top,
      width: rect.width,
      height: rect.height,
    });
    if (!start) return;

    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail in older browsers; window listeners still handle dragging.
    }

    setPosition(start);
    setDragging(true);
    bringToFront();
    document.body.classList.add('floating-panel-dragging');
    applyPanelPosition(panel, start, 1300);

    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    let latestPosition = start;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const next = getClampedPosition({
        ...start,
        x: start.x + moveEvent.clientX - startClientX,
        y: start.y + moveEvent.clientY - startClientY,
      });
      if (!next) return;
      latestPosition = next;
      // ponytail: DOM write during drag; React state syncs once on release.
      if (dragFrameRef.current === null) {
        dragFrameRef.current = requestAnimationFrame(() => {
          dragFrameRef.current = null;
          const currentPanel = panelRef.current;
          if (currentPanel) applyPanelPosition(currentPanel, latestPosition, 1300);
        });
      }
    };

    const stopDragging = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      applyPanelPosition(panel, latestPosition);
      setPosition(latestPosition);
      document.body.classList.remove('floating-panel-dragging');
      setDragging(false);
      try {
        event.currentTarget.releasePointerCapture(pointerId);
      } catch {
        // Safe to ignore after pointer cancellation.
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  }, [bringToFront, getClampedPosition, position]);

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(event.target)) return;
    setPosition(null);
  }, []);

  const panelStyle = useMemo<CSSProperties | undefined>(() => {
    const activeZIndex = dragging ? 1300 : zIndex || undefined;
    if (!position) return activeZIndex ? { zIndex: activeZIndex } : undefined;
    return {
      left: position.x,
      top: position.y,
      right: 'auto',
      bottom: 'auto',
      width: position.width,
      height: position.height,
      maxWidth: 'calc(100% - 16px)',
      maxHeight: 'calc(100% - 16px)',
      zIndex: activeZIndex,
    };
  }, [dragging, position, zIndex]);

  // ── Resize handles ──

  const resizingRef = useRef<{ dir: string; startWidth: number; startHeight: number; startX: number; startY: number; pointerId: number } | null>(null);

  const handleResizeStart = useCallback((dir: string) => (_event: ReactPointerEvent<HTMLElement>) => {
    _event.preventDefault();
    _event.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    resizingRef.current = {
      dir,
      startWidth: rect.width,
      startHeight: rect.height,
      startX: _event.clientX,
      startY: _event.clientY,
      pointerId: _event.pointerId,
    };
    try { _event.currentTarget.setPointerCapture(_event.pointerId); } catch {}

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== resizingRef.current?.pointerId) return;
      moveEvent.preventDefault();
      const r = resizingRef.current!;
      const dx = moveEvent.clientX - r.startX;
      const dy = moveEvent.clientY - r.startY;

      let newWidth = r.startWidth;
      let newHeight = r.startHeight;

      if (r.dir.includes('e')) newWidth = r.startWidth + dx;
      if (r.dir.includes('w')) { newWidth = r.startWidth - dx; }
      if (r.dir.includes('s')) newHeight = r.startHeight + dy;
      if (r.dir.includes('n')) { newHeight = r.startHeight - dy; }

      setPosition((prev) => {
        if (!prev) return prev;
        const clamped = getClampedPosition({
          x: prev.x,
          y: prev.y,
          width: newWidth,
          height: newHeight,
        });
        return clamped || prev;
      });
    };

    const stopResize = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== resizingRef.current?.pointerId) return;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.classList.remove('floating-panel-dragging');
      resizingRef.current = null;
      try { _event.currentTarget.releasePointerCapture(_event.pointerId); } catch {}
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }, [getClampedPosition]);

  const resizeHandle = useCallback((dir: string) => ({
    className: `floating-resize-handle floating-resize-${dir}`,
    onPointerDown: handleResizeStart(dir),
  }), [handleResizeStart]);

  return {
    panelRef,
    panelStyle,
    dragging,
    dragHandleProps: {
      onPointerDown: handlePointerDown,
      onDoubleClick: handleDoubleClick,
      title: '拖动移动浮窗，双击恢复默认位置',
    },
    resizeHandle,
  };
}
