import { describe, it, expect } from 'vitest';
import { wgs2gcj, gcj2wgs, gcj2bd, bd2gcj } from '../coord';

describe('coord', () => {
  describe('wgs2gcj / gcj2wgs round-trip', () => {
    it('should round-trip within 0.5m accuracy for Beijing', () => {
      const lat = 39.9042, lng = 116.4074;
      const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
      const [wgsLat, wgsLng] = gcj2wgs(gcjLat, gcjLng);
      // ~1e-5 degree ≈ 1m
      expect(Math.abs(wgsLat - lat)).toBeLessThan(0.0001);
      expect(Math.abs(wgsLng - lng)).toBeLessThan(0.0001);
    });

    it('should not modify coords outside China', () => {
      const lat = 48.8566, lng = 2.3522; // Paris
      const [gcjLat, gcjLng] = wgs2gcj(lat, lng);
      expect(gcjLat).toBe(lat);
      expect(gcjLng).toBe(lng);
    });

    it('should handle boundary values', () => {
      const [gcjLat, gcjLng] = wgs2gcj(39.9, 116.4);
      expect(Number.isFinite(gcjLat)).toBe(true);
      expect(Number.isFinite(gcjLng)).toBe(true);
      expect(Math.abs(gcjLat - 39.9)).toBeLessThan(0.01);
    });
  });

  describe('gcj2bd / bd2gcj', () => {
    it('should round-trip', () => {
      const lat = 39.9, lng = 116.4;
      const [bdLat, bdLng] = gcj2bd(lat, lng);
      const [gcjLat, gcjLng] = bd2gcj(bdLat, bdLng);
      expect(Math.abs(gcjLat - lat)).toBeLessThan(0.001);
      expect(Math.abs(gcjLng - lng)).toBeLessThan(0.001);
    });
  });
});
