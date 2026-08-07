import { describe, it, expect } from 'vitest';
import { getDefaultFeatureStyle, isAreaShape } from '../featureStyle';

describe('featureStyle', () => {
  it('should provide default style for Marker', () => {
    const style = getDefaultFeatureStyle('Marker');
    expect(style.color).toBeDefined();
    expect(style.fillColor).toBeDefined();
    expect(style.strokeWidth).toBeGreaterThan(0);
  });

  it('should provide default style for Line', () => {
    const style = getDefaultFeatureStyle('Line');
    expect(style.color).toBeDefined();
    expect(typeof style.fillEnabled).toBe('boolean');
  });

  it('should provide default style for Polygon', () => {
    const style = getDefaultFeatureStyle('Polygon');
    expect(style.fillEnabled).toBe(true);
    expect(style.strokeWidth).toBeGreaterThan(0);
  });

  it('should identify area shapes', () => {
    expect(isAreaShape('Polygon')).toBe(true);
    expect(isAreaShape('Rectangle')).toBe(true);
    expect(isAreaShape('Marker')).toBe(false);
    expect(isAreaShape('Line')).toBe(false);
  });
});
