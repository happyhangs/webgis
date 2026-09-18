import type { MapAPI } from './utils/mapAPI';

declare global {
  interface Window {
    __webgis?: MapAPI;
    __webgis_selectedLayer?: any;
    __webgis_labelMode?: boolean;
    /** 标注模式中是否处于"连续画地块"意图（Esc 中断后据此自动续画）。 */
    __webgis_labelDrawIntended?: boolean;
  }
}

export {};
