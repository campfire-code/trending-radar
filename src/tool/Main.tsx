// 主界面：顶部是关键词、自动刷新、导出；下面按来源分卡片展示热榜，命中关键词的条目高亮，并在最上方汇总。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, FolderOpen, Loader2, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { defaultOutputDir, ensureDir, fs, openFolder, openLink, reveal, settingsStore } from '../kit/platform';
import {
  DEFAULT_PREFS, PREFS_KEY, SOURCES, clampInterval, collectHits, exportFileName, exportRows, fetchAll, fetchSource, fmtTime, matchKeywords,
  newHits, parseKeywords, readPrefs, sourceById, splitHighlight, toMarkdown, type Getter, type HitEntry, type HotItem, type Prefs, type SourceResult,
} from './core';
import { tauriGet } from './net';
import './tool.css';

const TOOL_NAME = '全网热点雷达';
const INTERVALS: [number, string][] = [[0, '不自动刷新'], [5, '每 5 分钟'], [10, '每 10 分钟'], [15, '每 15 分钟'], [30, '每 30 分钟'], [60, '每 1 小时']];

type Msg = { kind: 'ok' | 'err'; text: string; path?: string; dir?: string } | null;

function Title({ text, keywords }: { text: string; keywords: string[] }) {
  return <>{splitHighlight(text, keywords).map((p, i) => (p.hit ? <mark key={i} className="tr-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

function ItemRow({ item, rank, keywords, hit }: { item: HotItem; rank: number; keywords: string[]; hit: boolean }) {
  return (
    <li className={`tr-item${hit ? ' hit' : ''}`}>
      <span className={`tr-rank${rank <= 3 ? ' top' : ''}`}>{rank}</span>
      <button className="tr-title" title={item.desc ? `${item.title}\n\n${item.desc}` : item.title} onClick={() => openLink(item.url)}>
        <Title text={item.title} keywords={keywords} />
      </button>
      {item.heat && <span className="tr-heat k-num">{item.heat}</span>}
    </li>
  );
}

function SourceCard({ id, result, loading, keywords, onlyHits, onRetry }: { id: string; result?: SourceResult; loading: boolean; keywords: string[]; onlyHits: boolean; onRetry: () => void }) {
  const src = sourceById(id)!;
  const items = (result?.items ?? []).map((item, i) => ({ item, rank: i + 1, hit: matchKeywords(item.title, keywords).length > 0 }));
  const shown = onlyHits ? items.filter((x) => x.hit) : items;
  const hits = items.filter((x) => x.hit).length;
  return (
    <section className="tr-card k-panel" aria-label={src.name} aria-busy={loading}>
      <header className="tr-card-hd">
        <b className="k-ellipsis">{src.name}</b>
        <span className="tr-kind">{src.kind}</span>
        {hits > 0 && <span className="k-st run">{hits} 条命中</span>}
        <span className="b-sp" />
        {loading ? <Loader2 size={14} className="k-spin k-muted" aria-label="正在刷新" /> : result && <span className="k-muted k-num tr-time">{fmtTime(result.at).slice(11)}</span>}
        <button className="k-icon-btn" title={`打开${src.name}网页`} aria-label={`打开${src.name}网页`} onClick={() => openLink(src.home)}><ExternalLink size={14} /></button>
      </header>
      {result && !result.ok ? (
        <div className="tr-err">
          <span className="k-err-text">{result.error}</span>
          <button className="k-btn" disabled={loading} onClick={onRetry}><RotateCcw size={14} />重试</button>
        </div>
      ) : !result ? (
        <ol className="tr-list tr-skel" aria-hidden>{Array.from({ length: 6 }, (_, i) => <li key={i} className="tr-item"><span className="tr-rank">{i + 1}</span><i /></li>)}</ol>
      ) : shown.length ? (
        <ol className="tr-list">{shown.map((x) => <ItemRow key={x.item.id} item={x.item} rank={x.rank} keywords={keywords} hit={x.hit} />)}</ol>
      ) : (
        <p className="k-muted tr-none">{onlyHits ? '这里没有命中关键词的条目' : '暂无内容'}</p>
      )}
    </section>
  );
}

export function Main({ preview }: { preview?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [kwDraft, setKwDraft] = useState('');
  const [results, setResults] = useState<Record<string, SourceResult>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState<HitEntry[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [ready, setReady] = useState(false);
  const getRef = useRef<Getter>(tauriGet);
  const nowRef = useRef<() => number>(() => Date.now());
  const mapRef = useRef<(r: SourceResult) => SourceResult>((r) => r);
  const prevHits = useRef<HitEntry[] | null>(null);

  const keywords = useMemo(() => parseKeywords(prefs.keywords), [prefs.keywords]);
  const set = (p: Partial<Prefs>) => setPrefs((o) => ({ ...o, ...p }));

  // 读取上次的设置；预览页用录制的示例数据和固定时间
  useEffect(() => {
    (async () => {
      if (preview) {
        const s = await import('./sample');
        getRef.current = s.sampleGet;
        nowRef.current = () => s.SAMPLE_NOW;
        mapRef.current = s.sampleSanitize;
        setPrefs({ ...DEFAULT_PREFS, keywords: s.SAMPLE_KEYWORDS, interval: 15 });
        setKwDraft(s.SAMPLE_KEYWORDS);
      } else {
        try {
          const p = readPrefs(await (await settingsStore()).get(PREFS_KEY));
          setPrefs(p);
          setKwDraft(p.keywords);
        } catch { /* 首次打开：用默认值 */ }
      }
      setReady(true);
    })();
  }, [preview]);
  useEffect(() => {
    if (!ready || preview) return;
    (async () => { try { await (await settingsStore()).set(PREFS_KEY, prefs); } catch { /* 忽略 */ } })();
  }, [prefs, ready, preview]);

  const busy = loading.size > 0;
  const refresh = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setLoading((s) => new Set([...s, ...ids]));
    const now = nowRef.current();
    await fetchAll(ids, getRef.current, now, (raw) => {
      const r = mapRef.current(raw);
      setResults((o) => ({ ...o, [r.id]: r }));
      setLoading((s) => { const n = new Set(s); n.delete(r.id); return n; });
    });
    setLastAt(now);
  }, []);

  // 打开时刷新一次
  useEffect(() => { if (ready) refresh(prefs.enabled); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // 定时刷新（不小于 5 分钟）
  useEffect(() => {
    const min = clampInterval(prefs.interval);
    if (!ready || !min || preview) return;
    const id = setInterval(() => refresh(prefs.enabled), min * 60_000);
    return () => clearInterval(id);
  }, [ready, prefs.interval, prefs.enabled, refresh, preview]);

  const shownResults = useMemo(() => prefs.enabled.map((id) => results[id]).filter((r): r is SourceResult => !!r), [prefs.enabled, results]);
  const hits = useMemo(() => collectHits(shownResults, keywords), [shownResults, keywords]);

  // 每次刷新完成后算出新增的命中（第一次加载不算「新」）
  useEffect(() => {
    if (busy || lastAt == null) return;
    if (prevHits.current) setFresh(newHits(prevHits.current, hits));
    prevHits.current = hits;
  }, [busy, lastAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // 改了关键词就重新计基准
  useEffect(() => { prevHits.current = null; setFresh([]); }, [prefs.keywords]);

  const freshIds = new Set(fresh.map((h) => `${h.source}|${h.item.id}`));
  const okCount = shownResults.filter((r) => r.ok).length;

  const toggleSource = (id: string) => {
    const on = prefs.enabled.includes(id);
    if (on && prefs.enabled.length === 1) return;
    const enabled = on ? prefs.enabled.filter((x) => x !== id) : SOURCES.map((s) => s.id).filter((x) => x === id || prefs.enabled.includes(x));
    set({ enabled });
    if (!on && !results[id]) refresh([id]);
  };

  const applyKeywords = () => set({ keywords: kwDraft });

  async function doExport(kind: 'xlsx' | 'md') {
    setMsg(null);
    if (!shownResults.some((r) => r.items.length)) { setMsg({ kind: 'err', text: '还没有可以导出的内容，先刷新一下' }); return; }
    if (prefs.onlyHits && !hits.length) { setMsg({ kind: 'err', text: '已勾选「只看命中」，但当前没有命中关键词的条目' }); return; }
    try {
      const now = nowRef.current();
      const dir = await defaultOutputDir(TOOL_NAME);
      await ensureDir(dir);
      const path = await fs.join(dir, exportFileName(now, kind));
      if (kind === 'xlsx') {
        const { writeHotXlsx } = await import('./xlsx');
        await fs.writeFile(path, await writeHotXlsx(exportRows(shownResults, keywords, prefs.onlyHits)));
      } else {
        await fs.writeTextFile(path, toMarkdown(shownResults, keywords, prefs.onlyHits, now));
      }
      setMsg({ kind: 'ok', text: `已导出 ${path.split(/[\\/]/).pop()}`, path, dir });
    } catch (e) {
      setMsg({ kind: 'err', text: `导出失败：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return (
    <div className="tr">
      <div className="tr-bar">
        <label className="tr-kw">
          <Search size={15} className="k-muted" />
          <input
            className="k-input" value={kwDraft} aria-label="关键词"
            placeholder="订阅关键词，用空格或逗号分开，例如：AI 新能源 电商"
            onChange={(e) => setKwDraft(e.target.value)} onBlur={applyKeywords} onKeyDown={(e) => { if (e.key === 'Enter') applyKeywords(); }}
          />
          {kwDraft && <button className="k-icon-btn" aria-label="清空关键词" title="清空关键词" onClick={() => { setKwDraft(''); set({ keywords: '' }); }}><X size={14} /></button>}
        </label>
        <label className="k-toggle"><input type="checkbox" checked={prefs.onlyHits} onChange={(e) => set({ onlyHits: e.target.checked })} />只看命中</label>
        <select className="k-input tr-sel" aria-label="自动刷新" value={prefs.interval} onChange={(e) => set({ interval: clampInterval(Number(e.target.value)) })}>
          {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="k-btn primary" disabled={busy} onClick={() => refresh(prefs.enabled)}>
          {busy ? <Loader2 size={15} className="k-spin" /> : <RefreshCw size={15} />}{busy ? `刷新中 ${prefs.enabled.length - loading.size}/${prefs.enabled.length}` : '刷新'}
        </button>
        <button className="k-btn" onClick={() => doExport('xlsx')}><Download size={15} />导出 Excel</button>
        <button className="k-btn" onClick={() => doExport('md')}><FileText size={15} />导出 Markdown</button>
      </div>

      <section className="tr-hero" aria-label="概览">
        <div className="tr-big">
          <span className="tr-big-n k-num">{keywords.length ? hits.length : '—'}</span>
          <span className="tr-big-l">条命中{fresh.length > 0 && <b className="tr-new">新增 {fresh.length}</b>}</span>
        </div>
        <div className="tr-kwcount" role="list" aria-label="各关键词命中数">
          {keywords.length === 0 ? <p className="k-muted">在上方输入订阅关键词，命中的热点会汇总在这里</p> : keywords.map((k) => {
            const n = hits.filter((h) => h.keywords.includes(k)).length;
            return (
              <div key={k} role="listitem" className="tr-kwrow">
                <b className="tr-kwname">{k}</b>
                <span className="tr-kwbar"><i style={{ width: `${hits.length ? Math.max(4, (n / hits.length) * 100) : 0}%` }} /></span>
                <span className="k-num tr-kwn">{n}</span>
              </div>
            );
          })}
        </div>
        <div className="tr-meta k-muted" role="status">
          {lastAt ? <>更新于 {fmtTime(lastAt).slice(11)}<br />{prefs.enabled.length} 个来源，成功 {okCount} 个{prefs.interval > 0 && <><br />每 {prefs.interval} 分钟自动刷新</>}</> : '正在加载…'}
        </div>
      </section>

      {msg && (
        <div className={`k-notice ${msg.kind}`} role="alert">
          <span>{msg.text}</span>
          {msg.path && <button className="k-btn" onClick={() => reveal(msg.path!)}><FolderOpen size={14} />在文件夹中显示</button>}
          {msg.dir && !msg.path && <button className="k-btn" onClick={() => openFolder(msg.dir!)}><FolderOpen size={14} />打开文件夹</button>}
          <button className="k-icon-btn" aria-label="关闭提示" onClick={() => setMsg(null)}><X size={14} /></button>
        </div>
      )}

      <div className="tr-cols">
        <section className="tr-hits k-panel" aria-label="命中关键词">
          <header className="tr-card-hd"><b>命中汇总</b><span className="k-muted k-ellipsis">{keywords.length ? keywords.join('、') : '还没有订阅关键词'}</span></header>
          {hits.length > 0 ? (
            <ul className="tr-list">
              {hits.slice(0, 30).map((h) => (
                <li key={`${h.source}|${h.item.id}`} className="tr-item hit">
                  <span className="tr-src">{sourceById(h.source)?.name}</span>
                  <button className="tr-title" title={h.item.title} onClick={() => openLink(h.item.url)}><Title text={h.item.title} keywords={keywords} /></button>
                  {freshIds.has(`${h.source}|${h.item.id}`) && <span className="k-st ok">新</span>}
                  {h.item.heat && <span className="tr-heat k-num">{h.item.heat}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="k-muted tr-none">{keywords.length ? '当前没有命中关键词的热点' : '输入关键词后，这里按热度汇总各平台的命中热点'}</p>}
        </section>
        <nav className="tr-rail k-panel" aria-label="来源">
          <header className="tr-card-hd"><b>来源</b><span className="k-muted">点击显示或隐藏</span></header>
          {SOURCES.map((s) => {
            const on = prefs.enabled.includes(s.id);
            const r = results[s.id];
            const n = r ? r.items.filter((it) => matchKeywords(it.title, keywords).length > 0).length : 0;
            return (
              <button key={s.id} className={`tr-src-btn${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleSource(s.id)} title={on ? '点击隐藏这个来源' : '点击显示这个来源'}>
                <span className="tr-sw" aria-hidden />
                <span className="k-ellipsis">{s.name}</span>
                <span className="tr-kind">{s.kind}</span>
                <span className="b-sp" />
                {on && r && !r.ok && <span className="tr-dot" aria-label="抓取失败" />}
                {on && n > 0 && <span className="tr-hitn k-num">{n}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="tr-grid">
        {prefs.enabled.map((id) => (
          <SourceCard key={id} id={id} result={results[id]} loading={loading.has(id)} keywords={keywords} onlyHits={prefs.onlyHits && keywords.length > 0}
            onRetry={async () => {
              setLoading((s) => new Set([...s, id]));
              const r = await fetchSource(sourceById(id)!, getRef.current, nowRef.current());
              setResults((o) => ({ ...o, [id]: r }));
              setLoading((s) => { const n = new Set(s); n.delete(id); return n; });
            }} />
        ))}
      </div>
    </div>
  );
}
