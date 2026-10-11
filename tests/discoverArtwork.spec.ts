import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { JsonStore } from '../src/main/store/JsonStore';

vi.mock('electron', () => ({ nativeImage: { createFromBuffer: (bytes: Buffer) => ({
  isEmpty: () => bytes[0] === 0,
  getSize: () => bytes[0] === 2 ? { width: 900, height: 1350 } : { width: 1920, height: 1080 },
}) } }));
vi.mock('undici', () => ({ Agent: class {}, request: vi.fn() }));
vi.mock('../src/main/net/proxy', () => ({ dispatchChain: (_url: string, agent: unknown) => [agent] }));
vi.mock('../src/main/meta/so360Provider', async () => {
  const actual = await vi.importActual<any>('../src/main/meta/so360Provider');
  return { ...actual, so360SearchBackdrops: vi.fn(), fetchSo360: vi.fn() };
});
import { request } from 'undici';
import { so360SearchBackdrops, fetchSo360 } from '../src/main/meta/so360Provider';
import { DiscoverArtwork } from '../src/main/meta/discoverArtwork';

const dirs: string[] = [];
const log = { d: vi.fn(), i: vi.fn(), w: vi.fn(), e: vi.fn() };
const candidate = { title: '狂飙 剧照', w: 1920, h: 1080, img: 'https://image.test/backdrop.jpg' };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-art-'));
  dirs.push(dir);
  const store = new JsonStore(join(dir, 'art.json'));
  return { dir, store, art: new DiscoverArtwork(store, dir, log) };
}
function response(first = 1, contentType = 'image/jpeg') {
  return { statusCode: 200, headers: { 'content-type': contentType }, body: {
    dump: vi.fn(async () => undefined), destroy: vi.fn(),
    async *[Symbol.asyncIterator]() { yield Buffer.alloc(2048, first); },
  } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(so360SearchBackdrops).mockResolvedValue([candidate]);
  vi.mocked(fetchSo360).mockResolvedValue([{ ...candidate, title: '狂飙 海报', w: 900, h: 1350 }]);
  vi.mocked(request).mockResolvedValue(response() as any);
});
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('发现页补图磁盘缓存与验证（模拟测试，不是线上网络验证）', () => {
  it('并发同片只搜一次，重启后用本地图，不重新访问图床', async () => {
    const { dir, store, art } = fixture();
    const [a, b] = await Promise.all([art.images('狂飙', 'tv'), art.images('狂飙', 'tv')]);
    expect(a.backdrops).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a.backdrops[0]).toContain('/file/discovery-images/');
    expect(so360SearchBackdrops).toHaveBeenCalledTimes(1);
    const restarted = new DiscoverArtwork(new JsonStore(store.filePath), dir, log);
    expect(await restarted.images('狂飙', 'tv')).toEqual(a);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('拒绝假图片、竖版图与 html，失败后退避，不固化坏图', async () => {
    const { art } = fixture();
    vi.mocked(request).mockResolvedValueOnce(response(0) as any);
    expect((await art.images('狂飙', 'tv')).backdrops).toEqual([]);
    await art.images('狂飙', 'tv');
    expect(request).toHaveBeenCalledTimes(1);
    vi.mocked(request).mockResolvedValueOnce(response(2) as any);
    expect((await art.images('狂飙第二季', 'tv')).backdrops).toEqual([]);
    vi.mocked(request).mockResolvedValueOnce(response(1, 'text/html') as any);
    expect((await art.images('狂飙第三季', 'tv')).backdrops).toEqual([]);
  });
  it('坏候选尝试下一个；海报禁止调用图片搜索', async () => {
    const { art } = fixture();
    vi.mocked(so360SearchBackdrops).mockResolvedValueOnce([candidate, { ...candidate, img: 'https://image.test/other.jpg' }]);
    vi.mocked(request).mockResolvedValueOnce(response(0) as any).mockResolvedValueOnce(response() as any);
    expect((await art.images('狂飙', 'tv')).backdrops).toHaveLength(1);
    const posters = await art.images('狂飙', 'tv', undefined, 'poster');
    expect(posters.posters).toHaveLength(0);
    expect(posters.backdrops).toEqual([]);
    expect(fetchSo360).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('缓存文件被清理后重搜；异常索引文件名不做删除', async () => {
    const { dir, store, art } = fixture();
    const first = await art.images('狂飙', 'tv');
    rmSync(join(dir, 'discovery-images', first.backdrops[0].split('/').pop()!));
    expect((await art.images('狂飙', 'tv')).backdrops).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    writeFileSync(join(dir, 'owned.txt'), 'do not remove');
    const entries = Array.from({ length: 100 }, (_, i) => ({ key: createHash('sha256').update(String(i)).digest('hex'), files: ['../owned.txt'] }));
    store.setObject('index', entries);
    await art.images('别的电影', 'movie');
    expect(store.getObject<any[]>('index', [])).toHaveLength(100);
    expect((await import('node:fs')).readFileSync(join(dir, 'owned.txt'), 'utf8')).toBe('do not remove');
  });
});
