import type { ImageFetcher } from "./types.js";

/** Descarga con timeout y tope de bytes (no confía en Content-Length). Sólo http(s). */
export class HttpImageFetcher implements ImageFetcher {
  constructor(private opts: { timeoutMs?: number; maxBytes?: number } = {}) {}
  async fetch(url: string) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error("Protocolo de imagen no permitido"), { code: "image_bad_url" });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(u, { signal: ctrl.signal, redirect: "follow" });
      const max = this.opts.maxBytes ?? 10 * 1024 * 1024;
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > max) { ctrl.abort(); throw Object.assign(new Error("Imagen excede el tamaño máximo"), { code: "image_too_large" }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
      return { bytes, contentType: res.headers.get("content-type"), status: res.status };
    } finally {
      clearTimeout(t);
    }
  }
}
