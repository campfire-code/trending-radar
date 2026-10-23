// 预览与截图用的示例：用 fixtures 里录制的真实响应（2026-10-23）走一遍真实的解析函数，只在预览页加载。
// 截图会用于宣传，标题统一换成中性的「示例」标题，避免出现真实新闻里的人名与灾害事件；热度、排名等结构保持真实。
import weibo from './fixtures/weibo.html?raw';
import zhihu from './fixtures/zhihu.json?raw';
import baidu from './fixtures/baidu.html?raw';
import douyin from './fixtures/douyin.json?raw';
import bilibili from './fixtures/bilibili.json?raw';
import toutiao from './fixtures/toutiao.json?raw';
import thepaper from './fixtures/thepaper.json?raw';
import tieba from './fixtures/tieba.json?raw';
import kr from './fixtures/36kr.html?raw';
import ithome from './fixtures/ithome.html?raw';
import sspai from './fixtures/sspai.json?raw';
import juejin from './fixtures/juejin.json?raw';
import wscn from './fixtures/wallstreetcn.json?raw';
import cls from './fixtures/cls.json?raw';
import type { Getter, SourceResult } from './core';

const routes: [RegExp, string][] = [
  [/s\.weibo\.com/, weibo], [/zhihu\.com/, zhihu], [/top\.baidu\.com/, baidu], [/douyin\.com\/aweme/, douyin], [/login\.douyin/, ''],
  [/bilibili\.com/, bilibili], [/toutiao\.com/, toutiao], [/thepaper\.cn/, thepaper], [/tieba\.baidu\.com/, tieba], [/36kr\.com/, kr],
  [/ithome\.com/, ithome], [/sspai\.com/, sspai], [/juejin\.cn/, juejin], [/wallstcn\.com/, wscn], [/cls\.cn/, cls],
];

export const SAMPLE_NOW = Date.UTC(2026, 9, 23, 9, 30);
export const SAMPLE_KEYWORDS = 'AI 新能源 电商';

/** 示例里让「少数派」失败，展示单个来源出错时的样子 */
export const sampleGet: Getter = async (url) => {
  if (url.includes('sspai')) throw new Error('HTTP 429');
  const hit = routes.find(([re]) => re.test(url));
  if (!hit) throw new Error('error sending request');
  return { text: hit[1], setCookie: [] };
};

const NEUTRAL = [
  '【示例】AI 写作工具进入办公软件，打工人如何用好', '【示例】新能源汽车十月销量公布', '【示例】秋季电商大促提前开启，商家备货忙',
  '【示例】城市夜经济升温，小店客流回暖', '【示例】国产大模型推出免费版本', '【示例】双十一预售规则有哪些变化',
  '【示例】秋冬换季，保温杯销量上涨', '【示例】新能源充电桩进小区试点扩大', '【示例】直播电商新规下月起施行',
  '【示例】AI 修图功能上线手机相册', '【示例】博物馆文创上新，年轻人排队购买', '【示例】社区团购重新走热',
  '【示例】周末短途游热门目的地出炉', '【示例】电商平台推出商家减负措施', '【示例】新学期文具采购攻略',
  '【示例】咖啡连锁品牌开出第一万家店', '【示例】AI 客服接入更多中小商家', '【示例】二手家电回收价格上涨',
];
/** 把每个来源的标题换成示例标题（不同来源错开起点，避免看起来完全一样） */
export function sampleSanitize(r: SourceResult): SourceResult {
  const offset = [...r.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7) % NEUTRAL.length;
  return { ...r, items: r.items.map((it, i) => ({ ...it, title: NEUTRAL[(offset + i) % NEUTRAL.length] })) };
}
