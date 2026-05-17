import Database from '@tauri-apps/plugin-sql';

let db: Awaited<ReturnType<typeof Database.load>> | null = null;

export async function getDb() {
  if (!db) {
    db = await Database.load('sqlite:parking_os.db');
    await initSchema();
  }
  return db;
}

async function initSchema() {
  const database = await getDb();

  // Migration: if daily_revenue lacks denomination columns, drop and recreate
  let hasDenoms = false;
  try {
    await database.select('SELECT qty_1 FROM daily_revenue LIMIT 1', []);
    hasDenoms = true;
  } catch { hasDenoms = false; }
  if (!hasDenoms) {
    await database.execute('DROP TABLE IF EXISTS daily_revenue');
  }

  await database.execute(`
    CREATE TABLE IF NOT EXISTS daily_revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      qty_1   INTEGER NOT NULL DEFAULT 0,
      qty_2   INTEGER NOT NULL DEFAULT 0,
      qty_5   INTEGER NOT NULL DEFAULT 0,
      qty_10  INTEGER NOT NULL DEFAULT 0,
      qty_20  INTEGER NOT NULL DEFAULT 0,
      qty_50  INTEGER NOT NULL DEFAULT 0,
      qty_100 INTEGER NOT NULL DEFAULT 0,
      qty_200 INTEGER NOT NULL DEFAULT 0,
      qty_500 INTEGER NOT NULL DEFAULT 0,
      card REAL NOT NULL DEFAULT 0,
      blik REAL NOT NULL DEFAULT 0,
      notes TEXT
    );
  `);

  // Migration: add base_qty_* columns (baza na jutro)
  for (const col of ['base_qty_1','base_qty_2','base_qty_5','base_qty_10','base_qty_20','base_qty_50','base_qty_100','base_qty_200','base_qty_500']) {
    try { await database.select(`SELECT ${col} FROM daily_revenue LIMIT 1`, []); }
    catch { await database.execute(`ALTER TABLE daily_revenue ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); }
  }
  // Migration: add weather and temperature columns
  try { await database.select('SELECT weather FROM daily_revenue LIMIT 1', []); }
  catch { await database.execute('ALTER TABLE daily_revenue ADD COLUMN weather TEXT'); }
  try { await database.select('SELECT temperature FROM daily_revenue LIMIT 1', []); }
  catch { await database.execute('ALTER TABLE daily_revenue ADD COLUMN temperature REAL'); }

  // Create invoices table (initial without Inwestycja, migrated below)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Usługi','Podatki','Materiały')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // Migration: add 'Inwestycja' category to invoices (SQLite can't ALTER CHECK, recreate if needed)
  try {
    await database.execute(`INSERT INTO invoices (name, amount, date, category) VALUES ('__migtest__', 0, '2000-01-01', 'Inwestycja')`);
    await database.execute(`DELETE FROM invoices WHERE name = '__migtest__'`);
  } catch {
    await database.execute(`CREATE TABLE IF NOT EXISTS invoices_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Usługi','Podatki','Materiały','Inwestycja')),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`);
    await database.execute(`INSERT INTO invoices_new SELECT * FROM invoices`);
    await database.execute(`DROP TABLE invoices`);
    await database.execute(`ALTER TABLE invoices_new RENAME TO invoices`);
  }

  // Migration (Iter 11): add supplier + payment_method to invoices
  try { await database.select('SELECT supplier FROM invoices LIMIT 1', []); }
  catch { await database.execute(`ALTER TABLE invoices ADD COLUMN supplier TEXT`); }
  try { await database.select('SELECT payment_method FROM invoices LIMIT 1', []); }
  catch { await database.execute(`ALTER TABLE invoices ADD COLUMN payment_method TEXT`); }

  // Iter 11: koszty cykliczne (stałe miesięczne / sezonowe / amortyzacja)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS expenses_recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('fixed','variable','amortization')),
      active_months TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7,8,9,10,11,12',
      start_date TEXT,
      end_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  // Migration: seed historical 2025 data (one-time, INSERT OR IGNORE — never overwrites existing)
  const existing2025 = await database.select<{cnt:number}[]>(
    `SELECT COUNT(*) as cnt FROM daily_revenue WHERE date LIKE '2025-%'`, []
  );
  if (!existing2025[0] || existing2025[0].cnt === 0) {
    // Denomination layout: (qty_1, qty_2, qty_5, qty_10, qty_20, qty_50, qty_100, qty_200, qty_500)
    // All values computed via greedy breakdown of total cash; card=0, blik=0
    const rows2025: [string, number,number,number,number,number,number,number,number,number][] = [
      // date,               q1 q2 q5 q10 q20 q50 q100 q200 q500
      ['2025-05-01',          1, 0, 1,  1,  1,  0,   1,   1,   0],  // 336 zł
      ['2025-05-02',          0, 0, 0,  0,  0,  1,   0,   0,   0],  //  50 zł
      ['2025-05-03',          0, 0, 1,  1,  1,  0,   1,   0,   0],  // 135 zł
      ['2025-05-24',          0, 0, 0,  1,  0,  0,   0,   0,   0],  //  10 zł
      ['2025-05-25',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-05-30',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-06-01',          0, 0, 0,  0,  0,  1,   0,   0,   0],  //  50 zł
      ['2025-06-08',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-06-14',          0, 0, 0,  1,  1,  1,   0,   0,   0],  //  80 zł
      ['2025-06-15',          0, 0, 1,  0,  0,  1,   0,   1,   3],  // 1755 zł
      ['2025-06-19',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-06-20',          1, 1, 1,  0,  1,  0,   1,   0,   0],  // 128 zł
      ['2025-06-21',          0, 0, 1,  1,  0,  1,   0,   2,   0],  // 465 zł
      ['2025-06-22',          0, 0, 0,  1,  0,  0,   1,   1,   1],  // 810 zł
      ['2025-06-28',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-06-29',          0, 0, 0,  1,  0,  1,   0,   0,   0],  //  60 zł
      ['2025-07-02',          0, 0, 0,  0,  0,  0,   1,   1,   0],  // 300 zł
      ['2025-07-03',          0, 0, 1,  0,  1,  1,   0,   0,   0],  //  75 zł
      ['2025-07-04',          0, 0, 0,  0,  1,  0,   0,   0,   0],  //  20 zł
      ['2025-07-05',          0, 0, 0,  0,  2,  0,   0,   0,   0],  //  40 zł
      ['2025-07-06',          0, 0, 1,  1,  1,  0,   1,   1,   0],  // 335 zł
      ['2025-07-13',          0, 0, 0,  0,  2,  0,   0,   0,   0],  //  40 zł
      ['2025-07-20',          0, 0, 1,  0,  0,  0,   0,   1,   5],  // 2705 zł
      ['2025-07-27',          0, 0, 0,  1,  1,  0,   0,   0,   1],  // 530 zł
      ['2025-08-02',          0, 0, 0,  0,  1,  0,   1,   0,   0],  // 120 zł
      ['2025-08-09',          0, 0, 1,  0,  0,  1,   0,   2,   3],  // 1955 zł
      ['2025-08-10',          0, 0, 0,  0,  2,  0,   0,   0,   0],  //  40 zł
      ['2025-08-14',          0, 0, 1,  1,  0,  0,   0,   1,   1],  // 715 zł
      ['2025-08-15',          0, 0, 1,  1,  1,  1,   0,   2,  10],  // 5485 zł
      ['2025-08-16',          0, 0, 0,  0,  1,  1,   1,   0,   1],  // 670 zł
      ['2025-08-17',          0, 0, 1,  0,  1,  1,   0,   1,   0],  // 275 zł
      ['2025-08-19',          0, 0, 0,  1,  1,  1,   0,   0,   0],  //  80 zł
    ];
    for (const [date, q1,q2,q5,q10,q20,q50,q100,q200,q500] of rows2025) {
      await database.execute(
        `INSERT OR IGNORE INTO daily_revenue
           (date, qty_1, qty_2, qty_5, qty_10, qty_20, qty_50, qty_100, qty_200, qty_500, card, blik, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,0,'historyczny 2025')`,
        [date, q1,q2,q5,q10,q20,q50,q100,q200,q500]
      );
    }
  }

  // Migration: seed historical 2025 invoices (one-time)
  const existing2025inv = await database.select<{cnt:number}[]>(
    `SELECT COUNT(*) as cnt FROM invoices WHERE date LIKE '2025-%'`, []
  );
  if (!existing2025inv[0] || existing2025inv[0].cnt === 0) {
    const invoices2025: Array<[string, number, string, string]> = [
      // --- Koszty uruchomienia (kwiecień 2025 / pre-sezon) ---
      ['Kaso-Terminal (inwestycja)', 2212.77, '2025-04-30', 'Inwestycja'],
      ['Castorama (start)', 200.00, '2025-04-30', 'Materiały'],
      ['IPOS (oprogramowanie)', 121.77, '2025-04-30', 'Usługi'],
      ['SODA (materiały start)', 178.80, '2025-04-30', 'Materiały'],
      ['Faktura Szczepan', 13.58, '2025-04-30', 'Usługi'],
      ['Makro (materiały)', 85.68, '2025-04-30', 'Materiały'],
      ['Makro (materiały)', 43.14, '2025-04-30', 'Materiały'],
      ['ZUS (kwiecień)', 466.11, '2025-04-30', 'Podatki'],
      ['Księgowość (kwiecień)', 320.00, '2025-04-30', 'Usługi'],
      // --- Maj 2025 ---
      ['Księgowość (maj)', 320.00, '2025-05-01', 'Usługi'],
      ['ZUS (maj)', 466.11, '2025-05-01', 'Podatki'],
      ['Podatek PIT (maj)', 18.00, '2025-05-01', 'Podatki'],
      ['Castorama (materiały)', 147.92, '2025-05-01', 'Materiały'],
      ['POS (maj)', 72.57, '2025-05-01', 'Usługi'],
      ['Terminal abonament (maj)', 78.00, '2025-05-01', 'Usługi'],
      ['Telefon (maj)', 98.00, '2025-05-01', 'Usługi'],
      // --- Czerwiec 2025 ---
      ['Księgowość (czerwiec)', 320.00, '2025-06-01', 'Usługi'],
      ['ZUS (czerwiec)', 466.11, '2025-06-01', 'Podatki'],
      ['Podatek PIT (czerwiec)', 214.00, '2025-06-01', 'Podatki'],
      ['Leroy-Merlin (materiały)', 75.00, '2025-06-01', 'Materiały'],
      ['POS (czerwiec)', 72.57, '2025-06-01', 'Usługi'],
      ['Terminal abonament (czerwiec)', 78.00, '2025-06-01', 'Usługi'],
      ['Telefon (czerwiec)', 114.39, '2025-06-01', 'Usługi'],
      // --- Lipiec 2025 ---
      ['Księgowość (lipiec)', 320.00, '2025-07-01', 'Usługi'],
      ['ZUS (lipiec)', 466.11, '2025-07-01', 'Podatki'],
      ['Podatek PIT (lipiec)', 223.00, '2025-07-01', 'Podatki'],
      ['POS (lipiec)', 72.57, '2025-07-01', 'Usługi'],
      ['Terminal abonament (lipiec)', 78.00, '2025-07-01', 'Usługi'],
      ['Telefon (lipiec)', 256.59, '2025-07-01', 'Usługi'],
      ['Etui (materiały)', 73.90, '2025-07-01', 'Materiały'],
      ['Soda (materiały)', 99.80, '2025-07-01', 'Materiały'],
      // --- Sierpień 2025 ---
      ['Księgowość (sierpień)', 320.00, '2025-08-01', 'Usługi'],
      ['ZUS (sierpień)', 466.11, '2025-08-01', 'Podatki'],
      ['Podatek PIT (sierpień)', 565.00, '2025-08-01', 'Podatki'],
      ['Podatek VAT (sierpień)', 565.00, '2025-08-01', 'Podatki'],
      ['POS (sierpień)', 72.57, '2025-08-01', 'Usługi'],
      ['Terminal abonament (sierpień)', 78.00, '2025-08-01', 'Usługi'],
      ['Telefon (sierpień)', 256.59, '2025-08-01', 'Usługi'],
    ];
    for (const [name, amount, date, category] of invoices2025) {
      await database.execute(
        `INSERT INTO invoices (name, amount, date, category) VALUES (?,?,?,?)`,
        [name, amount, date, category]
      );
    }
  }
}

// ---------- Daily Revenue ----------

export const DENOMS = [
  { key: 'qty_1'   as const, value: 1,   label: '1 zł',   type: 'coin' as const },
  { key: 'qty_2'   as const, value: 2,   label: '2 zł',   type: 'coin' as const },
  { key: 'qty_5'   as const, value: 5,   label: '5 zł',   type: 'coin' as const },
  { key: 'qty_10'  as const, value: 10,  label: '10 zł',  type: 'note' as const },
  { key: 'qty_20'  as const, value: 20,  label: '20 zł',  type: 'note' as const },
  { key: 'qty_50'  as const, value: 50,  label: '50 zł',  type: 'note' as const },
  { key: 'qty_100' as const, value: 100, label: '100 zł', type: 'note' as const },
  { key: 'qty_200' as const, value: 200, label: '200 zł', type: 'note' as const },
  { key: 'qty_500' as const, value: 500, label: '500 zł', type: 'note' as const },
] as const;

export type DenomKey = typeof DENOMS[number]['key'];

export const BASE_DENOMS = [
  { key: 'base_qty_1'   as const, value: 1,   label: '1 z\u0142',   type: 'coin' as const },
  { key: 'base_qty_2'   as const, value: 2,   label: '2 z\u0142',   type: 'coin' as const },
  { key: 'base_qty_5'   as const, value: 5,   label: '5 z\u0142',   type: 'coin' as const },
  { key: 'base_qty_10'  as const, value: 10,  label: '10 z\u0142',  type: 'note' as const },
  { key: 'base_qty_20'  as const, value: 20,  label: '20 z\u0142',  type: 'note' as const },
  { key: 'base_qty_50'  as const, value: 50,  label: '50 z\u0142',  type: 'note' as const },
  { key: 'base_qty_100' as const, value: 100, label: '100 z\u0142', type: 'note' as const },
  { key: 'base_qty_200' as const, value: 200, label: '200 z\u0142', type: 'note' as const },
  { key: 'base_qty_500' as const, value: 500, label: '500 z\u0142', type: 'note' as const },
] as const;

export type BaseDenomKey = typeof BASE_DENOMS[number]['key'];

export interface DailyRevenue {
  id?: number;
  date: string;
  qty_1: number;
  qty_2: number;
  qty_5: number;
  qty_10: number;
  qty_20: number;
  qty_50: number;
  qty_100: number;
  qty_200: number;
  qty_500: number;
  card: number;
  blik: number;
  notes?: string;
  // baza na jutro
  base_qty_1?: number;
  base_qty_2?: number;
  base_qty_5?: number;
  base_qty_10?: number;
  base_qty_20?: number;
  base_qty_50?: number;
  base_qty_100?: number;
  base_qty_200?: number;
  base_qty_500?: number;
  weather?: string;
  temperature?: number;
  // computed:
  coins?: number;
  banknotes?: number;
  cash?: number;
  total?: number;
  estimated_cars?: number;
  base_total?: number;
  do_sejfu?: number;
}

function computeTotals(r: DailyRevenue): DailyRevenue {
  const coins = r.qty_1 * 1 + r.qty_2 * 2 + r.qty_5 * 5;
  const banknotes = r.qty_10 * 10 + r.qty_20 * 20 + r.qty_50 * 50 + r.qty_100 * 100 + r.qty_200 * 200 + r.qty_500 * 500;
  const cash = coins + banknotes;
  const total = cash + r.card + r.blik;
  const base_total = (r.base_qty_1 ?? 0)*1 + (r.base_qty_2 ?? 0)*2 + (r.base_qty_5 ?? 0)*5
                   + (r.base_qty_10 ?? 0)*10 + (r.base_qty_20 ?? 0)*20 + (r.base_qty_50 ?? 0)*50
                   + (r.base_qty_100 ?? 0)*100 + (r.base_qty_200 ?? 0)*200 + (r.base_qty_500 ?? 0)*500;
  const do_sejfu = cash - base_total;
  return { ...r, coins, banknotes, cash, total, estimated_cars: Math.round(total / 20), base_total, do_sejfu };
}

export async function getDailyRevenue(date: string): Promise<DailyRevenue | null> {
  const database = await getDb();
  const rows = await database.select<DailyRevenue[]>(
    'SELECT * FROM daily_revenue WHERE date = $1',
    [date]
  );
  if (rows.length === 0) return null;
  return computeTotals(rows[0]);
}

export async function upsertDailyRevenue(data: DailyRevenue): Promise<void> {
  const database = await getDb();
  await database.execute(`
    INSERT INTO daily_revenue (date, qty_1, qty_2, qty_5, qty_10, qty_20, qty_50, qty_100, qty_200, qty_500, card, blik, notes,
      base_qty_1, base_qty_2, base_qty_5, base_qty_10, base_qty_20, base_qty_50, base_qty_100, base_qty_200, base_qty_500, weather, temperature)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
    ON CONFLICT(date) DO UPDATE SET
      qty_1=$2, qty_2=$3, qty_5=$4, qty_10=$5, qty_20=$6, qty_50=$7,
      qty_100=$8, qty_200=$9, qty_500=$10, card=$11, blik=$12, notes=$13,
      base_qty_1=$14, base_qty_2=$15, base_qty_5=$16, base_qty_10=$17, base_qty_20=$18, base_qty_50=$19,
      base_qty_100=$20, base_qty_200=$21, base_qty_500=$22, weather=$23, temperature=$24
  `, [
    data.date,
    data.qty_1, data.qty_2, data.qty_5,
    data.qty_10, data.qty_20, data.qty_50, data.qty_100, data.qty_200, data.qty_500,
    data.card, data.blik, data.notes ?? '',
    data.base_qty_1 ?? 0, data.base_qty_2 ?? 0, data.base_qty_5 ?? 0,
    data.base_qty_10 ?? 0, data.base_qty_20 ?? 0, data.base_qty_50 ?? 0,
    data.base_qty_100 ?? 0, data.base_qty_200 ?? 0, data.base_qty_500 ?? 0,
    data.weather ?? null, data.temperature ?? null,
  ]);
}

export async function getMonthlyRevenue(year: number, month: number): Promise<DailyRevenue[]> {
  const database = await getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const rows = await database.select<DailyRevenue[]>(
    'SELECT * FROM daily_revenue WHERE date LIKE $1 ORDER BY date',
    [`${prefix}%`]
  );
  return rows.map(computeTotals);
}

export async function deleteDailyRevenue(date: string): Promise<void> {
  const database = await getDb();
  await database.execute('DELETE FROM daily_revenue WHERE date = $1', [date]);
}

// ---------- Invoices ----------

export interface Invoice {
  id?: number;
  name: string;
  amount: number;
  date: string;
  category: 'Us\u0142ugi' | 'Podatki' | 'Materia\u0142y' | 'Inwestycja';
  supplier?: string;
  payment_method?: 'gotówka' | 'karta' | 'przelew' | 'BLIK' | string;
  created_at?: string;
}

export async function getMonthlyInvoices(year: number, month: number): Promise<Invoice[]> {
  const database = await getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return database.select<Invoice[]>(
    'SELECT * FROM invoices WHERE date LIKE $1 ORDER BY date',
    [`${prefix}%`]
  );
}

export async function addInvoice(invoice: Omit<Invoice, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.execute(
    'INSERT INTO invoices (name, amount, date, category, supplier, payment_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [invoice.name, invoice.amount, invoice.date, invoice.category, invoice.supplier ?? null, invoice.payment_method ?? null]
  );
}

export async function updateInvoice(id: number, invoice: Omit<Invoice, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.execute(
    'UPDATE invoices SET name=$1, amount=$2, date=$3, category=$4, supplier=$5, payment_method=$6 WHERE id=$7',
    [invoice.name, invoice.amount, invoice.date, invoice.category, invoice.supplier ?? null, invoice.payment_method ?? null, id]
  );
}

export async function deleteInvoice(id: number): Promise<void> {
  const database = await getDb();
  await database.execute('DELETE FROM invoices WHERE id = $1', [id]);
}

export async function getTotalInvestments(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE category = 'Inwestycja'`, []
  );
  return rows[0]?.total ?? 0;
}

export async function getTotalRevenue(): Promise<number> {
  const database = await getDb();
  const rows = await database.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(qty_1*1 + qty_2*2 + qty_5*5 + qty_10*10 + qty_20*20 + qty_50*50 + qty_100*100 + qty_200*200 + qty_500*500 + card + blik), 0) as total FROM daily_revenue`, []
  );
  return rows[0]?.total ?? 0;
}

export async function getYearlyRevenue(year: number): Promise<DailyRevenue[]> {
  const database = await getDb();
  const rows = await database.select<DailyRevenue[]>(
    'SELECT * FROM daily_revenue WHERE date LIKE $1 ORDER BY date',
    [`${year}-%`]
  );
  return rows.map(computeTotals);
}

export async function getYearlyInvoices(year: number): Promise<Invoice[]> {
  const database = await getDb();
  return database.select<Invoice[]>(
    'SELECT * FROM invoices WHERE date LIKE $1 ORDER BY date',
    [`${year}-%`]
  );
}

// ---------- All-time ----------

export async function getAllRevenues(): Promise<DailyRevenue[]> {
  const database = await getDb();
  const rows = await database.select<DailyRevenue[]>('SELECT * FROM daily_revenue ORDER BY date');
  return rows.map(computeTotals);
}

export async function getAllInvoices(): Promise<Invoice[]> {
  const database = await getDb();
  return database.select<Invoice[]>('SELECT * FROM invoices ORDER BY date');
}

// ---------- Backup ----------

export async function exportAllData(): Promise<{revenues: DailyRevenue[], invoices: Invoice[]}> {
  const database = await getDb();
  const revenues = await database.select<DailyRevenue[]>('SELECT * FROM daily_revenue ORDER BY date');
  const invoices = await database.select<Invoice[]>('SELECT * FROM invoices ORDER BY date');
  return { revenues, invoices };
}

// ---------- Iter 11: Recurring expenses (koszty cykliczne) ----------

export type RecurringKind = 'fixed' | 'variable' | 'amortization';

export interface RecurringExpense {
  id?: number;
  name: string;
  amount: number;
  kind: RecurringKind;
  active_months: string; // CSV np "1,2,3,...,12" lub "5,6,7,8,9"
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  created_at?: string;
}

function isActiveInMonth(exp: RecurringExpense, year: number, month: number): boolean {
  const ym = `${year}-${String(month).padStart(2, '0')}-01`;
  if (exp.start_date && ym < exp.start_date.slice(0, 10)) return false;
  if (exp.end_date && ym > exp.end_date.slice(0, 10)) return false;
  const months = (exp.active_months || '').split(',').map(s => s.trim()).filter(Boolean);
  return months.includes(String(month));
}

export async function getAllRecurringExpenses(): Promise<RecurringExpense[]> {
  const database = await getDb();
  return database.select<RecurringExpense[]>(
    'SELECT * FROM expenses_recurring ORDER BY kind, name'
  );
}

export async function getActiveRecurringExpenses(year: number, month: number): Promise<RecurringExpense[]> {
  const all = await getAllRecurringExpenses();
  return all.filter(e => isActiveInMonth(e, year, month));
}

export async function getRecurringMonthlyTotal(year: number, month: number): Promise<{ fixed: number; variable: number; amortization: number; total: number }> {
  const active = await getActiveRecurringExpenses(year, month);
  const sum = (kind: RecurringKind) => active.filter(e => e.kind === kind).reduce((s, e) => s + e.amount, 0);
  const fixed = sum('fixed');
  const variable = sum('variable');
  const amortization = sum('amortization');
  return { fixed, variable, amortization, total: fixed + variable + amortization };
}

export async function addRecurringExpense(exp: Omit<RecurringExpense, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.execute(
    'INSERT INTO expenses_recurring (name, amount, kind, active_months, start_date, end_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [exp.name, exp.amount, exp.kind, exp.active_months, exp.start_date ?? null, exp.end_date ?? null, exp.notes ?? null]
  );
}

export async function updateRecurringExpense(id: number, exp: Omit<RecurringExpense, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.execute(
    'UPDATE expenses_recurring SET name=$1, amount=$2, kind=$3, active_months=$4, start_date=$5, end_date=$6, notes=$7 WHERE id=$8',
    [exp.name, exp.amount, exp.kind, exp.active_months, exp.start_date ?? null, exp.end_date ?? null, exp.notes ?? null, id]
  );
}

export async function deleteRecurringExpense(id: number): Promise<void> {
  const database = await getDb();
  await database.execute('DELETE FROM expenses_recurring WHERE id = $1', [id]);
}
