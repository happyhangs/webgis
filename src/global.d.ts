import type { MapAPI } from './utils/mapAPI';

declare global {
  interface Window {
    __webgis?: MapAPI;
    __webgis_selectedLayer?: any;
    __webgis_labelMode?: boolean;
  }
}

export {};
