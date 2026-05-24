import type { FeatureProperties, StrokeStyle } from '../types';

export const STROKE_STYLE_OPTIONS: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

const STROKE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted'];

export function isAreaShape(shapeType: FeatureProperties['shapeType']): boolean {
  return shapeType === 'Polygon' || shapeType === 'Rectangle';
}

export function getDefaultFeatureStyle(
  shapeType: FeatureProperties['shapeType'],
  color = '#3388ff',
): Pick<FeatureProperties, 'color' | 'fillColor' | 'fillEnabled' | 'strokeStyle' | 'strokeWidth'> {
  return {
    color,
    fillColor: color,
    fillEnabled: isAreaShape(shapeType),
    strokeStyle: 'solid',
    strokeWidth: 3,
  };
}

export function normalizeFeatureStyle(
  props: Partial<FeatureProperties> | undefined,
  shapeType: FeatureProperties['shapeType'],
  fallbackColor = '#3388ff',
): Pick<FeatureProperties, 'color' | 'fillColor' | 'fillEnabled' | 'strokeStyle' | 'strokeWidth'> {
  const color = normalizeColor(props?.color, fallbackColor);
  return {
    color,
    fillColor: normalizeColor(props?.fillColor, color),
    fillEnabled:
      typeof props?.fillEnabled === 'boolean' ? props.fillEnabled : isAreaShape(shapeType),
    strokeStyle: normalizeStrokeStyle(props?.strokeStyle),
    strokeWidth: normalizeStrokeWidth(props?.strokeWidth),
  };
}

export function getDashArray(style: StrokeStyle, width: number): string | undefined {
  if (style === 'dashed') return `${width * 3} ${width * 2}`;
  if (style === 'dotted') return `1 ${Math.max(width * 1.8, 4)}`;
  return undefined;
}

function normalizeColor(color: unknown, fallback: string): string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeStrokeStyle(style: unknown): StrokeStyle {
  return STROKE_STYLES.includes(style as StrokeStyle) ? (style as StrokeStyle) : 'solid';
}

function normalizeStrokeWidth(width: unknown): number {
  const n = Number(width);
  if (!Number.isFinite(n)) return 3;
  return Math.min(12, Math.max(1, Math.round(n)));
}
