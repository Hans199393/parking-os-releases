# Parking.OS — System Zarządzania Parkingiem

Desktopowa aplikacja dla operatora parkingu Sobieszewo (Gdańsk).  
Zbudowana na Tauri v2 + React 19 + TypeScript + Vite.

---

## Funkcje

- **Finanse dzienne** — formularz zamknięcia kasy (saszetka, gotówka, bezgotówkowe)
- **Inwestycje** — ewidencja kosztów inwestycyjnych z podziałem na kategorie
- **Statystyki** — przychody, obłożenie, pogoda/temperatura
- **Ustawienia** — prowizja bezgotówkowa, zarządzanie extra-dniami

## Wymagania

- Windows 10/11 (64-bit)
- WebView2 Runtime (instaluje się automatycznie przez instalator .msi)
- Supabase — własne konto lub dostęp do wspólnej bazy `qgqevlkjwinxrtdgdedy`

## Uruchomienie (development)

```bash
cd parking_os
npm install
npm run tauri dev
```

## Build (production)

```bash
npm run tauri build
# Instalator: src-tauri/target/release/bundle/msi/
```

## Dokumentacja aktualizacji

Każda paczka update musi mieć własny plik `README.md` opisujący zakres zmian, testy i artefakty.

- Szablon: `updates/README_TEMPLATE.md`
- Bieżąca dokumentacja update: `updates/v2026.1.07/README.md`

Konfiguracja środowiska — zmienne w `src-tauri/tauri.conf.json` i Tauri Secrets.  
Wartości `SUPABASE_URL` i `SUPABASE_ANON_KEY` są wbudowane w build (patrz `src/supabase.ts`).

## Struktura

```
src/
  App.tsx           — routing + layout
  Finances.tsx      — formularz dzienny (główny widok)
  Investments.tsx   — lista inwestycji
  Settings.tsx      — konfiguracja
  database.ts       — warstwa danych (Supabase client)
  session.ts        — auth (Supabase Auth)
src-tauri/
  src/main.rs       — entry point Tauri (okno + tray)
  tauri.conf.json   — konfiguracja buildu
sql/                — migracje bazy danych (Supabase)
```

## Baza danych

Wspólna baza Supabase z `parking_botaimess`. Migracje w `sql/`.  
Nowe migracje numeruj od kolejnego numeru i uruchamiaj przez Supabase Dashboard → SQL Editor.

## Plan dalszego rozwoju

Szczegóły w [PLAN_IMPLEMENTACJI.md](PLAN_IMPLEMENTACJI.md).
