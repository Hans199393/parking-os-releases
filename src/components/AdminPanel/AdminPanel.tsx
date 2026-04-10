import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, MessageSquare } from 'lucide-react';
import { getConfig, setConfig, getSupabaseClient, getExtraOpenDays, addExtraOpenDay, toggleExtraOpenDay, deleteExtraOpenDay, ExtraOpenDay } from '../../lib/supabase';
import { getStore } from '../../lib/store';
import { Button, Spinner, Input } from '../shared/UI';

export default function AdminPanel() {
  const [parkingFull, setParkingFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [iframeKey, setIframeKey] = useState(0);

  // Extra open days state
  const [extraDays, setExtraDays] = useState<ExtraOpenDay[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newNote, setNewNote] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  // Authorized PSIDs for ?tablica bot command
  const [authorizedPsids, setAuthorizedPsids] = useState<string[]>([]);
  const [psidInput, setPsidInput] = useState('');
  const [psidSaving, setPsidSaving] = useState(false);
  const [psidError, setPsidError] = useState('');

  useEffect(() => {
    loadStatus();
    getStore().then(async s => {
      setAdminUrl(await s.get<string>('admin_url') ?? '');
    });
    loadExtraDays();
    loadAuthorizedPsids();
  }, []);

  const loadExtraDays = useCallback(async () => {
    setExtraLoading(true);
    try {
      const data = await getExtraOpenDays();
      setExtraDays(data);
    } catch {
      setExtraDays([]);
    } finally {
      setExtraLoading(false);
    }
  }, []);

  const loadAuthorizedPsids = useCallback(async () => {
    try {
      const raw = await getConfig('authorized_psids');
      if (raw) {
        const parsed = JSON.parse(raw);
        setAuthorizedPsids(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setAuthorizedPsids([]);
    }
  }, []);

  async function loadStatus() {
    setLoading(true);
    setError('');
    setNotConfigured(false);
    try {
      const client = await getSupabaseClient();
      if (!client) { setNotConfigured(true); return; }
      const val = await getConfig('spots_available');
      // spots_available='false' oznacza brak miejsc
      setParkingFull(val === 'false');
      setLastUpdated(new Date().toLocaleTimeString('pl-PL'));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('skonfigurowany') || msg.includes('URL') || msg.includes('key')) {
        setNotConfigured(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    setSaving(true);
    setError('');
    try {
      const newVal = !parkingFull;
      // spots_available='false' = brak miejsc, 'true' = wolne
      await setConfig('spots_available', newVal ? 'false' : 'true');
      setParkingFull(newVal);
      setLastUpdated(new Date().toLocaleTimeString('pl-PL'));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu do Supabase');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddExtraDay() {
    setAddError('');
    if (!newDate) { setAddError('Wybierz datę.'); return; }
    // Convert YYYY-MM-DD (input type=date) to DD.MM.YYYY
    const [y, m, d] = newDate.split('-');
    const formatted = `${d}.${m}.${y}`;
    setAddSaving(true);
    try {
      await addExtraOpenDay(formatted, newNote.trim() || undefined);
      setNewDate('');
      setNewNote('');
      const updated = await getExtraOpenDays();
      setExtraDays(updated);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setAddSaving(false);
    }
  }

  async function handleToggleExtra(id: number, active: boolean) {
    try {
      await toggleExtraOpenDay(id, active);
      const updated = await getExtraOpenDays();
      setExtraDays(updated);
    } catch { /* ignore */ }
  }

  async function handleDeleteExtra(id: number) {
    try {
      await deleteExtraOpenDay(id);
      const updated = await getExtraOpenDays();
      setExtraDays(updated);
    } catch { /* ignore */ }
  }

  async function handleAddPsid() {
    const psid = psidInput.trim();
    setPsidError('');
    if (!psid) { setPsidError('Wpisz PSID.'); return; }
    if (!/^\d{10,20}$/.test(psid)) { setPsidError('PSID to ciąg 10–20 cyfr.'); return; }
    if (authorizedPsids.includes(psid)) { setPsidError('Ten PSID już istnieje.'); return; }
    setPsidSaving(true);
    try {
      const updated = [...authorizedPsids, psid];
      await setConfig('authorized_psids', JSON.stringify(updated));
      setAuthorizedPsids(updated);
      setPsidInput('');
    } catch (e: unknown) {
      setPsidError(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setPsidSaving(false);
    }
  }

  async function handleRemovePsid(psid: string) {
    try {
      const updated = authorizedPsids.filter(p => p !== psid);
      await setConfig('authorized_psids', JSON.stringify(updated));
      setAuthorizedPsids(updated);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Panel WWW</h1>
        <p className="text-[var(--color-text-muted)] text-sm mt-1">Zarządzanie stroną parkingu</p>
      </div>

      {/* Górny pasek: toggle Brak miejsc */}
      <div className="px-6 py-3 border-b border-[var(--color-border)] flex-shrink-0 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--color-text)]">Brak miejsc:</span>
          {loading ? (
            <Spinner />
          ) : notConfigured ? (
            <span className="text-xs text-amber-500">⚠️ skonfiguruj Supabase w Ustawieniach</span>
          ) : (
            <>
              <button
                onClick={toggle}
                disabled={saving}
                className={`relative inline-flex h-6 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${parkingFull ? 'bg-red-500' : 'bg-slate-600'}`}
                style={{ width: '2.75rem' }}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${parkingFull ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${parkingFull ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {parkingFull ? '🚫 PEŁNY' : '✅ WOLNE'}
              </span>
              {lastUpdated && <span className="text-xs text-[var(--color-text-muted)]">({lastUpdated})</span>}
            </>
          )}
        </div>

        {error && <span className="text-xs text-red-500">{error}</span>}

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={loadStatus} disabled={loading}>Odśwież</Button>
          <Button variant="secondary" onClick={() => setIframeKey(k => k + 1)}>🔄 Przeładuj CMS</Button>
        </div>
      </div>

      {/* Sekcja: Dodatkowe dni otwarte */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-[var(--color-text)]">Dodatkowe dni otwarte</span>
          <span className="text-xs text-slate-500">(poza harmonogramem — widoczne w kalendarzu rezerwacji)</span>
        </div>

        {/* Formularz dodawania */}
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Data</label>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-teal-500"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs text-slate-400">Notatka (opcjonalna)</label>
            <input
              type="text"
              placeholder="np. Dodatkowy dzień — promocja"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
          </div>
          <Button variant="primary" onClick={handleAddExtraDay} loading={addSaving} size="sm">
            <Plus size={14} /> Dodaj
          </Button>
        </div>
        {addError && <p className="text-xs text-red-400 mb-2">{addError}</p>}

        {/* Lista dni */}
        {extraLoading ? (
          <Spinner />
        ) : extraDays.length === 0 ? (
          <p className="text-xs text-slate-500">Brak dodatkowych dni otwartych.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {extraDays.map(d => (
              <div key={d.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 border text-sm ${d.active ? 'bg-teal-500/10 border-teal-500/30' : 'bg-slate-800/40 border-slate-700 opacity-60'}`}>
                <span className="font-mono font-semibold text-white w-24">{d.date}</span>
                <span className="flex-1 text-slate-400 text-xs truncate">{d.note ?? '—'}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${d.active ? 'bg-teal-500/20 text-teal-400' : 'bg-slate-700 text-slate-400'}`}>
                  {d.active ? 'aktywny' : 'wyłączony'}
                </span>
                <button
                  onClick={() => handleToggleExtra(d.id, !d.active)}
                  className="text-slate-400 hover:text-teal-400 transition-colors"
                  title={d.active ? 'Wyłącz' : 'Włącz'}
                >
                  {d.active ? <ToggleRight size={18} className="text-teal-400" /> : <ToggleLeft size={18} />}
                </button>
                <button
                  onClick={() => handleDeleteExtra(d.id)}
                  className="text-slate-400 hover:text-red-400 transition-colors"
                  title="Usuń"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

          </div>
        )}
      </div>

      {/* Sekcja: Autoryzowane konta Messenger (bot ?tablica) */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-teal-400" />
          <span className="text-sm font-semibold text-[var(--color-text)]">Autoryzowane konta Messenger</span>
          <span className="text-xs text-slate-500">(dostęp do komendy <code className="bg-slate-800 px-1 rounded font-mono">?tablica</code> w bocie)</span>
        </div>
        <div className="flex items-end gap-2 mb-3">
          <div className="flex flex-col gap-1 flex-1 max-w-xs">
            <label className="text-xs text-slate-400">PSID (wyślij <code className="bg-slate-800 px-1 rounded font-mono">!myid</code> do bota)</label>
            <Input
              value={psidInput}
              onChange={e => setPsidInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddPsid()}
              placeholder="np. 123456789012345"
              className="font-mono text-sm"
            />
          </div>
          <Button variant="primary" onClick={handleAddPsid} loading={psidSaving} size="sm">
            <Plus size={14} /> Dodaj
          </Button>
        </div>
        {psidError && <p className="text-xs text-red-400 mb-2">{psidError}</p>}
        {authorizedPsids.length === 0 ? (
          <p className="text-xs text-slate-500">Brak autoryzowanych kont — nikt nie może używać komendy ?tablica.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {authorizedPsids.map(psid => (
              <div key={psid} className="flex items-center gap-3 rounded-lg px-3 py-2 bg-slate-800/60 border border-slate-700">
                <span className="flex-1 font-mono text-sm text-white tracking-wider">{psid}</span>
                <button
                  onClick={() => handleRemovePsid(psid)}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                  title="Usuń"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Główna sekcja: iframe CMS */}
      <div className="flex-1 min-h-0">
        {adminUrl ? (
          <iframe
            key={iframeKey}
            src={adminUrl}
            className="w-full h-full border-0"
            title="Panel CMS"
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <span className="text-5xl">🌐</span>
            <div>
              <p className="font-semibold text-[var(--color-text)] mb-1">Nie ustawiono adresu panelu CMS</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Przejdź do <strong>Ustawienia</strong> i wpisz URL w polu<br />
                <em>"URL panelu CMS (strona administracyjna)"</em>
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Np. <code className="bg-[var(--color-border)] px-1 rounded">https://twoja-domena.pl/zaplecze-mk</code>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
