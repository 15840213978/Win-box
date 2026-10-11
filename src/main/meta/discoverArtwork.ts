// 详情背景图：只搜索横版剧照，下载并解码成功才落缓存；封面禁止走此链路。
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { nativeImage } from 'electron';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Agent, request } from 'undici';
import { JsonStore } from '../store/JsonStore';
import { dispatchChain } from '../net/proxy';
import { so360SearchBackdrops, SO360_REFERER } from './so360Provider';
import { LOCAL_PROXY_BASE } from '../../shared/constants';
import type { Logger, MetaImages } from '../../shared/types';

const agent = new Agent({ connect: { timeout: 6000 } });
interface ArtworkEntry { at: number; files: string[] }

export class DiscoverArtwork {
  private inflight = new Map<string, Promise<MetaImages>>();
  private misses = new Map<string, number>();
  private lanes: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
  private lane = 0;
  constructor(private store: JsonStore, private cacheRoot: string, private log: Logger) {}

  async images(name: string, mediaType: 'movie' | 'tv', year?: string, kind: 'backdrop' | 'poster' = 'backdrop'): Promise<MetaImages> {
    // 在读取缓存前阻断旧版搜索海报，避免继续展示已缓存的错封面。
    if (kind === 'poster') return { backdrops: [], posters: [] };
    const title = name.trim().slice(0, 160);
    if (title.length < 2) return { backdrops: [], posters: [] };
    const key = createHash('sha256').update(`${kind}|${mediaType}|${title}|${year || ''}`).digest('hex');
    const toImages = (files: string[]): MetaImages => {
      const urls = files.map(file => `${LOCAL_PROXY_BASE}/file/discovery-images/${file}`);
      return { backdrops: urls, posters: [] };
    };
    const stored = this.store.getObject<ArtworkEntry | null>(key, null);
    const files = (Array.isArray(stored?.files) ? stored.files : []).filter(file => /^[a-f0-9]{64}\.(jpg|png|webp)$/.test(file) && existsSync(join(this.cacheRoot, 'discovery-images', file)));
    if (files.length) return toImages(files);
    if (Date.now() < (this.misses.get(key) || 0)) return toImages([]);
    const running = this.inflight.get(key);
    if (running) return running;
    const run = async () => {
      const signal = AbortSignal.timeout(25000);
      const candidates = await so360SearchBackdrops(this.log, title, mediaType, year, signal);
      const downloaded: string[] = [];
      // 有一个可用图就停止，避免首屏批量搜图/下载；后续命中直接读本地缓存。
      for (const c of candidates) {
        try {
          const r = await request(c.img, {
            dispatcher: dispatchChain(c.img, agent)[0],
            headers: { accept: 'image/*', 'User-Agent': 'Mozilla/5.0', Referer: SO360_REFERER },
            headersTimeout: 6000, bodyTimeout: 6000,
            signal,
          });
          const type = String(r.headers['content-type'] || '').split(';')[0];
          const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[type];
          if (r.statusCode !== 200 || !ext || Number(r.headers['content-length']) > 5 * 1024 * 1024) { await r.body.dump(); continue; }
          const parts: Buffer[] = [];
          let size = 0;
          for await (const chunk of r.body) {
            const bytes = Buffer.from(chunk);
            size += bytes.length;
            if (size > 5 * 1024 * 1024) { r.body.destroy(); throw new Error('图片过大'); }
            parts.push(bytes);
          }
          if (size < 1024) continue;
          const buffer = Buffer.concat(parts);
          const decoded = nativeImage.createFromBuffer(buffer);
          const { width, height } = decoded.getSize();
          if (decoded.isEmpty() || width < 800 || height < 400 || width / height < 1.4 || width / height > 2.4) continue;
          const file = `${createHash('sha256').update(`${key}|${c.img}`).digest('hex')}.${ext}`;
          mkdirSync(join(this.cacheRoot, 'discovery-images'), { recursive: true });
          writeFileSync(join(this.cacheRoot, 'discovery-images', file), buffer);
          downloaded.push(file);
          break;
        } catch { /* 尝试下一个相关横图 */ }
      }
      if (downloaded.length) {
        this.store.setObject(key, { at: Date.now(), files: downloaded });
        const index = this.store.getObject<Array<{ key: string; files: string[] }>>('index', []);
        const updated = [...(Array.isArray(index) ? index : []).filter(e => e.key !== key), { key, files: downloaded }];
        // 至多保存 100 部的补全图（每部 ≤5MB），清理只限本模块拥有的哈希文件。
        for (const evicted of updated.splice(0, Math.max(0, updated.length - 100))) {
          for (const file of evicted.files || []) if (/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(file)) {
            try { rmSync(join(this.cacheRoot, 'discovery-images', file), { force: true }); } catch { /* 文件暂时占用 */ }
          }
          this.store.delete(evicted.key);
        }
        this.store.setObject('index', updated);
        this.store.flush();
      }
      else { this.misses.set(key, Date.now() + 60000); }
      return toImages(downloaded);
    };
    const lane = this.lane++ % this.lanes.length;
    const job = this.lanes[lane].then(run).catch(e => {
      this.log.w(`发现页图片补全失败: ${(e as Error).message}`);
      this.misses.set(key, Date.now() + 60000);
      return toImages([]);
    }).finally(() => this.inflight.delete(key));
    this.lanes[lane] = job;
    this.inflight.set(key, job);
    return job;
  }
}
