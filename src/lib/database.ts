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
  // computed:
  coins?: number;
  banknotes?: number;
  cash?: number;
  total?: number;
  estimated_cars?: number;
}

function computeTotals(r: DailyRevenue): DailyRevenue {
  const coins = r.qty_1 * 1 + r.qty_2 * 2 + r.qty_5 * 5;
  const banknotes = r.qty_10 * 10 + r.qty_20 * 20 + r.qty_50 * 50 + r.qty_100 * 100 + r.qty_200 * 200 + r.qty_500 * 500;
  const cash = coins + banknotes;
  const total = cash + r.card + r.blik;
  return { ...r, coins, banknotes, cash, total, estimated_cars: Math.round(total / 20) };
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
    INSERT INTO daily_revenue (date, qty_1, qty_2, qty_5, qty_10, qty_20, qty_50, qty_100, qty_200, qty_500, card, blik, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(date) DO UPDATE SET
      qty_1=$2, qty_2=$3, qty_5=$4, qty_10=$5, qty_20=$6, qty_50=$7,
      qty_100=$8, qty_200=$9, qty_500=$10, card=$11, blik=$12, notes=$13
  `, [
    data.date,
    data.qty_1, data.qty_2, data.qty_5,
    data.qty_10, data.qty_20, data.qty_50, data.qty_100, data.qty_200, data.qty_500,
    data.card, data.blik, data.notes ?? ''
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

// ---------- Invoices ----------

export interface Invoice {
  id?: number;
  name: string;
  amount: number;
  date: string;
  category: 'Usługi' | 'Podatki' | 'Materiały';
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
    'INSERT INTO invoices (name, amount, date, category) VALUES ($1, $2, $3, $4)',
    [invoice.name, invoice.amount, invoice.date, invoice.category]
  );
}

export async function updateInvoice(id: number, invoice: Omit<Invoice, 'id' | 'created_at'>): Promise<void> {
  const database = await getDb();
  await database.execute(
    'UPDATE invoices SET name=$1, amount=$2, date=$3, category=$4 WHERE id=$5',
    [invoice.name, invoice.amount, invoice.date, invoice.category, id]
  );
}

export async function deleteInvoice(id: number): Promise<void> {
  const database = await getDb();
  await database.execute('DELETE FROM invoices WHERE id = $1', [id]);
}

// ---------- Backup ----------

export async function exportAllData(): Promise<{revenues: DailyRevenue[], invoices: Invoice[]}> {
  const database = await getDb();
  const revenues = await database.select<DailyRevenue[]>('SELECT * FROM daily_revenue ORDER BY date');
  const invoices = await database.select<Invoice[]>('SELECT * FROM invoices ORDER BY date');
  return { revenues, invoices };
}
