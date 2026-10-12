// src/renderer/pages/DiscoverPage.tsx — 发现页（★ 2026-09-24 起为**默认首页**，侧边栏第一个）
// 内容：
//   ① 推荐（豆瓣电影/剧集五分区；主进程持久缓存，过期后台更新）
//   ② 分类（国内标签推荐分页，与 TMDB 类型 ID 解耦）
// 交互：点任意影片 → 走 `#/search?agg=<片名>` 用「源」做一次全源搜索（没源时提示去导入）。
import { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import { openSearchWindow } from '../lib/searchWin';
import { useTheme } from '../lib/theme';
import HScrollRow from '../components/HScrollRow';
import { useCovers } from '../lib/useCovers';
import type { DiscoverItem, DiscoverSection, DiscoverGenre } from '../../shared/types';

/** 影片卡（推荐区与分类区共用）：点击 → 全源搜索该片名。
   *  playBadge ★ 2026-09-29：仅 Apple 皮肤渲染的「悬停播放徽标」—— 只在 Apple 下渲染元素，
   *  其余皮肤零痕迹（不依赖别处补 `display:none`）。
   *  dbPlay/dbYear ★ 2026-10-08（豆风）：海报墙卡 —— 悬停浮出圆形播放钮 + 左下角年份角标（豆瓣海报墙观感）。 */
function ItemCard({ it, poster, onError, onOpen, playBadge, dbPlay, dbYear }: { it: DiscoverItem; poster: string; onError: (url: string) => void; onOpen: () => void; playBadge?: boolean; dbPlay?: boolean; dbYear?: boolean }) {
  return (
    <div
      className="card-media"
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      aria-label={`${it.title}${it.year ? ` (${it.year})` : ''}，点击全源搜索`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      title={`${it.title}${it.year ? ` (${it.year})` : ''} · 点击全源搜索`}
    >
      <div className="card">
        <div style={{ position: 'relative' }}>
          {poster ? <img src={poster} loading="lazy" decoding="async" onError={e => onError(e.currentTarget.getAttribute('src') || '')} /> : <div className="no-cover">暂无封面</div>}
          {playBadge && (
            <span className="ap-card-play" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 16 16"><path d="M4.9 2.9v10.2l8-5.1-8-5.1Z" fill="currentColor" /></svg>
            </span>
          )}
          {dbPlay && (
            <span className="db-card-play" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5.1 3.1v9.8l7.6-4.9-7.6-4.9Z" fill="currentColor" /></svg>
            </span>
          )}
          {dbYear && it.year ? <span className="badge db-year-badge">{it.year}</span> : null}
        </div>
        <div className="meta">
          <div className="name" title={it.title}>{it.title}</div>
          {it.year && !dbYear ? <div className="remarks">{it.year}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  // 发现页直接展示分类与榜单；Netflix / Apple 保留横向内容行，豆风使用海报网格。
  const theme = useTheme();
  const nf = theme === 'netflix';
  const ap = theme === 'apple';
  const db = theme === 'douban';
  const [sections, setSections] = useState<DiscoverSection[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  // ---- 分类（TMDB 类型清单 + 按类型翻页）----
  /**
   * ★ 2026-09-24（用户定稿）：**父分类（电影/剧集）未被点击前，不展示子分类（类型标签）**。
   *   故初始为 null（未选），点击父分类后才拉出对应子分类。
   */
  const [media, setMedia] = useState<'movie' | 'tv' | null>(null);
  const [genres, setGenres] = useState<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>({ movie: [], tv: [] });
  const [gSel, setGSel] = useState<DiscoverGenre | null>(null);
  const [gPage, setGPage] = useState(1);
  const [gItems, setGItems] = useState<DiscoverItem[]>([]);
  const [gTotal, setGTotal] = useState(1);
  const [gLoading, setGLoading] = useState(false);
  const genreRequest = useRef(0);
  const [genreError, setGenreError] = useState('');
  /** ★ 2026-10-08（豆风）：海报墙当前分区（顶部 pill 切换 —— 替代「一行行横滑」的堆叠布局） */
  const [wallSec, setWallSec] = useState(0);
  const coverItem = (it: DiscoverItem) => ({ id: String(it.tmdbId), name: it.title, year: it.year ? String(it.year) : undefined, pic: it.poster });
  const covers = useCovers((gSel ? gItems : (db ? sections?.[wallSec]?.items || [] : sections?.flatMap(s => s.items) || [])).map(coverItem));

  const goSearch = (title: string): void => { void openSearchWindow(title).catch((e) => window.alert(String(e))); };

  /**
   * 拉榜单（走主进程 6h 缓存）。
   * ★ 2026-09-24：原「刷新」按钮随「发现」那排一起删除（用户定稿：整排冗余）→ 不再有强制刷新入口，
   *   缓存过期由主进程 TTL 负责；需要立刻重拉时重启应用即可（避免留一个没人用的 refresh 参数）。
   * ★ 2026-09-25（用户报「发现页经常加载不出来」）：TMDB 是跨境访问，偶发超时会让整页空。
   *   主进程侧已加「分区重试 + 上次成功结果兜底」；渲染层再补两道：
   *   ① 首次结果为空 → 1.2s 后**自动重试一次**（不自作多情地循环重试）；
   *   ② 仍然为空 → 错误提示里给「重试」按钮（用户可手动再拉）。
   */
  const load = (): void => {
    setLoading(true);
    setErr('');
    client
      .metaDiscover(false)
      .then((s) => {
        if (s.length) setSections(s);
        else setSections(previous => previous?.length ? previous : s);
        if (s.length === 0) setErr('榜单暂时获取失败，请稍后重试；如已配置 TMDB，请检查自己的凭据和网络');
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  /** 已自动重试过（避免「空 → 重试 → 空」无限循环） */
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (loading || sections === null || sections.length > 0 || autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    const t = setTimeout(() => load(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sections]);
  useEffect(() => {
    load();
    client.metaGenres().then(setGenres).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 选类型 → 取该类型第 page 页 */
  const loadGenre = (g: DiscoverGenre, page: number, mediaType: 'movie' | 'tv' | null = media): void => {
    if (!mediaType) return;
    const requestId = ++genreRequest.current;
    setGSel(g);
    setGPage(page);
    setGLoading(true);
    setGenreError('');
    setGItems([]);
    client
      .metaGenrePage(mediaType, g.id, page)
      .then((r) => { if (requestId === genreRequest.current) { setGItems(r.items); setGTotal(r.totalPages); if (!r.items.length) setGenreError('该分类暂时无法获取，请稍后重试'); } })
      .catch(() => { if (requestId === genreRequest.current) { setGenreError('分类请求失败，请稍后重试'); setGTotal(1); } })
      .finally(() => { if (requestId === genreRequest.current) setGLoading(false); });
  };
  /** 点击父分类：切换选中；再次点击已选中的父分类 = 取消（子分类随之隐藏，回到推荐） */
  const switchMedia = (m: 'movie' | 'tv'): void => {
    ++genreRequest.current;
    setGLoading(false);
    const next = media === m ? null : m;
    setMedia(next);
    setGSel(null);
    setGItems([]);
    setGTotal(1);
  };
  const backToRecommend = (): void => { ++genreRequest.current; setGLoading(false); setGSel(null); setGItems([]); };

  const genreList = media === 'movie' ? genres.movie : media === 'tv' ? genres.tv : [];
  const hasGenres = genres.movie.length > 0 || genres.tv.length > 0;
  return (
    <>
      <div className="content">
        {/* ★ 2026-09-24（用户定稿）：原来那排「发现 ……… 【刷新】」整排删除（标题与刷新按钮都属冗余）；
            ★ 2026-09-26（用户指令）：无源时的「还没有导入任何源 —— 去导入源」提示条也整条删除。 */}
        {/* ---- 分类条（父分类：电影/剧集；子分类：类型标签 —— 父分类未点击前不展示子分类）---- */}
        {/* ★ 2026-10-08（豆风）：改成豆瓣式「标签行」（左侧小标签 + 右侧胶囊 chips），与顶栏胶囊导航同一套观感 */}
        {hasGenres && db && (
          <div className="db-filters">
            <div className="db-filter-row">
              <span className="db-filter-label">分类</span>
              <span className={`tag ${media === 'movie' ? 'active' : ''}`} onClick={() => switchMedia('movie')}>电影</span>
              <span className={`tag ${media === 'tv' ? 'active' : ''}`} onClick={() => switchMedia('tv')}>剧集</span>
            </div>
            {media !== null && genreList.length > 0 && (
              <div className="db-filter-row">
                <span className="db-filter-label">类型</span>
                {genreList.map((g) => (
                  <span key={g.id} className={`tag ${gSel?.id === g.id ? 'active' : ''}`} onClick={() => loadGenre(g, 1)}>
                    {g.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {hasGenres && !db && (
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="muted">分类：</span>
            <span className={`tag ${media === 'movie' ? 'active' : ''}`} onClick={() => switchMedia('movie')}>电影</span>
            <span className={`tag ${media === 'tv' ? 'active' : ''}`} onClick={() => switchMedia('tv')}>剧集</span>
            {media !== null && <span style={{ width: 10 }} />}
            {media !== null &&
              genreList.map((g) => (
                <span key={g.id} className={`tag ${gSel?.id === g.id ? 'active' : ''}`} onClick={() => loadGenre(g, 1)}>
                  {g.name}
                </span>
              ))}
            {media === null && <span className="muted" style={{ fontSize: 12 }}>（选「电影 / 剧集」后显示类型）</span>}
          </div>
        )}
        {gSel ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>{media === 'tv' ? '剧集' : '电影'} · {gSel.name}</h3>
              <div style={{ flex: 1 }} />
              <button style={{ flex: '0 0 auto' }} onClick={backToRecommend}>返回推荐</button>
            </div>
            {gLoading && gItems.length === 0 ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
            ) : gItems.length === 0 ? (
              <div className="empty">{genreError || '该分类暂无数据'} <button onClick={() => loadGenre(gSel, gPage)}>重试</button></div>
            ) : (
              <>
                <div className="grid">
                  {gItems.map((it, i) => (
                    <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} dbPlay={db} dbYear={db} />
                  ))}
                </div>
                {gTotal > 1 && (
                  <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                    <button disabled={gPage <= 1 || gLoading} onClick={() => loadGenre(gSel, gPage - 1)}>上一页</button>
                    <span className="status">{gPage} / {gTotal}</span>
                    <button disabled={gPage >= gTotal || gLoading} onClick={() => loadGenre(gSel, gPage + 1)}>下一页</button>
                  </div>
                )}
              </>
            )}
          </>
        ) : loading && !sections ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : err && (!sections || sections.length === 0) ? (
          <div className="err">
            {err}
            <button
              style={{ marginLeft: 10 }}
              onClick={() => {
                autoRetriedRef.current = true; // 手动重试后不再触发自动重试
                load();
              }}
            >
              重试
            </button>
          </div>
        ) : (
          /* ★ 2026-10-08（豆风）：**海报墙** —— 分区 pill（豆瓣「热门电影/热播剧集」那排）切换，
             下面一屏海报网格（悬停浮出播放钮 + 左下角年份角标）；不再是一行行横向滚动。 */
          db ? (
            <div className="db-wall">
              <div className="db-wall-chips" key={`chips-${sections?.length || 0}`}>
                {(sections || []).map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    className={'db-wall-chip' + (i === wallSec ? ' active' : '')}
                    onClick={() => setWallSec(i)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              <div className="grid db-wall-grid" key={`wall-${wallSec}`}>
                {((sections || [])[Math.min(wallSec, Math.max(0, (sections || []).length - 1))]?.items || []).map((it, i) => (
                  <ItemCard key={`${it.title}-${i}`} it={it} poster={covers.picOf(coverItem(it))} onError={url => covers.onError(coverItem(it), url)} onOpen={() => goSearch(it.title)} dbPlay dbYear />
                ))}
              </div>
            </div>
          ) : (
            (sections || []).map((s) => (
              <div key={s.id} className={nf ? 'nf-row' : ap ? 'ap-row' : undefined} style={nf || ap ? undefined : { marginBottom: 22 }}>
                <h3 className={nf ? 'nf-row-title' : ap ? 'ap-row-title' : undefined} style={nf || ap ? undefined : { margin: '0 0 10px' }}>{s.title}</h3>
                {/* 横向滚动条：滚轮在行内 → 横向滚动（见 HScrollRow）；行外空白 → 页面上下滚动 */}
                <HScrollRow
                  className={nf ? 'nf-row-scroll' : ap ? 'ap-row-scroll' : undefined}
                  style={nf || ap ? undefined : { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}
                >
                  {s.items.map((it, i) => (
                    // ★ 2026-09-29：minWidth:0 —— 超长片名（.name 为 nowrap）会经 flex 项 min-width:auto
                    //   把固定宽度的项撑宽，封面随 2:3 一起变高，整行被拉高留白（Netflix 同因同修，见 netflix.css）。
                    <div key={`${it.title}-${i}`} style={nf ? undefined : { flex: ap ? '0 0 168px' : '0 0 132px', minWidth: 0 }}>
                      <ItemCard
                        it={it}
                        poster={covers.picOf(coverItem(it))}
                        onError={url => covers.onError(coverItem(it), url)}
                        playBadge={ap}
                        onOpen={() => goSearch(it.title)}
                      />
                    </div>
                  ))}
                </HScrollRow>
              </div>
            ))
          )
        )}
      </div>
    </>
  );
}
