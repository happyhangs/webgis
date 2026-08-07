import { describe, expect, it } from 'vitest';
import { validateKmlSource } from '../kml';

describe('validateKmlSource', () => {
  it('accepts a normal KML document and removes a BOM', () => {
    const source = '\uFEFF<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"></kml>';

    expect(validateKmlSource(source)).toBe(source.slice(1));
  });

  it('rejects an empty file', () => {
    expect(() => validateKmlSource(' \r\n ')).toThrow('文件为空');
  });

  it('rejects placeholder content without a KML root element', () => {
    expect(() => validateKmlSource('<!-- Unused KML export. Removed. -->')).toThrow(
      '文件不包含 <kml> 根节点',
    );
  });
});
