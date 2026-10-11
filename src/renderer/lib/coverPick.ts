// 封面顺序：用户配置的 TMDB → 源封面（含同图中继）→ 豆瓣 → 暂无封面。
export interface CoverPickInput {
  tmdb?: string;
  douban?: string;
  srcPic?: string;
  srcBad?: boolean;
  relay?: string;
  relayBad?: boolean;
}

export function pickCover(i: CoverPickInput): string {
  if (i.tmdb?.trim()) return i.tmdb.trim();
  if (i.srcPic?.trim() && !i.srcBad) return i.srcPic.trim();
  if (i.relay?.trim() && !i.relayBad) return i.relay.trim();
  return i.douban?.trim() || '';
}

export interface CoverRequest { name: string; year?: string; pic?: string }
export interface CoverResolver {
  hasTmdb: boolean;
  query: (provider: 'tmdb' | 'douban') => Promise<string>;
  validate: (url: string) => Promise<boolean>;
  relay: (url: string) => string;
}

/** 每层单独容错，失败才能进入下一层；任何一层都不会调用图片搜索。 */
export async function resolveCover(input: CoverRequest, resolver: CoverResolver): Promise<string> {
  const usable = async (url: string): Promise<string> => {
    try { return url && await resolver.validate(url) ? url : ''; } catch { return ''; }
  };
  const lookup = async (provider: 'tmdb' | 'douban'): Promise<string> => {
    try { return await usable(await resolver.query(provider)); } catch { return ''; }
  };
  if (resolver.hasTmdb) {
    const tmdb = await lookup('tmdb');
    if (tmdb) return tmdb;
  }
  const source = input.pic?.trim() || '';
  if (source) {
    const direct = await usable(source);
    if (direct) return direct;
    const relay = resolver.relay(source);
    if (relay && relay !== source) {
      const retried = await usable(relay);
      if (retried) return retried;
    }
  }
  return input.name.trim() ? lookup('douban') : '';
}

interface ImageLike {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
}

/** 图片经过浏览器实际解码才选用；失败不会留下破图或透明遮罩。 */
export function preloadImage(url: string, timeoutMs = 8000): Promise<boolean> {
  const u = (url || '').trim();
  const Ctor = (globalThis as unknown as { Image?: new () => ImageLike }).Image;
  if (!u || !Ctor) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Ctor();
    const finish = (ok: boolean): void => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      if (!ok) img.src = '';
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = u;
  });
}
