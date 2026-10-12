import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaStore } from '../src/main/meta/MetaStore';
import { JsonStore } from '../src/main/store/JsonStore';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('undici', async () => ({ ...await vi.importActual<any>('undici'), request: vi.fn() }));
import { request } from 'undici';
import {
  setTmdbRuntime, tmdbCreds, tmdbDiscover, tmdbGenres, tmdbGenrePage, tmdbSearchTitle,
  tmdbSuggest, tmdbImages, tmdbExtras, __resetMemCacheForTest,
} from '../src/main/meta/tmdbProvider';

const log = { d: vi.fn(), i: vi.fn(), w: vi.fn(), e: vi.fn() };
let dir: string;
let store: MetaStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tmdb-opt-in-'));
  store = new MetaStore(new JsonStore(join(dir, 'meta.json')));
  setTmdbRuntime({ userKey: '', apiBase: '', imageBase: '' });
  __resetMemCacheForTest();
  vi.clearAllMocks();
});
afterEach(() => {
  setTmdbRuntime({ userKey: '', apiBase: '', imageBase: '' });
  __resetMemCacheForTest();
  rmSync(dir, { recursive: true, force: true });
});

describe('TMDB 仅用户配置后启用', () => {
  async function expectDisabled() {
    expect(tmdbCreds()).toBeNull();
    expect(await tmdbDiscover(log)).toEqual([]);
    expect(await tmdbGenres(log)).toEqual({ movie: [], tv: [] });
    expect(await tmdbGenrePage(log, 'movie', 1, 1)).toEqual({ items: [], page: 1, totalPages: 1 });
    expect(await tmdbSearchTitle(store, log, '电影')).toBeNull();
    expect(await tmdbExtras(store, log, '电影')).toBeNull();
    expect(await tmdbSuggest(log, '电影')).toEqual([]);
    expect(await tmdbImages(log, 'movie', 1)).toEqual({ backdrops: [], posters: [] });
  }

  it('默认与只配置镜像地址时均不发任何 TMDB 请求', async () => {
    await expectDisabled();
    setTmdbRuntime({ userKey: '  ', apiBase: 'https://mirror.test/3', imageBase: 'https://images.test/t/p' });
    await expectDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it('用户 v3 Key / v4 令牌生效，清空后立即停止请求且不回显旧缓存', async () => {
    vi.mocked(request).mockResolvedValue({ statusCode: 200, body: {
      arrayBuffer: async () => Buffer.from(JSON.stringify({ results: [{ id: 1, title: '电影', media_type: 'movie', release_date: '2026-01-01' }] })),
    } } as any);
    setTmdbRuntime({ userKey: ' fixture-key ', apiBase: 'https://mirror.test/3' });
    expect(tmdbCreds()).toEqual({ apiKey: 'fixture-key', bearer: '', viaUser: true });
    expect(await tmdbSuggest(log, '电影')).toHaveLength(1);
    expect(String(vi.mocked(request).mock.calls[0][0])).toContain('api_key=fixture-key');
    setTmdbRuntime({ userKey: 'eyJ.fixture-token' });
    expect(tmdbCreds()).toEqual({ apiKey: '', bearer: 'eyJ.fixture-token', viaUser: true });
    await tmdbSuggest(log, '电影');
    expect(vi.mocked(request).mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer eyJ.fixture-token' });
    vi.mocked(request).mockClear();
    setTmdbRuntime({ userKey: '' });
    await expectDisabled();
    expect(request).not.toHaveBeenCalled();
  });
});
