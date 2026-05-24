import type { BasemapConfig, BasemapKey } from './types';

export const DEFAULT_BASEMAP: BasemapKey = 'osm';

export const BASEMAPS: Record<BasemapKey, BasemapConfig> = {
  osm: {
    key: 'osm',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap contributors',
  },
  amap: {
    key: 'amap',
    name: '高德标准',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  },
  amap_sat: {
    key: 'amap_sat',
    name: '高德卫星',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  },
  google: {
    key: 'google',
    name: '谷歌标准',
    url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google',
  },
  google_sat: {
    key: 'google_sat',
    name: '谷歌卫星',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google',
  },
};

export const BASEMAP_OPTIONS = Object.values(BASEMAPS);

export function normalizeBasemapKey(value: string | undefined): BasemapKey {
  return value && value in BASEMAPS ? (value as BasemapKey) : DEFAULT_BASEMAP;
}

export function getBasemapConfig(value: string | undefined): BasemapConfig {
  return BASEMAPS[normalizeBasemapKey(value)];
}
