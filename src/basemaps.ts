import type { BasemapConfig, BasemapKey, CustomBasemapInput } from './types';
import { CUSTOM_BASEMAP_KEY } from './types';

export { CUSTOM_BASEMAP_KEY };

const CUSTOM_STORAGE_KEY = 'webgis_custom_basemap';

export const DEFAULT_BASEMAP: BasemapKey = 'osm';

export const BASEMAPS: Record<BasemapKey, BasemapConfig> = {
  offline: {
    key: 'offline',
    name: '离线空白底图',
    url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"%3E%3Crect width="256" height="256" fill="%23eef2f4"/%3E%3Cpath d="M0 0H256V256H0Z" fill="none" stroke="%23dce4e8"/%3E%3C/svg%3E',
    attribution: '离线模式',
  },
  osm: {
    key: 'osm',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap contributors',
  },
  // ── 高德 ──
  amap: {
    key: 'amap',
    name: '高德标准',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
    wgs2gcj: true,
  },
  amap_sat: {
    key: 'amap_sat',
    name: '高德卫星',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
    wgs2gcj: true,
  },
  amap_hybrid: {
    key: 'amap_hybrid',
    name: '高德卫星混合',
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
    wgs2gcj: true,
    overlayUrl: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}&size=1&scl=1',
    overlaySubdomains: ['1', '2', '3', '4'],
    overlayOpacity: 0.35,
  },
  // ── 谷歌 ──
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
  google_hybrid: {
    key: 'google_hybrid',
    name: '谷歌卫星混合',
    url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    subdomains: ['0', '1', '2', '3'],
    attribution: '&copy; Google',
    overlayUrl: 'https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}',
    overlaySubdomains: ['0', '1', '2', '3'],
    overlayOpacity: 0.5,
  },
  esri_sat: {
    key: 'esri_sat',
    name: 'ESRI卫星',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
  },
};

export const BASEMAP_OPTIONS = Object.values(BASEMAPS);

export function normalizeBasemapKey(value: string | undefined): string {
  if (value === CUSTOM_BASEMAP_KEY) return CUSTOM_BASEMAP_KEY;
  return value && value in BASEMAPS ? value : DEFAULT_BASEMAP;
}

export function loadCustomBasemap(): CustomBasemapInput | null {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data.name === 'string' && data.name.trim() &&
      typeof data.url === 'string' && data.url.trim()
    ) {
      return {
        name: data.name.trim(),
        url: data.url.trim(),
        attribution: typeof data.attribution === 'string' ? data.attribution : undefined,
        maxZoom: typeof data.maxZoom === 'number' && data.maxZoom > 0 ? data.maxZoom : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCustomBasemap(cfg: CustomBasemapInput): void {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // silently ignore
  }
}

export function clearCustomBasemap(): void {
  try {
    localStorage.removeItem(CUSTOM_STORAGE_KEY);
  } catch {
    // silently ignore
  }
}

export function isCustomBasemap(value: string | undefined): boolean {
  return value === CUSTOM_BASEMAP_KEY;
}

export function getBasemapConfig(value: string | undefined): BasemapConfig {
  if (value === CUSTOM_BASEMAP_KEY) {
    const custom = loadCustomBasemap();
    if (custom) {
      return {
        key: CUSTOM_BASEMAP_KEY,
        name: custom.name,
        url: custom.url,
        attribution: custom.attribution || '',
        maxZoom: custom.maxZoom,
      };
    }
    return BASEMAPS[DEFAULT_BASEMAP];
  }
  return BASEMAPS[normalizeBasemapKey(value) as BasemapKey];
}
