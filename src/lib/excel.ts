import ExcelJS from 'exceljs';
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

  const buffer = await workbook.xlsx.writeBuffer();
  const uint8 = new Uint8Array(buffer as ArrayBuffer);
  const fileName = `parking-raport-${year}-${String(month).padStart(2, '0')}.xlsx`;
  const blob = new Blob([uint8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────────
// Eksport Właścicielski — raport do analizy ROI i zysku na rękę
// ────────────────────────────────────────────────────────────────────────────
const DAY_FULL = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
const WEATHER_LABELS: Record<string, string> = {
  sunny: '☀️ Słonecznie', cloudy: '🌤️ Zachmurzenie', rainy: '🌧️ Deszcz', stormy: '⛈️ Burza',
};

export async function exportOwnerToExcel(
  year: number,
  month: number,
  revenues: DailyRevenue[],
  invoices: Invoice[],
  totalInvestments: number,
  commissionRate: number
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Parking.OS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Raport Właścicielski');
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  // ── helpers ──────────────────────────────────────────────────────────────
  const thin = (argb = 'FFD1D5DB') => ({ style: 'thin' as const, color: { argb } });
  const med  = (argb = 'FF6B7280') => ({ style: 'medium' as const, color: { argb } });
  const ba   = (argb?: string) => { const b = thin(argb); return { top: b, left: b, bottom: b, right: b }; };
  const bam  = (argb?: string) => { const b = med(argb);  return { top: b, left: b, bottom: b, right: b }; };
  const plnFmt = '#,##0.00';
  const pct    = '0.0"%"';

  // ── column widths ─────────────────────────────────────────────────────────
  [24, 22, 15, 17, 15, 15, 17, 12, 30].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // ── invoice lookup ────────────────────────────────────────────────────────
  const invByDate: Record<string, { oper: number; inv: number }> = {};
  for (const inv of invoices) {
    if (!invByDate[inv.date]) invByDate[inv.date] = { oper: 0, inv: 0 };
    if (inv.category === 'Inwestycja') invByDate[inv.date].inv += inv.amount;
    else invByDate[inv.date].oper += inv.amount;
  }

  // ── pre-calc totals for KPI boxes ─────────────────────────────────────────
  let sumC = 0, sumD = 0, sumE = 0, sumF = 0, sumG = 0;
  for (const r of revenues) {
    const c = r.do_sejfu ?? 0;
    const d = (r.card + r.blik) * (1 - commissionRate / 100);
    const e = invByDate[r.date]?.inv ?? 0;
    const f = invByDate[r.date]?.oper ?? 0;
    sumC += c; sumD += d; sumE += e; sumF += f; sumG += (c + d) - (e + f);
  }

  // ── ROW 1: title ──────────────────────────────────────────────────────────
  sheet.mergeCells('A1:I1');
  Object.assign(sheet.getCell('A1'), {
    value: `PARKING.OS  ·  RAPORT WŁAŚCICIELSKI  ·  ${monthName.toUpperCase()}`,
    font: { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Calibri' },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2D4A' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.getRow(1).height = 44;

  // ── ROW 2: meta ───────────────────────────────────────────────────────────
  sheet.mergeCells('A2:I2');
  Object.assign(sheet.getCell('A2'), {
    value: `Wygenerowano: ${new Date().toLocaleString('pl-PL')}   ·   Prowizja bezgotówkowa: ${commissionRate}%   ·   Dni pracy: ${revenues.length}`,
    font: { italic: true, color: { argb: 'FF94A3B8' }, size: 10 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1B2E' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  sheet.getRow(2).height = 22;

  // ── ROW 3: spacer ─────────────────────────────────────────────────────────
  sheet.getRow(3).height = 8;

  // ── ROWS 4-5: KPI boxes ───────────────────────────────────────────────────
  const kpis = [
    { lm: 'A4:B4', vm: 'A5:B5', label: '💰  DO SEJFU',           value: sumC,        fg: 'FF0D9488', bg: 'FFE6F7F7' },
    { lm: 'C4:D4', vm: 'C5:D5', label: '💳  Karta + BLIK Netto', value: sumD,        fg: 'FF4338CA', bg: 'FFE0E7FF' },
    { lm: 'E4:F4', vm: 'E5:F5', label: '📋  Koszty łącznie',     value: sumE + sumF, fg: 'FFC2410C', bg: 'FFFED7AA' },
    { lm: 'G4:I4', vm: 'G5:I5',
      label: sumG >= 0 ? '📈  ZYSK NA RĘKĘ' : '📉  STRATA',
      value: sumG, fg: sumG >= 0 ? 'FF15803D' : 'FF991B1B', bg: sumG >= 0 ? 'FFDCFCE7' : 'FFFEE2E2' },
  ];
  sheet.getRow(4).height = 22;
  sheet.getRow(5).height = 38;
  for (const k of kpis) {
    sheet.mergeCells(k.lm);
    const lCell = sheet.getCell(k.lm.split(':')[0]);
    lCell.value = k.label;
    lCell.font = { bold: true, size: 10, color: { argb: k.fg } };
    lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.bg } };
    lCell.alignment = { horizontal: 'center', vertical: 'middle' };
    lCell.border = bam(k.fg);

    sheet.mergeCells(k.vm);
    const vCell = sheet.getCell(k.vm.split(':')[0]);
    vCell.value = +k.value.toFixed(2);
    vCell.numFmt = plnFmt;
    vCell.font = { bold: true, size: 18, color: { argb: k.fg } };
    vCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.bg } };
    vCell.alignment = { horizontal: 'center', vertical: 'middle' };
    vCell.border = bam(k.fg);
  }

  // ── ROW 6: spacer ─────────────────────────────────────────────────────────
  sheet.getRow(6).height = 8;

  // ── ROW 7: column headers ─────────────────────────────────────────────────
  const HDR_COLS = ['Data + Dzień', 'Pogoda / Temp.', 'DO SEJFU\n(PLN)', 'Karta+BLIK\nNetto (PLN)', 'Koszty\nInwest. (PLN)', 'Koszty\nOper. (PLN)', 'ZYSK\nNA RĘKĘ (PLN)', 'Postęp\nROI', 'Komentarze'];
  const hdrRow = sheet.getRow(7);
  hdrRow.values = ['', ...HDR_COLS]; // 1-indexed offset trick
  HDR_COLS.forEach((_, i) => {
    const cell = hdrRow.getCell(i + 1);
    cell.value = HDR_COLS[i];
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2D4A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = ba('FF334155');
  });
  hdrRow.height = 38;

  // freeze panes & autofilter
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 7 }];
  sheet.autoFilter = { from: 'A7', to: 'I7' };

  // ── DATA ROWS ─────────────────────────────────────────────────────────────
  let cumProfit = 0;
  let totalC = 0, totalD = 0, totalE = 0, totalF = 0, totalG = 0;

  revenues.forEach((r, idx) => {
    const dayName = DAY_FULL[new Date(r.date).getDay()];
    const weatherStr = r.weather ? (WEATHER_LABELS[r.weather] ?? r.weather) : '';
    const tempStr    = r.temperature != null ? `${r.temperature}°C` : '';
    const wCell      = [weatherStr, tempStr].filter(Boolean).join('  ');

    const colC = r.do_sejfu ?? 0;
    const colD = (r.card + r.blik) * (1 - commissionRate / 100);
    const colE = invByDate[r.date]?.inv ?? 0;
    const colF = invByDate[r.date]?.oper ?? 0;
    const colG = (colC + colD) - (colE + colF);
    cumProfit += colG;
    const colH = totalInvestments > 0 ? +((cumProfit / totalInvestments) * 100).toFixed(1) : null;

    totalC += colC; totalD += colD; totalE += colE; totalF += colF; totalG += colG;

    const rowNum = 8 + idx;
    const isEven = idx % 2 === 0;
    const rowBg  = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

    const row = sheet.getRow(rowNum);
    row.height = 20;

    // A: date – left aligned
    const ca = row.getCell(1);
    ca.value = `${r.date}  ·  ${dayName}`;
    ca.font = { size: 10, color: { argb: 'FF1E293B' } };
    ca.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    ca.alignment = { vertical: 'middle' };
    ca.border = ba();

    // B: weather – center
    const cb = row.getCell(2);
    cb.value = wCell;
    cb.font = { size: 10, color: { argb: 'FF475569' } };
    cb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    cb.alignment = { horizontal: 'center', vertical: 'middle' };
    cb.border = ba();

    // C: DO SEJFU – teal
    const cc = row.getCell(3);
    cc.value = +colC.toFixed(2); cc.numFmt = plnFmt;
    cc.font = { bold: true, size: 10, color: { argb: 'FF0D6E6E' } };
    cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFE6F7F7' : 'FFF0FAFA' } };
    cc.alignment = { horizontal: 'right', vertical: 'middle' };
    cc.border = ba();

    // D: karta/blik
    const cd = row.getCell(4);
    cd.value = +colD.toFixed(2); cd.numFmt = plnFmt;
    cd.font = { size: 10, color: { argb: 'FF3730A3' } };
    cd.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    cd.alignment = { horizontal: 'right', vertical: 'middle' };
    cd.border = ba();

    // E: koszty inwest
    const ce = row.getCell(5);
    ce.value = +colE.toFixed(2); ce.numFmt = plnFmt;
    ce.font = { size: 10, color: { argb: colE > 0 ? 'FF9A3412' : 'FF94A3B8' } };
    ce.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    ce.alignment = { horizontal: 'right', vertical: 'middle' };
    ce.border = ba();

    // F: koszty oper
    const cf = row.getCell(6);
    cf.value = +colF.toFixed(2); cf.numFmt = plnFmt;
    cf.font = { size: 10, color: { argb: colF > 0 ? 'FF9A3412' : 'FF94A3B8' } };
    cf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    cf.alignment = { horizontal: 'right', vertical: 'middle' };
    cf.border = ba();

    // G: zysk – green/red with dark fill
    const cg = row.getCell(7);
    cg.value = +colG.toFixed(2); cg.numFmt = plnFmt;
    cg.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cg.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colG >= 0 ? 'FF15803D' : 'FFDC2626' } };
    cg.alignment = { horizontal: 'right', vertical: 'middle' };
    cg.border = ba();

    // H: ROI %
    const ch = row.getCell(8);
    if (colH !== null) {
      ch.value = colH; ch.numFmt = pct;
      const roiDone = colH >= 100;
      ch.font = { bold: roiDone, size: 10, color: { argb: roiDone ? 'FFFFFFFF' : 'FF64748B' } };
      ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: roiDone ? 'FF15803D' : rowBg } };
    } else {
      ch.value = '—';
      ch.font = { color: { argb: 'FFCBD5E1' } };
      ch.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    }
    ch.alignment = { horizontal: 'center', vertical: 'middle' };
    ch.border = ba();

    // I: komentarze
    const ci = row.getCell(9);
    ci.value = r.notes ?? '';
    ci.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
    ci.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
    ci.alignment = { vertical: 'middle', wrapText: true };
    ci.border = ba();
  });

  // ── SUMA MIESIĄCA ─────────────────────────────────────────────────────────
  const sumRowNum = 8 + revenues.length + 1;
  sheet.getRow(sumRowNum - 1).height = 6; // mini spacer
  const sumRow = sheet.getRow(sumRowNum);
  sumRow.height = 28;

  const sumDefs = [
    { v: 'SUMA MIESIĄCA', fmt: null, bold: true, fg: 'FF1A2D4A', bg: 'FFF5C842', align: 'left' as const },
    { v: '',              fmt: null, bold: false, fg: 'FF1A2D4A', bg: 'FFF5C842', align: 'center' as const },
    { v: +totalC.toFixed(2), fmt: plnFmt, bold: true, fg: 'FF0D6E6E', bg: 'FFF5C842', align: 'right' as const },
    { v: +totalD.toFixed(2), fmt: plnFmt, bold: true, fg: 'FF3730A3', bg: 'FFF5C842', align: 'right' as const },
    { v: +totalE.toFixed(2), fmt: plnFmt, bold: true, fg: 'FF9A3412', bg: 'FFF5C842', align: 'right' as const },
    { v: +totalF.toFixed(2), fmt: plnFmt, bold: true, fg: 'FF9A3412', bg: 'FFF5C842', align: 'right' as const },
    { v: +totalG.toFixed(2), fmt: plnFmt, bold: true, fg: totalG >= 0 ? 'FFFFFFFF' : 'FFFFFFFF', bg: totalG >= 0 ? 'FF15803D' : 'FFDC2626', align: 'right' as const },
    { v: '',              fmt: null, bold: false, fg: 'FF1A2D4A', bg: 'FFF5C842', align: 'center' as const },
    { v: '',              fmt: null, bold: false, fg: 'FF1A2D4A', bg: 'FFF5C842', align: 'center' as const },
  ];
  sumDefs.forEach((d, i) => {
    const cell = sumRow.getCell(i + 1);
    cell.value = d.v;
    if (d.fmt) cell.numFmt = d.fmt;
    cell.font = { bold: d.bold, size: 11, color: { argb: d.fg } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: d.bg } };
    cell.alignment = { horizontal: d.align, vertical: 'middle' };
    cell.border = bam('FF92400E');
  });

  // ── ROI footer ────────────────────────────────────────────────────────────
  if (totalInvestments > 0) {
    const roiRemaining = Math.max(0, totalInvestments - cumProfit);
    const roiRowNum = sumRowNum + 2;
    sheet.getRow(roiRowNum - 1).height = 6;
    sheet.mergeCells(`A${roiRowNum}:D${roiRowNum}`);
    sheet.mergeCells(`E${roiRowNum}:I${roiRowNum}`);

    const roiDone = roiRemaining === 0;
    const r1 = sheet.getCell(`A${roiRowNum}`);
    r1.value = roiDone ? '🎉  Inwestycja całkowicie spłacona!' : `⏳  Do zwrotu inwestycji: ${roiRemaining.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`;
    r1.font = { bold: true, size: 12, color: { argb: roiDone ? 'FF14532D' : 'FFFFFFFF' } };
    r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: roiDone ? 'FFF5C842' : 'FF6D28D9' } };
    r1.alignment = { horizontal: 'center', vertical: 'middle' };
    r1.border = bam(roiDone ? 'FF92400E' : 'FF7C3AED');
    sheet.getRow(roiRowNum).height = 28;

    const r2 = sheet.getCell(`E${roiRowNum}`);
    r2.value = `Łączna inwestycja: ${totalInvestments.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł   ·   Skumulowany zysk: ${cumProfit.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`;
    r2.font = { italic: true, size: 10, color: { argb: roiDone ? 'FF14532D' : 'FFEDE9FE' } };
    r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: roiDone ? 'FFF5C842' : 'FF6D28D9' } };
    r2.alignment = { horizontal: 'center', vertical: 'middle' };
    r2.border = bam(roiDone ? 'FF92400E' : 'FF7C3AED');
  }

  // ── save ──────────────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const uint8 = new Uint8Array(buffer as ArrayBuffer);
  const fileName = `parking-wlasciciel-${year}-${String(month).padStart(2, '0')}.xlsx`;
  const blob = new Blob([uint8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}
