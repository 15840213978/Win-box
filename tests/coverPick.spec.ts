import { describe, it, expect, vi } from 'vitest';
import { pickCover, resolveCover, type CoverResolver } from '../src/renderer/lib/coverPick';

function fixture(hasTmdb = false) {
  const resolver: CoverResolver = {
    hasTmdb,
    query: vi.fn(async provider => provider),
    validate: vi.fn(async () => true),
    relay: vi.fn(() => 'relay'),
  };
  return resolver;
}

describe('封面优先级与逐层失败回退', () => {
  it('已配置 TMDB 时优先用 TMDB，不查询豆瓣', async () => {
    const r = fixture(true);
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('tmdb');
    expect(r.query).toHaveBeenCalledExactlyOnceWith('tmdb');
    expect(r.validate).not.toHaveBeenCalledWith('source');
  });
  it('未配置时源封面可用，不发任何补图查询', async () => {
    const r = fixture();
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('source');
    expect(r.query).not.toHaveBeenCalled();
  });
  it('源图缺失才查豆瓣；豆瓣无图显示空占位', async () => {
    const r = fixture();
    expect(await resolveCover({ name: '影片' }, r)).toBe('douban');
    vi.mocked(r.query).mockResolvedValue('');
    expect(await resolveCover({ name: '影片' }, r)).toBe('');
    expect(r.query).toHaveBeenCalledWith('douban');
  });
  it('TMDB 查询异常或坏图后用源图，不跳过源图去豆瓣', async () => {
    const r = fixture(true);
    vi.mocked(r.query).mockRejectedValueOnce(Error('offline'));
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('source');
    vi.mocked(r.validate).mockImplementation(async url => url !== 'tmdb');
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('source');
    expect(r.query).not.toHaveBeenCalledWith('douban');
  });
  it('源图失败重试同图中继；中继失败再查豆瓣', async () => {
    const r = fixture();
    vi.mocked(r.validate).mockImplementation(async url => url !== 'source');
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('relay');
    expect(r.query).not.toHaveBeenCalled();
    vi.mocked(r.validate).mockImplementation(async url => url === 'douban');
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('douban');
  });
  it('所有图片均加载失败或没有片名时最终返回空串', async () => {
    const r = fixture(true);
    vi.mocked(r.validate).mockResolvedValue(false);
    expect(await resolveCover({ name: '影片', pic: 'source' }, r)).toBe('');
    expect(await resolveCover({ name: '' }, fixture())).toBe('');
  });
  it('同步选图也遵循 TMDB → 源图及中继 → 豆瓣 → 空占位', () => {
    expect(pickCover({ tmdb: 'tmdb', srcPic: 'source', douban: 'douban' })).toBe('tmdb');
    expect(pickCover({ srcPic: 'source', douban: 'douban' })).toBe('source');
    expect(pickCover({ srcPic: 'source', srcBad: true, relay: 'relay', douban: 'douban' })).toBe('relay');
    expect(pickCover({ srcBad: true, relay: 'relay', relayBad: true, douban: 'douban' })).toBe('douban');
    expect(pickCover({})).toBe('');
  });
});
