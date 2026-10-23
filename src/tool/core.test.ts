// @vitest-environment jsdom
// 用 2026-10-23 录制的真实响应（已裁剪）测试各来源的解析；不访问网络。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SOURCES, clampInterval, clsQuery, collectHits, cookieHeader, exportFileName, exportRows, fetchAll, formatHeat, matchKeywords, md5, newHits,
  parse36kr, parseBaidu, parseBilibili, parseCls, parseDouyin, parseIthome, parseJuejin, parseKeywords, parseRelative, parseSspai, parseThepaper,
  parseTieba, parseToutiao, parseWallstreetcn, parseWeibo, parseZhihu, readPrefs, splitHighlight, toMarkdown, type Getter, type SourceResult,
} from './core';

const fx = (name: string) => readFileSync(join(process.cwd(), 'src/tool/fixtures', name), 'utf8');
const NOW = Date.UTC(2026, 9, 23, 9, 30); // 北京时间 17:30

describe('各来源解析', () => {
  it('微博：跳过置顶行，取标题、链接和热度', () => {
    const items = parseWeibo(fx('weibo.html'));
    expect(items.length).toBe(5);
    expect(items[0]).toMatchObject({ title: '小城良方 剧情硬伤', heat: '153.8万 · 新' });
    expect(items[0].url).toMatch(/^https:\/\/s\.weibo\.com\/weibo\?q=/);
    expect(items.map((i) => i.title)).not.toContain('中共中央政治局召开会议');
  });
  it('知乎：热度文字与摘要', () => {
    const items = parseZhihu(fx('zhihu.json'));
    expect(items.length).toBe(6);
    expect(items[0].title).toContain('黄海');
    expect(items[0].heat).toBe('2427 万热度');
    expect(items[0].url).toMatch(/^https:\/\/www\.zhihu\.com\/question\/\d+$/);
    expect(items[0].id).toMatch(/^\d+$/);
  });
  it('百度：从页面注释里的 s-data 取数据，去掉置顶', () => {
    const items = parseBaidu(fx('baidu.html'));
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items[0].title).toBeTruthy();
    expect(items.find((i) => i.title.includes('李雪健'))?.heat).toBe('780.8万');
    expect(() => parseBaidu('<html></html>')).toThrow('结构变了');
  });
  it('B 站热搜：搜索链接与热度', () => {
    const items = parseBilibili(fx('bilibili.json'));
    expect(items[0]).toMatchObject({ title: '西藏地震已致16死76伤', heat: '434.7万' });
    expect(items[0].url).toBe('https://search.bilibili.com/all?keyword=' + encodeURIComponent('西藏地震已致16死76伤'));
  });
  it('抖音：热榜链接；没有拿到 cookie 时接口返回空串要报错', () => {
    const items = parseDouyin(fx('douyin.json'));
    expect(items[0]).toMatchObject({ id: '2709032', url: 'https://www.douyin.com/hot/2709032', heat: '1176.5万' });
    expect(() => parseDouyin('')).toThrow('不是有效数据');
    expect(() => parseDouyin('{}')).toThrow('稍后再试');
  });
  it('今日头条', () => {
    const items = parseToutiao(fx('toutiao.json'));
    expect(items[0]).toMatchObject({ title: '西藏地震地面裂缝比手宽', url: 'https://www.toutiao.com/trending/7699707790348045850/', heat: '3294.2万' });
  });
  it('36 氪快讯：相对链接补全、相对时间换算', () => {
    const items = parse36kr(fx('36kr.html'), NOW);
    expect(items.length).toBe(6);
    expect(items[0]).toMatchObject({ url: 'https://www.36kr.com/newsflashes/4038252515267462', heat: '2分钟前', time: NOW - 120_000 });
  });
  it('IT 之家：按时间倒序，去广告', () => {
    const items = parseIthome(fx('ithome.html'), NOW);
    expect(items.length).toBeGreaterThan(3);
    expect(items[0].url).toMatch(/^https:\/\/www\.ithome\.com\//);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].time!).toBeGreaterThanOrEqual(items[i].time!);
    const ad = '<div id="list"><div class="fl"><ul><li><a class="t" href="https://lapin.ithome.com/x">京东神券</a><i>2026-10-23 10:00:00</i></li></ul></div></div>';
    expect(parseIthome(ad, NOW)).toEqual([]);
  });
  it('少数派 / 掘金 / 澎湃 / 贴吧 / 华尔街见闻 / 财联社', () => {
    expect(parseSspai(fx('sspai.json'))[0]).toMatchObject({ id: '116705', url: 'https://sspai.com/post/116705' });
    expect(parseJuejin(fx('juejin.json'))[0]).toMatchObject({ url: 'https://juejin.cn/post/7698382188488048649', heat: '4287 阅读' });
    expect(parseThepaper(fx('thepaper.json'))[0]).toMatchObject({ id: '34310547', url: 'https://www.thepaper.cn/newsDetail_forward_34310547' });
    expect(parseTieba(fx('tieba.json'))[0]).toMatchObject({ title: '老二次元陈睿回应选头像原因', heat: '254.1万 讨论' });
    const w = parseWallstreetcn(fx('wallstreetcn.json'));
    expect(w.length).toBe(6);
    expect(w[0].url).toMatch(/^https:\/\/wallstreetcn\.com\//);
    const c = parseCls(fx('cls.json'));
    expect(c[0].title).toContain('潘功胜');
    expect(c[0].url).toMatch(/^https:\/\/www\.cls\.cn\/detail\/\d+$/);
    expect(() => parseCls('{"errno":"10012","msg":"签名错误"}')).toThrow('签名错误');
  });
});

describe('小工具', () => {
  it('热度格式化', () => {
    expect(formatHeat(1538113)).toBe('153.8万');
    expect(formatHeat('320000000')).toBe('3.2亿');
    expect(formatHeat(856)).toBe('856');
    expect(formatHeat(undefined)).toBe('');
    expect(formatHeat('abc')).toBe('');
  });
  it('相对时间', () => {
    expect(parseRelative('3小时前', NOW)).toBe(NOW - 3 * 3_600_000);
    expect(parseRelative('2026-10-23 17:26:01', NOW)).toBe(Date.UTC(2026, 9, 23, 9, 26, 1));
    expect(parseRelative('上周', NOW)).toBeUndefined();
  });
  it('MD5 与 Node 内置实现一致（含中文和多块输入）', () => {
    for (const s of ['', 'abc', '财联社电报', 'x'.repeat(200)]) expect(md5(s)).toBe(createHash('md5').update(s).digest('hex'));
  });
  it('财联社签名：参数排序后 SHA-1 再 MD5', async () => {
    const q = await clsQuery({ last_time: 1792747900, refresh_type: 1, rn: 30 });
    const p = new URLSearchParams(q);
    const sign = p.get('sign');
    p.delete('sign');
    expect(p.toString()).toBe('appName=CailianpressWeb&last_time=1792747900&os=web&refresh_type=1&rn=30&sv=7.7.5');
    expect(sign).toBe(createHash('md5').update(createHash('sha1').update(p.toString()).digest('hex')).digest('hex'));
  });
  it('Set-Cookie 拼成 Cookie 头', () => {
    expect(cookieHeader(['a=1; Path=/; Domain=x', 'b=2; HttpOnly'])).toBe('a=1; b=2');
  });
  it('定时刷新不小于 5 分钟', () => {
    expect(clampInterval(1)).toBe(5);
    expect(clampInterval(0)).toBe(0);
    expect(clampInterval(30)).toBe(30);
    expect(clampInterval(NaN)).toBe(0);
  });
  it('偏好兜底：未知来源丢弃，间隔夹紧', () => {
    expect(readPrefs({ keywords: 'AI', enabled: ['weibo', 'nope'], interval: 2 })).toEqual({ keywords: 'AI', onlyHits: false, interval: 5, enabled: ['weibo'] });
    expect(readPrefs(null).enabled.length).toBe(SOURCES.length);
  });
});

describe('关键词', () => {
  it('分隔与匹配（不区分大小写）', () => {
    expect(parseKeywords('AI，新能源 华为、ai\n地震')).toEqual(['AI', '新能源', '华为', 'ai', '地震']);
    expect(matchKeywords('OpenAI 发布新模型', ['ai', '华为'])).toEqual(['ai']);
  });
  it('高亮切分', () => {
    expect(splitHighlight('西藏地震已致16死', ['地震'])).toEqual([{ text: '西藏', hit: false }, { text: '地震', hit: true }, { text: '已致16死', hit: false }]);
    expect(splitHighlight('a+b', ['+'])).toEqual([{ text: 'a', hit: false }, { text: '+', hit: true }, { text: 'b', hit: false }]);
  });
  it('汇总命中并找出新增', () => {
    const r: SourceResult[] = [{ id: 'weibo', ok: true, at: NOW, items: [{ id: '1', title: '西藏地震', url: 'u1' }, { id: '2', title: '别的', url: 'u2' }] }];
    const h1 = collectHits(r, ['地震']);
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({ source: 'weibo', rank: 1, keywords: ['地震'] });
    const r2: SourceResult[] = [{ ...r[0], items: [...r[0].items, { id: '3', title: '地震救援', url: 'u3' }] }];
    expect(newHits(h1, collectHits(r2, ['地震'])).map((h) => h.item.id)).toEqual(['3']);
  });
});

describe('抓取流程', () => {
  // 按地址返回录制的响应；某些来源故意失败
  const routes: [RegExp, () => string][] = [
    [/s\.weibo\.com/, () => fx('weibo.html')], [/zhihu\.com/, () => fx('zhihu.json')], [/top\.baidu\.com/, () => fx('baidu.html')],
    [/douyin\.com\/aweme/, () => fx('douyin.json')], [/login\.douyin\.com/, () => ''], [/bilibili\.com/, () => fx('bilibili.json')],
    [/toutiao\.com/, () => fx('toutiao.json')], [/thepaper\.cn/, () => fx('thepaper.json')], [/tieba\.baidu\.com/, () => fx('tieba.json')],
    [/36kr\.com/, () => fx('36kr.html')], [/ithome\.com/, () => fx('ithome.html')], [/sspai\.com/, () => fx('sspai.json')],
    [/juejin\.cn/, () => fx('juejin.json')], [/wallstcn\.com/, () => fx('wallstreetcn.json')], [/cls\.cn/, () => fx('cls.json')],
  ];
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const get: Getter = async (url, headers) => {
    calls.push({ url, headers });
    if (url.includes('zhihu')) throw new Error('HTTP 403');
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) throw new Error('error sending request');
    return { text: hit[1](), setCookie: url.includes('login.douyin') ? ['ttwid=abc; Path=/', 'passport_csrf_token=x; Path=/'] : [] };
  };

  it('一个来源失败不影响其他，抖音带上访客 cookie，微博带访客 cookie', async () => {
    const done: string[] = [];
    const res = await fetchAll(SOURCES.map((s) => s.id), get, NOW, (r) => done.push(r.id));
    expect(res).toHaveLength(SOURCES.length);
    expect(done).toHaveLength(SOURCES.length);
    const zhihu = res.find((r) => r.id === 'zhihu')!;
    expect(zhihu.ok).toBe(false);
    expect(zhihu.error).toContain('网站拒绝了请求（HTTP 403）');
    expect(res.filter((r) => r.ok)).toHaveLength(SOURCES.length - 1);
    expect(calls.find((c) => c.url.includes('aweme'))!.headers!.Cookie).toBe('ttwid=abc; passport_csrf_token=x');
    expect(calls.find((c) => c.url.includes('weibo'))!.headers!.Cookie).toMatch(/^SUB=/);
    expect(calls.find((c) => c.url.includes('cls.cn'))!.url).toMatch(/sign=[0-9a-f]{32}$/);
  });

  it('导出 Markdown 与表格行', async () => {
    const res = await fetchAll(['weibo', 'zhihu', 'toutiao'], get, NOW);
    const md = toMarkdown(res, ['地震'], false, NOW);
    expect(md).toContain('# 全网热点 · 2026-10-23 17:30');
    expect(md).toContain('## 微博热搜');
    expect(md).toContain('> 抓取失败：网站拒绝了请求');
    expect(md).toMatch(/1\. \[\*\*西藏地震地面裂缝比手宽\*\*\]\(https:\/\/www\.toutiao\.com\/trending\/7699707790348045850\/\) · 3294\.2万 〔地震〕/);
    const rows = exportRows(res, ['地震'], true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.命中关键词 === '地震')).toBe(true);
    expect(rows[0]).toMatchObject({ 来源: '今日头条', 排名: 1, 抓取时间: '2026-10-23 17:30' });
    expect(exportFileName(NOW, 'xlsx')).toBe('热点-20261023-1730.xlsx');
  });
});
