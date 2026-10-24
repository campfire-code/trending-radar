// 纯函数：不依赖界面和本机能力，便于单元测试。
// 各热榜的请求地址与解析规则移植自 newsnext/newsnow（MIT）的 server/sources，HTML 解析改用浏览器自带的 DOMParser。

export interface HotItem {
  id: string;
  title: string;
  url: string;
  /** 显示用的热度文字，例如「2427 万热度」 */
  heat?: string;
  /** 补充说明（摘要、标签），悬停显示 */
  desc?: string;
  /** 发布时间（毫秒） */
  time?: number;
}

export interface FetchedText {
  text: string;
  /** 响应里的 Set-Cookie（抖音需要先拿访客 cookie） */
  setCookie: string[];
}
/** 发请求的函数由外面传入：桌面端用 Tauri HTTP 插件，测试里用录制的样例响应 */
export type Getter = (url: string, headers?: Record<string, string>) => Promise<FetchedText>;

export interface SourceDef {
  id: string;
  name: string;
  /** 分类，用于界面分组 */
  kind: '综合' | '科技' | '财经';
  home: string;
  fetch: (get: Getter, now: number) => Promise<HotItem[]>;
}

// ---------- 小工具 ----------

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

/** 12345678 → 1234.6万；1.2亿 */
export function formatHeat(n: number | string | undefined | null): string {
  const v = typeof n === 'string' ? Number(n.replace(/[,\s]/g, '')) : n;
  if (v == null || !Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e8) return `${trim1(v / 1e8)}亿`;
  if (v >= 1e4) return `${trim1(v / 1e4)}万`;
  return String(Math.round(v));
}
const trim1 = (x: number) => (Math.round(x * 10) / 10).toString();

/** 去重：同一来源里同一个 id 只留第一条，标题为空的丢掉 */
export function dedupe(items: HotItem[]): HotItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.title || seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

function parseJson<T>(text: string, source: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${source}返回的不是有效数据，可能被限制访问`);
  }
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function abs(href: string, base: string) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return 'https:' + href;
  return base.replace(/\/+$/, '') + (href.startsWith('/') ? '' : '/') + href;
}

// ---------- 各来源解析 ----------

export function parseWeibo(html: string): HotItem[] {
  const doc = parseHtml(html);
  const rows = Array.from(doc.querySelectorAll('#pl_top_realtimehot table tbody tr'));
  const out: HotItem[] = [];
  for (const row of rows) {
    // 第一行是置顶（没有排名数字），newsnow 同样跳过
    const rank = str(row.querySelector('td.td-01')?.textContent);
    if (!/^\d+$/.test(rank)) continue;
    const a = Array.from(row.querySelectorAll('td.td-02 a')).find((el) => {
      const h = el.getAttribute('href');
      return h && !h.includes('javascript:void(0);');
    });
    if (!a) continue;
    const title = str(a.textContent);
    const href = a.getAttribute('href')!;
    const num = str(row.querySelector('td.td-02 span')?.textContent).match(/(\d+)\s*$/)?.[1];
    const flag = str(row.querySelector('td.td-03')?.textContent);
    out.push({ id: title, title, url: abs(href, 'https://s.weibo.com'), heat: [formatHeat(num), flag].filter(Boolean).join(' · ') || undefined });
  }
  return dedupe(out);
}

interface ZhihuRes { data: { target: { title_area: { text: string }; excerpt_area?: { text: string }; metrics_area?: { text: string }; link: { url: string } } }[] }
export function parseZhihu(text: string): HotItem[] {
  const res = parseJson<ZhihuRes>(text, '知乎');
  return dedupe((res.data ?? []).map(({ target: t }) => ({
    id: t.link.url.match(/(\d+)$/)?.[1] ?? t.link.url,
    title: str(t.title_area?.text),
    url: t.link.url,
    heat: str(t.metrics_area?.text) || undefined,
    desc: str(t.excerpt_area?.text) || undefined,
  })));
}

interface BaiduRes { data: { cards: { content: { isTop?: boolean; word: string; rawUrl: string; url?: string; desc?: string; hotScore?: string }[] }[] } }
export function parseBaidu(html: string): HotItem[] {
  const m = html.match(/<!--s-data:(.*?)-->/s);
  if (!m) throw new Error('百度热搜页面结构变了，没找到数据');
  const res = parseJson<BaiduRes>(m[1], '百度');
  return dedupe((res.data.cards[0]?.content ?? []).filter((k) => !k.isTop).map((k) => ({
    id: k.rawUrl,
    title: str(k.word),
    url: k.rawUrl || k.url || '',
    heat: formatHeat(k.hotScore) || undefined,
    desc: str(k.desc) || undefined,
  })));
}

interface BiliRes { list: { keyword: string; show_name: string; heat_score?: number }[] }
export function parseBilibili(text: string): HotItem[] {
  const res = parseJson<BiliRes>(text, 'B 站');
  return dedupe((res.list ?? []).map((k) => ({
    id: k.keyword,
    title: str(k.show_name || k.keyword),
    url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(k.keyword)}`,
    heat: formatHeat(k.heat_score) || undefined,
  })));
}

interface DouyinRes { data?: { word_list?: { sentence_id: string; word: string; hot_value?: number; event_time?: number }[] } }
export function parseDouyin(text: string): HotItem[] {
  const res = parseJson<DouyinRes>(text, '抖音');
  const list = res.data?.word_list;
  if (!list) throw new Error('抖音没有返回热榜，可能需要稍后再试');
  return dedupe(list.map((k) => ({
    id: String(k.sentence_id),
    title: str(k.word),
    url: `https://www.douyin.com/hot/${k.sentence_id}`,
    heat: formatHeat(k.hot_value) || undefined,
    time: k.event_time ? k.event_time * 1000 : undefined,
  })));
}

interface ToutiaoRes { data: { ClusterIdStr: string; Title: string; HotValue?: string }[] }
export function parseToutiao(text: string): HotItem[] {
  const res = parseJson<ToutiaoRes>(text, '今日头条');
  return dedupe((res.data ?? []).map((k) => ({
    id: k.ClusterIdStr,
    title: str(k.Title),
    url: `https://www.toutiao.com/trending/${k.ClusterIdStr}/`,
    heat: formatHeat(k.HotValue) || undefined,
  })));
}

/** 「3分钟前」「2小时前」「昨天 12:30」等相对时间 → 毫秒；认不出返回 undefined */
export function parseRelative(s: string, now: number): number | undefined {
  const t = s.trim();
  let m: RegExpMatchArray | null;
  if (/^刚刚/.test(t)) return now;
  if ((m = t.match(/^(\d+)\s*秒前/))) return now - +m[1] * 1000;
  if ((m = t.match(/^(\d+)\s*分钟前/))) return now - +m[1] * 60_000;
  if ((m = t.match(/^(\d+)\s*小时前/))) return now - +m[1] * 3_600_000;
  if ((m = t.match(/^(\d+)\s*天前/))) return now - +m[1] * 86_400_000;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
    // 网站给的是北京时间
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] ?? 0));
  }
  return undefined;
}

export function parse36kr(html: string, now: number): HotItem[] {
  const doc = parseHtml(html);
  const out: HotItem[] = [];
  for (const el of Array.from(doc.querySelectorAll('.newsflash-item'))) {
    const a = el.querySelector('a.item-title');
    const href = a?.getAttribute('href');
    const title = str(a?.textContent);
    if (!href || !title) continue;
    const rel = str(el.querySelector('.time')?.textContent);
    out.push({ id: href, title, url: abs(href, 'https://www.36kr.com'), time: parseRelative(rel, now), heat: rel || undefined });
  }
  return dedupe(out);
}

export function parseIthome(html: string, now: number): HotItem[] {
  const doc = parseHtml(html);
  const out: HotItem[] = [];
  for (const li of Array.from(doc.querySelectorAll('#list > div.fl > ul > li'))) {
    const a = li.querySelector('a.t');
    const href = a?.getAttribute('href');
    const title = str(a?.textContent);
    const date = str(li.querySelector('i')?.textContent);
    if (!href || !title) continue;
    // newsnow 的广告过滤规则
    if (href.includes('lapin') || ['神券', '优惠', '补贴', '京东'].some((k) => title.includes(k))) continue;
    const time = parseRelative(date, now);
    out.push({ id: href, title, url: abs(href, 'https://www.ithome.com'), time, heat: date ? date.slice(11, 16) || date : undefined });
  }
  return dedupe(out).sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

interface SspaiRes { data: { id: number; title: string; like_count?: number; comment_count?: number }[] }
export function parseSspai(text: string): HotItem[] {
  const res = parseJson<SspaiRes>(text, '少数派');
  return dedupe((res.data ?? []).map((k) => ({
    id: String(k.id),
    title: str(k.title),
    url: `https://sspai.com/post/${k.id}`,
    heat: k.like_count ? `${k.like_count} 赞` : undefined,
  })));
}

interface WscnRes { data: { items: { id: number; title?: string; content_text: string; display_time: number; uri: string }[] } }
export function parseWallstreetcn(text: string): HotItem[] {
  const res = parseJson<WscnRes>(text, '华尔街见闻');
  return dedupe((res.data?.items ?? []).map((k) => ({
    id: String(k.id),
    title: str(k.title || k.content_text),
    url: k.uri,
    time: k.display_time * 1000,
  })));
}

interface ClsRes { errno?: number | string; msg?: string; data?: { roll_data: { id: number; title?: string; brief: string; ctime: number; is_ad?: number; reading_num?: number }[] } }
export function parseCls(text: string): HotItem[] {
  const res = parseJson<ClsRes>(text, '财联社');
  if (!res.data) throw new Error(`财联社拒绝了请求：${res.msg || res.errno}`);
  return dedupe(res.data.roll_data.filter((k) => !k.is_ad).map((k) => ({
    id: String(k.id),
    title: str(k.title || k.brief),
    url: `https://www.cls.cn/detail/${k.id}`,
    time: k.ctime * 1000,
    heat: k.reading_num ? `${formatHeat(k.reading_num)} 阅读` : undefined,
  })));
}

interface PaperRes { data: { hotNews: { contId: string; name: string; interactionNum?: string; pubTimeLong?: number }[] } }
export function parseThepaper(text: string): HotItem[] {
  const res = parseJson<PaperRes>(text, '澎湃新闻');
  return dedupe((res.data?.hotNews ?? []).map((k) => ({
    id: k.contId,
    title: str(k.name),
    url: `https://www.thepaper.cn/newsDetail_forward_${k.contId}`,
    heat: Number(k.interactionNum) > 0 ? `${formatHeat(k.interactionNum)} 互动` : undefined,
    time: k.pubTimeLong ? Number(k.pubTimeLong) : undefined,
  })));
}

interface TiebaRes { data: { bang_topic: { topic_list: { topic_id: number; topic_name: string; topic_desc?: string; topic_url: string; discuss_num?: number }[] } } }
export function parseTieba(text: string): HotItem[] {
  const res = parseJson<TiebaRes>(text, '百度贴吧');
  return dedupe((res.data?.bang_topic?.topic_list ?? []).map((k) => ({
    id: String(k.topic_id),
    title: str(k.topic_name),
    url: k.topic_url.replace(/&amp;/g, '&'),
    heat: k.discuss_num ? `${formatHeat(k.discuss_num)} 讨论` : undefined,
    desc: str(k.topic_desc) || undefined,
  })));
}

interface JuejinRes { data: { content: { content_id: string; title: string }; content_counter?: { hot_rank?: number; view?: number } }[] }
export function parseJuejin(text: string): HotItem[] {
  const res = parseJson<JuejinRes>(text, '稀土掘金');
  return dedupe((res.data ?? []).map((k) => ({
    id: k.content.content_id,
    title: str(k.content.title),
    url: `https://juejin.cn/post/${k.content.content_id}`,
    heat: k.content_counter?.view ? `${formatHeat(k.content_counter.view)} 阅读` : undefined,
  })));
}

// ---------- 财联社签名（移植自 newsnow 的 cls/utils.ts，原出自 RSSHub） ----------

/** MD5 十六进制摘要（WebCrypto 不提供 MD5，这里自己实现） */
export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[words.length - 2] = (len * 8) >>> 0;
  words[words.length - 1] = Math.floor(len / 0x20000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const x = (a + f + K[i] + words[off + g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

export async function sha1Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 财联社接口参数：排序后先 SHA-1 再 MD5 作为 sign */
export async function clsQuery(more: Record<string, string | number>): Promise<string> {
  const p = new URLSearchParams({ appName: 'CailianpressWeb', os: 'web', sv: '7.7.5', ...Object.fromEntries(Object.entries(more).map(([k, v]) => [k, String(v)])) });
  p.sort();
  p.append('sign', md5(await sha1Hex(p.toString())));
  return p.toString();
}

/** 把 Set-Cookie 列表拼成请求用的 Cookie 头（只取名=值） */
export function cookieHeader(setCookie: string[]): string {
  return setCookie.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

// ---------- 来源清单 ----------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const BASE_HEADERS: Record<string, string> = { 'User-Agent': UA };
/** 微博热搜页要带访客 cookie 才不跳登录，取自 newsnow（原出自 v5tech/weibo-trending-hot-search），不是任何人的账号 */
const WEIBO_VISITOR = 'SUB=_2AkMWIuNSf8NxqwJRmP8dy2rhaoV2ygrEieKgfhKJJRMxHRl-yT9jqk86tRB6PaLNvQZR6zYUcYVT1zSjoSreQHidcUq7';

export const SOURCES: SourceDef[] = [
  { id: 'weibo', name: '微博热搜', kind: '综合', home: 'https://s.weibo.com/top/summary?cate=realtimehot', fetch: async (get) => {
    const url = 'https://s.weibo.com/top/summary?cate=realtimehot';
    return parseWeibo((await get(url, { Cookie: WEIBO_VISITOR, Referer: url })).text);
  } },
  { id: 'zhihu', name: '知乎热榜', kind: '综合', home: 'https://www.zhihu.com/hot', fetch: async (get) => parseZhihu((await get('https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true')).text) },
  { id: 'baidu', name: '百度热搜', kind: '综合', home: 'https://top.baidu.com/board?tab=realtime', fetch: async (get) => parseBaidu((await get('https://top.baidu.com/board?tab=realtime')).text) },
  { id: 'douyin', name: '抖音热榜', kind: '综合', home: 'https://www.douyin.com/hot', fetch: async (get) => {
    // 先访问登录页拿访客 cookie，否则热榜接口返回空
    const { setCookie } = await get('https://login.douyin.com/');
    const url = 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1';
    return parseDouyin((await get(url, setCookie.length ? { Cookie: cookieHeader(setCookie) } : {})).text);
  } },
  { id: 'bilibili', name: 'B 站热搜', kind: '综合', home: 'https://search.bilibili.com/', fetch: async (get) => parseBilibili((await get('https://s.search.bilibili.com/main/hotword?limit=30')).text) },
  { id: 'toutiao', name: '今日头条', kind: '综合', home: 'https://www.toutiao.com/', fetch: async (get) => parseToutiao((await get('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc')).text) },
  { id: 'thepaper', name: '澎湃热榜', kind: '综合', home: 'https://www.thepaper.cn/', fetch: async (get) => parseThepaper((await get('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar')).text) },
  { id: 'tieba', name: '贴吧热议', kind: '综合', home: 'https://tieba.baidu.com/hottopic/browse/topicList', fetch: async (get) => parseTieba((await get('https://tieba.baidu.com/hottopic/browse/topicList')).text) },
  { id: '36kr', name: '36 氪快讯', kind: '科技', home: 'https://www.36kr.com/newsflashes', fetch: async (get, now) => parse36kr((await get('https://www.36kr.com/newsflashes')).text, now) },
  // check-zh: 忽略（站点官方名称「IT 之家」）
  { id: 'ithome', name: 'IT 之家', kind: '科技', home: 'https://www.ithome.com/', fetch: async (get, now) => parseIthome((await get('https://www.ithome.com/list/')).text, now) },
  { id: 'sspai', name: '少数派', kind: '科技', home: 'https://sspai.com/', fetch: async (get, now) => parseSspai((await get(`https://sspai.com/api/v1/article/tag/page/get?limit=30&offset=0&created_at=${now}&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0&released=false`)).text) },
  { id: 'juejin', name: '稀土掘金', kind: '科技', home: 'https://juejin.cn/hot/articles', fetch: async (get) => parseJuejin((await get('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0')).text) },
  { id: 'wallstreetcn', name: '华尔街见闻', kind: '财经', home: 'https://wallstreetcn.com/live/global', fetch: async (get) => parseWallstreetcn((await get('https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30')).text) },
  { id: 'cls', name: '财联社电报', kind: '财经', home: 'https://www.cls.cn/telegraph', fetch: async (get, now) => {
    const q = await clsQuery({ last_time: Math.floor(now / 1000), refresh_type: 1, rn: 30 });
    return parseCls((await get(`https://www.cls.cn/v1/roll/get_roll_list?${q}`, { Referer: 'https://www.cls.cn/telegraph' })).text);
  } },
];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);

// ---------- 抓取（每个来源单独容错） ----------

export interface SourceResult {
  id: string;
  ok: boolean;
  items: HotItem[];
  error?: string;
  /** 抓取完成时间（毫秒） */
  at: number;
}

/** 把网络层的报错翻成一句人话 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/HTTP 4\d\d/.test(msg)) return `网站拒绝了请求（${msg.match(/HTTP \d+/)![0]}），可能是访问太频繁或接口变了`;
  if (/HTTP 5\d\d/.test(msg)) return `网站暂时出错（${msg.match(/HTTP \d+/)![0]}），稍后再试`;
  if (/timed? ?out|超时/i.test(msg)) return '请求超时，检查网络后重试';
  if (/network|dns|connect|error sending request|failed to fetch/i.test(msg)) return '连不上该网站，检查网络或代理设置';
  return msg.slice(0, 120);
}

export async function fetchSource(src: SourceDef, get: Getter, now: number): Promise<SourceResult> {
  try {
    const items = await src.fetch(get, now);
    if (!items.length) return { id: src.id, ok: false, items: [], error: '没有解析到内容，网站结构可能变了', at: now };
    return { id: src.id, ok: true, items: items.slice(0, 50), at: now };
  } catch (e) {
    return { id: src.id, ok: false, items: [], error: friendlyError(e), at: now };
  }
}

/** 并发抓取，任何一个失败都不影响其他；onEach 每完成一个回调一次 */
export async function fetchAll(ids: string[], get: Getter, now: number, onEach?: (r: SourceResult) => void): Promise<SourceResult[]> {
  const list = ids.map(sourceById).filter((s): s is SourceDef => !!s);
  return Promise.all(list.map(async (s) => {
    const r = await fetchSource(s, get, now);
    onEach?.(r);
    return r;
  }));
}

// ---------- 关键词 ----------

/** 「AI，新能源 华为」→ ['AI','新能源','华为']：逗号、顿号、空格、换行都能分隔，去重 */
export function parseKeywords(text: string): string[] {
  return Array.from(new Set(text.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean)));
}

/** 标题命中了哪些关键词（不区分大小写） */
export function matchKeywords(title: string, keywords: string[]): string[] {
  const t = title.toLowerCase();
  return keywords.filter((k) => t.includes(k.toLowerCase()));
}

/** 把标题切成普通段和命中段，界面据此高亮 */
export function splitHighlight(title: string, keywords: string[]): { text: string; hit: boolean }[] {
  const ks = keywords.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!ks.length) return [{ text: title, hit: false }];
  const esc = ks.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  return title.split(re).filter((s) => s !== '').map((s) => ({ text: s, hit: ks.some((k) => k.toLowerCase() === s.toLowerCase()) }));
}

export interface HitEntry { source: string; rank: number; item: HotItem; keywords: string[] }

/** 汇总所有来源里命中关键词的条目 */
export function collectHits(results: SourceResult[], keywords: string[]): HitEntry[] {
  if (!keywords.length) return [];
  const out: HitEntry[] = [];
  for (const r of results) {
    r.items.forEach((item, i) => {
      const k = matchKeywords(item.title, keywords);
      if (k.length) out.push({ source: r.id, rank: i + 1, item, keywords: k });
    });
  }
  return out;
}

/** 本次刷新相比上次新出现的命中（按来源 + id 判断） */
export function newHits(prev: HitEntry[], next: HitEntry[]): HitEntry[] {
  const seen = new Set(prev.map((h) => `${h.source}|${h.item.id}`));
  return next.filter((h) => !seen.has(`${h.source}|${h.item.id}`));
}

// ---------- 定时刷新 ----------

export const MIN_INTERVAL = 5;
/** 定时刷新间隔（分钟）：0 表示关闭，其余不小于 5 分钟，避免频繁请求 */
export function clampInterval(min: number): number {
  if (!Number.isFinite(min) || min <= 0) return 0;
  return Math.max(MIN_INTERVAL, Math.min(240, Math.round(min)));
}

// ---------- 导出 ----------

export interface ExportRow { 来源: string; 排名: number; 标题: string; 热度: string; 链接: string; 命中关键词: string; 抓取时间: string }

export function fmtTime(ms: number): string {
  // 固定按北京时间显示，导出文件在不同电脑上一致
  const d = new Date(ms + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** onlyHits 为 true 时只导出命中关键词的条目 */
export function exportRows(results: SourceResult[], keywords: string[], onlyHits: boolean): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const r of results) {
    const name = sourceById(r.id)?.name ?? r.id;
    r.items.forEach((item, i) => {
      const k = matchKeywords(item.title, keywords);
      if (onlyHits && !k.length) return;
      rows.push({ 来源: name, 排名: i + 1, 标题: item.title, 热度: item.heat ?? '', 链接: item.url, 命中关键词: k.join('、'), 抓取时间: fmtTime(r.at) });
    });
  }
  return rows;
}

const mdEscape = (s: string) => s.replace(/([\\[\]|*_`])/g, '\\$1');

export function toMarkdown(results: SourceResult[], keywords: string[], onlyHits: boolean, now: number): string {
  const lines = [`# 全网热点 · ${fmtTime(now)}`, ''];
  if (keywords.length) lines.push(`关键词：${keywords.join('、')}${onlyHits ? '（只列出命中的条目）' : ''}`, '');
  for (const r of results) {
    const name = sourceById(r.id)?.name ?? r.id;
    const items = r.items.map((item, i) => ({ item, i, k: matchKeywords(item.title, keywords) })).filter((x) => !onlyHits || x.k.length);
    if (!r.ok) { lines.push(`## ${name}`, '', `> 抓取失败：${r.error}`, ''); continue; }
    if (!items.length) continue;
    lines.push(`## ${name}`, '');
    for (const { item, i, k } of items) {
      const title = k.length ? `**${mdEscape(item.title)}**` : mdEscape(item.title);
      lines.push(`${i + 1}. [${title}](${item.url})${item.heat ? ` · ${item.heat}` : ''}${k.length ? ` 〔${k.join('、')}〕` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function exportFileName(now: number, ext: string): string {
  return `热点-${fmtTime(now).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2')}.${ext}`;
}

// ---------- 偏好 ----------

export interface Prefs {
  keywords: string;
  onlyHits: boolean;
  /** 自动刷新间隔（分钟），0 关闭 */
  interval: number;
  /** 启用的来源 */
  enabled: string[];
}
export const PREFS_KEY = 'c19.prefs';
export const DEFAULT_PREFS: Prefs = { keywords: '', onlyHits: false, interval: 0, enabled: SOURCES.map((s) => s.id) };

export function readPrefs(raw: unknown): Prefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = Array.isArray(o.enabled) ? o.enabled.filter((x): x is string => typeof x === 'string' && !!sourceById(x)) : DEFAULT_PREFS.enabled;
  return {
    keywords: typeof o.keywords === 'string' ? o.keywords : '',
    onlyHits: o.onlyHits === true,
    interval: clampInterval(Number(o.interval)),
    enabled: enabled.length ? enabled : DEFAULT_PREFS.enabled,
  };
}
