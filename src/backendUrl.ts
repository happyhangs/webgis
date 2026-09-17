/** 后端 API 的默认地址（本地农田分割服务）。 */
export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8765';

/**
 * 解析实际使用的后端地址。
 * 允许通过构建期环境变量 VITE_BACKEND_URL 覆盖，未设置时回落到本地默认。
 */
export function resolveBackendUrl(): string {
  const fromEnv = import.meta.env.VITE_BACKEND_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/+$/, '');
  }
  return DEFAULT_BACKEND_URL;
}
