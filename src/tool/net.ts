// 桌面端的请求函数：用 Tauri HTTP 插件（无跨域限制）。工具已开启 unsafe-headers，可以带 Cookie / Referer，并去掉 Origin。
import { httpFetch } from '../kit/platform';
import { BASE_HEADERS, type Getter } from './core';

const TIMEOUT = 15_000;

export const tauriGet: Getter = async (url, headers = {}) => {
  const res = await httpFetch(url, {
    method: 'GET',
    // Origin 设为空串时插件会把它去掉，部分网站见到 tauri://localhost 会拒绝
    headers: { ...BASE_HEADERS, Origin: '', ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/abort|timeout/i.test(msg) ? '请求超时' : msg);
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = h.getSetCookie?.() ?? (h.get('set-cookie') ? h.get('set-cookie')!.split(/,(?=\s*[^;,=\s]+=)/) : []);
  return { text, setCookie };
};
