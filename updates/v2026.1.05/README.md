# README aktualizacji

## Wersja

- Wersja: `v2026.1.05`
- Wersja semver paczki Tauri/updater: `2026.1.5`
- Data: `2026-05-17`
- Typ paczki: `hotfix`

## Zakres zmian

- Hotfix startu lokalnego proxy kamer w buildzie Windows instalowanym przez updater.
- Normalizacja ścieżek runtime przekazywanych do Node.js przed startem `rtsp-proxy/server.js`.
- Usunięcie błędu `EISDIR: illegal operation on a directory, lstat 'C:'`, który blokował start proxy po instalacji na drugim komputerze.

## Zmiany techniczne

- Dotknięte moduły: backend Tauri odpowiedzialny za rozpoznanie ścieżek runtime i start procesu Node.
- Dotknięte pliki:
  - `src-tauri/src/lib.rs`
  - `src-tauri/tauri.conf.json`
  - `.github/workflows/release.yml`
  - `README.md`
- Na Windows ścieżki z prefiksem `\\?\` są przed użyciem normalizowane do standardowej postaci `C:\...`.
- Fix dotyczy ścieżek do `resource_dir`, `node.exe`, `ffmpeg.exe` i `server.js` wykorzystywanych przy starcie lokalnego proxy RTSP → HLS.

## Migracja i zgodność

- Paczka jest hotfixem updaterowym dla komputerów z działającym mechanizmem auto-update.
- Zachowuje istniejące ustawienia lokalne i bazę SQLite.
- Nie zmienia konfiguracji kamer ani logiki UI; naprawia wyłącznie start procesu proxy w buildzie Windows.

## Testy wykonane przed publikacją

- `cargo check --manifest-path src-tauri/Cargo.toml` — OK.
- `node "\\?\...\server.js"` — odtworzono błąd `EISDIR` na Node 25.
- `node --check` dla zwykłej ścieżki do `server.js` — OK.
- `npm run tauri build` — OK, wygenerowano podpisany instalator oraz `nsis.zip` z podpisami.

## Artefakty

- Pełny instalator: `Parking.OS_2026.1.5_x64-setup.exe`
- Mały payload updatera: `Parking.OS_2026.1.5_x64-setup.nsis.zip`
- Rozmiar instalatora: `81.06 MB`
- Rozmiar paczki ZIP: `81.06 MB`
- SHA-256 instalatora: `771C7C1EF30DC5AC1D46AE9ECD610BA40E4AC7F22244F57BE749A47089FF59B1`
- SHA-256 paczki ZIP: `DB6DA689A908CA30AAD5E82DA00600340D03F259002C0485F27835339D288802`
- Link release: `https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.5/`

## Uwagi wdrożeniowe

- To jest hotfix tylko dla problemu startu proxy w buildzie instalacyjnym.
- Jeżeli po aktualizacji proxy nadal nie wystartuje, nowy log `camera-proxy.log` powinien już pokazać rzeczywisty błąd runtime zamiast crashu Node na ścieżce wejściowej.
- Kanał updatera zostaje bez zmian: preferowany `windows-x86_64-nsis`, fallback `windows-x86_64`.
