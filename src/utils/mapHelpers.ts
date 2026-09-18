import L from 'leaflet';
import { getDashArray, getDefaultFeatureStyle, isAreaShape } from './featureStyle';
import type { GeoJSONFeature, BasemapConfig } from '../types';

export const WEB_MERCATOR_WORLD_BOUNDS = L.latLngBounds(
  [-85.05112878, -180],
  [85.05112878, 180],
);

export const SHAPE_LABELS: Record<string, string> = {
  Marker: '点',
  Line: '线',
  Polygon: '面',
  Rectangle: '矩形',
};

// Track the manual label layer ID so buildFeature can skip the default name
let _manualLabelLayerId: string | null = null;

export function setManualLabelLayerId(id: string | null) {
  _manualLabelLayerId = id;
}

function _isManualLabelLayerId(id: string) {
  return id === _manualLabelLayerId;
}

export function buildFeature(geojson: any, shape: string, layerId: string): GeoJSONFeature {
  const shapeType =
    shape === 'Marker'
      ? 'Marker'
      : shape === 'Line'
        ? 'Line'
        : shape === 'Rectangle'
          ? 'Rectangle'
          : 'Polygon';

  const isManualLabelLayer = layerId && _isManualLabelLayerId(layerId);
  const label = isManualLabelLayer ? '' : (SHAPE_LABELS[shapeType] || '要素');
  let defaultName = isManualLabelLayer ? '' : `未命名${label}`;

  if (isManualLabelLayer) {
    // 不在此处预分配编号：真正的 MAN-xxx 由 useManualLabelLayer 依据现有最大号统一分配，
    // 避免用计数式临时号造成与历史标注重号（旧实现会让新块先显示为 MAN-001）。
    defaultName = '农田标定-新块';
  }
  return {
    ...geojson,
    properties: {
      id: crypto.randomUUID(),
      name: defaultName || `地块 ${SHAPE_LABELS[shapeType] || ''}`,
      description: '',
      ...getDefaultFeatureStyle(shapeType as GeoJSONFeature['properties']['shapeType']),
      shapeType: shapeType as GeoJSONFeature['properties']['shapeType'],
      layerId,
      ...(isManualLabelLayer ? {
        parcelRole: 'parcel' as const,
        source: 'manual-farmland-label' as const,
      } : {}),
    },
  };
}

export function emitFeatureClick(feature: GeoJSONFeature) {
  window.dispatchEvent(new CustomEvent('webgis-feature-click', {
    detail: { id: feature.properties.id },
  }));
}

export function applyStyle(layer: any, feature: GeoJSONFeature, selected: boolean) {
  const p = feature.properties;
  if (p.shapeType === 'Marker') {
    // Geoman 绘制点产生 L.Marker（没有 setStyle）；渲染链路用 circleMarker。
    // 两种情况都兼容：Marker 用 setIcon 重设样式，Path 类沿用 setStyle。
    if (typeof layer.setStyle !== 'function') {
      if (typeof layer.setIcon === 'function') {
        layer.setIcon(L.divIcon({
          className: '',
          html: `<span style="display:block;width:${selected ? 20 : 16}px;height:${selected ? 20 : 16}px;border-radius:50%;background:${p.color};border:${selected ? 3 : 2}px solid ${selected ? '#ff0' : '#fff'};box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`,
          iconSize: [selected ? 20 : 16, selected ? 20 : 16],
          iconAnchor: [selected ? 10 : 8, selected ? 10 : 8],
        }));
      }
      return;
    }
    layer.setStyle({
      radius: selected ? 10 : 8,
      fillColor: p.color,
      color: selected ? '#ff0' : '#fff',
      weight: selected ? 4 : 2,
      fillOpacity: 0.9,
    });
  } else {
    const weight = selected ? p.strokeWidth + 2 : p.strokeWidth;
    layer.setStyle({
      color: p.color,
      fillColor: p.fillColor,
      weight,
      dashArray: getDashArray(p.strokeStyle, weight),
      lineCap: p.strokeStyle === 'dotted' ? 'round' : 'butt',
      fillOpacity: isAreaShape(p.shapeType) && p.fillEnabled ? (selected ? 0.45 : 0.26) : 0,
    });
  }
}

export function clearLayerTooltip(layer: any) {
  if (typeof layer.getTooltip === 'function' && layer.getTooltip()) {
    layer.unbindTooltip();
  }
}

export function getTileLayerOptions(cfg: BasemapConfig): L.TileLayerOptions {
  const options: L.TileLayerOptions = {
    attribution: cfg.attribution,
    maxZoom: cfg.maxZoom ?? 19,
    noWrap: true,
    bounds: WEB_MERCATOR_WORLD_BOUNDS,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 3,
  };

  if (cfg.subdomains?.length) {
    options.subdomains = cfg.subdomains;
  }

  return options;
}

export function getOverlayTileLayerOptions(cfg: BasemapConfig): L.TileLayerOptions {
  const options: L.TileLayerOptions = {
    attribution: '',
    maxZoom: cfg.maxZoom ?? 19,
    noWrap: true,
    bounds: WEB_MERCATOR_WORLD_BOUNDS,
    opacity: cfg.overlayOpacity ?? 0.4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 3,
  };

  if (cfg.overlaySubdomains?.length) {
    options.subdomains = cfg.overlaySubdomains;
  }

  return options;
}
