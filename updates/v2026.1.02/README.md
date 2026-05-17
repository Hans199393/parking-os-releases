# README aktualizacji

## Wersja

- Wersja: `v2026.1.02`
- Wersja semver paczki Tauri/updater: `2026.1.2`
- Data: `2026-05-17`
- Typ paczki: `update`

## Zakres zmian

- Dodanie paska postępu dla updatera z informacją o pobranych danych, całkowitym rozmiarze paczki, liczbie MB pozostałych do pobrania oraz rozmiarze ostatniego chunku.
- Stabilizacja ładowania modułu Finanse: ekran ładuje sekcje sekwencyjnie zamiast odpalać kilka równoległych zapytań do lokalnej bazy na starcie.
- Uściślenie błędów w module Finanse: jeśli któraś część ładowania nadal padnie, komunikat pokazuje teraz konkretny zakres (`Przychody`, `Faktury`, `Inwestycje`, `Suma przychodów`).

## Zmiany techniczne

- Dotknięte moduły: `SystemTab`, `Finances`, wersjonowanie Tauri, workflow release, dokumentacja update.
- Dotknięte pliki:
	- `src/components/Settings/SystemTab.tsx`
	- `src/components/Finances/Finances.tsx`
	- `src-tauri/tauri.conf.json`
	- `.github/workflows/release.yml`
	- `README.md`
	- `src-tauri/nsis-hooks.nsh`
- Nowe ustawienia / klucze konfiguracyjne: brak.
- Updater korzysta z eventów `Started` i `Progress` z `@tauri-apps/plugin-updater`, więc pasek postępu nie wymaga zmian po stronie backendu Tauri.

## Migracja i zgodność

- Paczka ma być publikowana jako `update` dla komputerów, które już mają działający mechanizm auto-update.
- Nie wymaga migracji danych SQLite.
- Zachowuje istniejące ustawienia lokalne i zdalne.
- Nie rozwiązuje jeszcze synchronizacji lokalnych ustawień kamer między komputerami, ponieważ bieżący Sync przenosi bazę `parking_os.db`, a nie `settings.json`.

## Testy wykonane przed publikacją

- `npm run build` w `parking_os` po zmianie w `Finances.tsx` — OK.
- `npm run build` w `parking_os` po zmianie w `SystemTab.tsx` — OK.
- Bezpośredni odczyt lokalnej bazy devowej: `PRAGMA integrity_check` — `ok`.
- Bezpośrednie zapytania SQL używane przez ekran Finanse wykonują się poprawnie na lokalnej bazie devowej.

## Artefakty

- Paczka update: `Parking.OS_2026.1.2_x64-setup.exe`
- Suma kontrolna SHA-256: `F5209E0EDCFD1881418ECB8FF50FBAF14DFA9FE273DDFE99C3DBDAE9FC6A1BAB`
- Link pobrania: `https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.2/Parking.OS_2026.1.2_x64-setup.exe`

## Uwagi wdrożeniowe

- Ten update jest przygotowany po to, żeby drugi komputer mógł pobrać poprawki przez auto-updater bez ręcznej instalacji.
- Jeśli po aktualizacji drugi komputer nadal nie pokaże kamer, to problem pozostaje w lokalnych ustawieniach kamer / proxy, a nie w samej paczce updatera.