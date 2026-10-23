// 工具声明：全网热点雷达（自定义界面：按来源分栏展示热榜，关键词高亮与过滤，定时刷新，导出 Excel / Markdown）。
import { createElement } from 'react';
import { Radar } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'c19',
  name: '全网热点雷达',
  tagline: '一次看 14 个中文热榜（微博、知乎、百度、抖音、B 站、头条、36 氪、财联社等），关键词命中自动高亮，可定时刷新，一键导出 Excel / Markdown。',
  category: '内容生产',
  type: 'text',
  mode: 'custom',
  mainLabel: '热榜',
  icon: Radar,
  params: [],
  // 预览页（preview.html）里不联网，改用录制的示例数据
  Main: () => createElement(Main, { preview: location.pathname.endsWith('preview.html') }),
};

export default tool;
