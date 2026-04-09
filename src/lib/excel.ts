import ExcelJS from 'exceljs';
import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { DailyRevenue, Invoice, DENOMS } from './database';

export async function exportMonthToExcel(
  year: number,
  month: number,
  revenues: DailyRevenue[],
  invoices: Invoice[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Parking.OS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Raport finansowy');

  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  // --- Header ---
  sheet.mergeCells('A1:R1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `Parking.OS — Raport finansowy — ${monthName}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1A2D4A' } };
  titleCell.alignment = { horizontal: 'center' };

  sheet.getCell('A2').value = `Wygenerowano: ${new Date().toLocaleString('pl-PL')}`;
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };

  sheet.addRow([]);

  // --- Revenue table header ---
  sheet.mergeCells('A4:R4');
  const revHeader = sheet.getCell('A4');
  revHeader.value = 'PRZYCHODY DZIENNE';
  revHeader.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  revHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2D4A' } };
  revHeader.alignment = { horizontal: 'center' };

  const denomHeaders = DENOMS.map(d => `${d.label} (szt.)`)
  const revColHeaders = sheet.addRow(['Data', ...denomHeaders, 'Monety (PLN)', 'Banknoty (PLN)', 'Karta (PLN)', 'BLIK (PLN)', 'Razem (PLN)', 'Szac. liczba aut', 'Notatki']);
  revColHeaders.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4DBFBF' } };
    cell.alignment = { horizontal: 'center' };
  });

  let totalRevenue = 0;
  let totalCars = 0;

  for (const r of revenues) {
    const coins = r.coins ?? 0;
    const banknotes = r.banknotes ?? 0;
    const total = r.total ?? 0;
    const cars = r.estimated_cars ?? 0;
    totalRevenue += total;
    totalCars += cars;
    const qtys = DENOMS.map(d => r[d.key as keyof DailyRevenue] as number ?? 0);
    sheet.addRow([r.date, ...qtys, coins, banknotes, r.card, r.blik, total, cars, r.notes ?? '']);
  }

  // Summary row — skip qty columns
  const denomBlanks = DENOMS.map(() => '');
  const sumRow = sheet.addRow(['SUMA', ...denomBlanks, '', '', '', '', totalRevenue, totalCars, '']);
  sumRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5C842' } };
  });

  sheet.addRow([]);
  sheet.addRow([]);

  // --- Invoices header ---
  const invoiceStartRow = sheet.lastRow!.number + 1;
  sheet.mergeCells(`A${invoiceStartRow}:E${invoiceStartRow}`);
  const invHeader = sheet.getCell(`A${invoiceStartRow}`);
  invHeader.value = 'FAKTURY KOSZTOWE';
  invHeader.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  invHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8622A' } };
  invHeader.alignment = { horizontal: 'center' };

  const invColHeaders = sheet.addRow(['Data', 'Nazwa', 'Kategoria', 'Kwota (PLN)', '']);
  invColHeaders.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4DBFBF' } };
  });

  let totalCosts = 0;
  for (const inv of invoices) {
    totalCosts += inv.amount;
    sheet.addRow([inv.date, inv.name, inv.category, inv.amount, '']);
  }

  const costSumRow = sheet.addRow(['SUMA KOSZTÓW', '', '', totalCosts, '']);
  costSumRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5C842' } };
  });

  sheet.addRow([]);

  // --- Net result ---
  const profit = totalRevenue - totalCosts;
  const resultRow = sheet.addRow([profit >= 0 ? 'ZYSK NETTO' : 'STRATA NETTO', '', '', '', '', profit, '', '']);
  resultRow.eachCell(cell => {
    cell.font = { bold: true, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: profit >= 0 ? 'FF22C55E' : 'FFEF4444' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });

  // Column widths
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 18;
  sheet.getColumn(8).width = 24;

  // Write to buffer and save via Tauri fs
  const buffer = await workbook.xlsx.writeBuffer();
  const uint8 = new Uint8Array(buffer as ArrayBuffer);
  const fileName = `parking-raport-${year}-${String(month).padStart(2, '0')}.xlsx`;

  await writeFile(fileName, uint8, { baseDir: BaseDirectory.Download });

  // Also trigger browser download as fallback
  const blob = new Blob([uint8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
