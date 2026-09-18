import { Check, Hexagon, Trash2, Undo2 } from 'lucide-react';

export type AnnotationTool = 'draw' | 'remove';

/**
 * 标注模式下地图顶部的专用工具条：
 * 画地块 / 删错块 / 撤销上一块 / 完成标注。
 * 标注期间通用工具栏的绘制与编辑按钮会被禁用，避免两个工具系统互相打架。
 */
export default function AnnotationToolbar({
  count,
  tool,
  canUndo,
  onSelectDraw,
  onSelectRemove,
  onUndo,
  onFinish,
}: {
  count: number;
  tool: AnnotationTool;
  canUndo: boolean;
  onSelectDraw: () => void;
  onSelectRemove: () => void;
  onUndo: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="map-labeling-banner">
      <span className="map-labeling-dot" />
      <span className="map-labeling-text">标注模式：连续勾画，自动编号（Esc 取消当前块）</span>
      <span className="map-labeling-tools">
        <button
          type="button"
          className={`map-labeling-tool${tool === 'draw' ? ' active' : ''}`}
          onClick={onSelectDraw}
          title="画地块：在地图上逐点勾画，点回起点或双击完成一块"
        >
          <Hexagon size={13} />画地块
        </button>
        <button
          type="button"
          className={`map-labeling-tool${tool === 'remove' ? ' active' : ''}`}
          onClick={onSelectRemove}
          title="删错块：点击画错的地块即可删除"
        >
          <Trash2 size={13} />删错块
        </button>
        <button
          type="button"
          className="map-labeling-tool"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销本次标注中刚画的最后一块"
        >
          <Undo2 size={13} />撤销
        </button>
      </span>
      <button className="map-labeling-finish" type="button" onClick={onFinish}>
        <Check size={13} />
        完成标注（{count} 块）
      </button>
    </div>
  );
}
