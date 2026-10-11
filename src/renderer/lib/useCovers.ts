import { useEffect, useMemo, useState } from 'react';
import { client } from '../api/client';
import { wrapImageUrlForRelay } from '../../shared/driveProvider';
import { preloadImage, resolveCover, type CoverRequest } from './coverPick';

export interface CoverItem extends CoverRequest { id: string }
// 同一窗口中的重复片名共享请求；队列限制主进程查询和图片预加载的并发。
const queries = new Map<string, Promise<string>>();
const lanes: Promise<unknown>[] = Array.from({ length: 4 }, () => Promise.resolve());
let lane = 0;
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const slot = lane++ % lanes.length;
  const pending = lanes[slot].then(job);
  lanes[slot] = pending.catch(() => undefined);
  return pending;
}

/** 所有页面共用封面链路，始终保留原始源图，不把补图写回来源或历史。 */
export function useCovers(items: CoverItem[], enabled = true) {
  const [settings, setSettings] = useState<{ key: string; hasTmdb: boolean } | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string[]>>({});
  const signature = JSON.stringify(items);
  const stableItems: CoverItem[] = useMemo(() => JSON.parse(signature), [signature]);
  useEffect(() => {
    let alive = true;
    let request = 0;
    const load = (): void => {
      const current = ++request;
      void client.metaGetSettings().then(s => {
        if (!alive || current !== request) return;
        const key = JSON.stringify([s.tmdbApiKey, s.tmdbApiBase, s.tmdbImageBase]);
        setSettings(prev => prev?.key === key ? prev : { key, hasTmdb: s.hasUserKey });
      }).catch(() => { if (alive && current === request) setSettings(prev => prev || { key: '', hasTmdb: false }); });
    };
    load();
    const storage = (event: StorageEvent): void => { if (event.key === 'winbox-meta-revision') load(); };
    window.addEventListener('focus', load);
    window.addEventListener('winbox:meta-changed', load);
    window.addEventListener('storage', storage);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
      window.removeEventListener('winbox:meta-changed', load);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const itemKey = (item: CoverItem): string => JSON.stringify([settings?.key, item.id, item.name, item.year, item.pic]);
  useEffect(() => {
    if (!enabled || !settings) return;
    let alive = true;
    for (const item of stableItems) {
      const key = JSON.stringify([settings.key, item.id, item.name, item.year, item.pic]);
      if (covers[key] !== undefined) continue;
      void enqueue(async () => {
        if (!alive) return;
        const cover = await resolveCover(item, {
          hasTmdb: settings.hasTmdb,
          query: provider => {
            if (!item.name.trim()) return Promise.resolve('');
            const queryKey = JSON.stringify([settings.key, provider, item.name, item.year]);
            let job = queries.get(queryKey);
            if (!job) {
              job = client.metaSearch(item.name, item.year, provider).then(hit => hit?.poster || '').catch(() => '');
              if (queries.size >= 500) queries.delete(queries.keys().next().value!);
              queries.set(queryKey, job);
            }
            return job;
          },
          validate: url => failed[key]?.includes(url) ? Promise.resolve(false) : preloadImage(url),
          relay: url => /\/(?:img|file)\?/.test(url) ? '' : wrapImageUrlForRelay(url, navigator.userAgent),
        });
        if (alive) setCovers(prev => ({ ...prev, [key]: cover }));
      });
    }
    return () => { alive = false; };
    // 完成结果不重启批次，避免仍在处理的队列被取消。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableItems, settings, enabled, failed]);
  return {
    picOf: (item: CoverItem): string => {
      const key = itemKey(item);
      const source = item.pic?.trim() || '';
      return covers[key] ?? (failed[key]?.includes(source) ? '' : source);
    },
    onError: (item: CoverItem, url: string): void => {
      const key = itemKey(item);
      if (failed[key]?.includes(url)) return;
      setFailed(prev => ({ ...prev, [key]: [...(prev[key] || []), url] }));
      setCovers(prev => { const next = { ...prev }; delete next[key]; return next; });
    },
  };
}
