// 导出 Excel：基于 exceljs（MIT）。加粗表头、冻结首行、标题列加宽，链接可点击。
import ExcelJS from 'exceljs';
import type { ExportRow } from './core';

const COLS: [keyof ExportRow, number][] = [['来源', 12], ['排名', 6], ['标题', 56], ['热度', 16], ['链接', 40], ['命中关键词', 14], ['抓取时间', 17]];

export async function writeHotXlsx(rows: ExportRow[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('热点');
  ws.columns = COLS.map(([k, w]) => ({ header: k, key: k, width: w }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    const row = ws.addRow(r);
    if (r.链接) row.getCell('链接').value = { text: r.链接, hyperlink: r.链接 };
    if (r.命中关键词) row.getCell('标题').font = { bold: true };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
