// @vitest-environment jsdom
// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）：用录制的响应导出一份示例 Markdown 和 Excel
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { SOURCES, exportRows, fetchAll, parseKeywords, toMarkdown } from './core';
import { SAMPLE_KEYWORDS, SAMPLE_NOW, sampleGet } from './sample';
import { writeHotXlsx } from './xlsx';

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', async () => {
  const res = await fetchAll(SOURCES.map((s) => s.id), sampleGet, SAMPLE_NOW);
  const kw = parseKeywords(SAMPLE_KEYWORDS);
  writeFileSync('samples/订阅关键词示例.txt', SAMPLE_KEYWORDS + '\n');
  writeFileSync('samples/示例导出-全部.md', toMarkdown(res, kw, false, SAMPLE_NOW));
  writeFileSync('samples/示例导出-只看命中.xlsx', await writeHotXlsx(exportRows(res, kw, true)));
});
