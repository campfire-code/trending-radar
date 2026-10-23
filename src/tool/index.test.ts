// @vitest-environment jsdom
// 完整流程：用录制响应抓取全部来源 → 按关键词筛选 → 导出 Excel 再读回来核对。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import tool from './index';
import meta from '../../tool.json';
import { SOURCES, exportRows, fetchAll, type Getter } from './core';
import { writeHotXlsx } from './xlsx';

const fx = (n: string) => readFileSync(join(process.cwd(), 'src/tool/fixtures', n), 'utf8');
const map: [RegExp, string][] = [[/weibo/, 'weibo.html'], [/toutiao/, 'toutiao.json'], [/bilibili/, 'bilibili.json'], [/cls\.cn/, 'cls.json']];
const get: Getter = async (url) => {
  const f = map.find(([re]) => re.test(url));
  if (!f) throw new Error('error sending request');
  return { text: fx(f[1]), setCookie: [] };
};

describe('全网热点雷达', () => {
  it('工具声明与 tool.json 一致，是自定义界面，不需要大模型', () => {
    expect(tool.id).toBe(meta.id);
    expect(tool.name).toBe(meta.name);
    expect(tool.mode).toBe('custom');
    expect(tool.needsLLM).toBeFalsy();
    expect(SOURCES.length).toBeGreaterThanOrEqual(10);
    expect(SOURCES.length).toBeLessThanOrEqual(15);
  });

  it('抓取 → 只导出命中「地震」的条目 → Excel 读回一致', async () => {
    const res = await fetchAll(['weibo', 'toutiao', 'bilibili', 'cls', 'zhihu'], get, Date.UTC(2026, 9, 23, 9, 30));
    expect(res.find((r) => r.id === 'zhihu')!.error).toBe('连不上该网站，检查网络或代理设置');
    const rows = exportRows(res, ['地震'], true);
    const bytes = await writeHotXlsx(rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.getWorksheet('热点')!;
    expect(ws.getRow(1).values).toEqual([, '来源', '排名', '标题', '热度', '链接', '命中关键词', '抓取时间']);
    expect(ws.rowCount).toBe(rows.length + 1);
    expect(ws.getRow(2).getCell(1).value).toBe(rows[0].来源);
    const link = ws.getRow(2).getCell(5).value as { hyperlink: string };
    expect(link.hyperlink).toBe(rows[0].链接);
    expect(rows.map((r) => r.来源)).toEqual(expect.arrayContaining(['今日头条', 'B 站热搜']));
  });
});
