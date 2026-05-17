# README aktualizacji

## Wersja

- Wersja: `v2026.1.04`
- Wersja semver paczki Tauri/updater: `2026.1.4`
- Data: `2026-05-17`
- Typ paczki: `update`

## Zakres zmian

- Dodanie sterowania lokalnym proxy kamer w Ustawieniach → Urządzenia: `Włącz proxy`, `Restart proxy`, `Odśwież status`, `Pokaż log`, `Kopiuj log`.
- Dodanie logu proxy kamer do pliku w katalogu danych aplikacji, wraz z podglądem ostatnich wpisów bezpośrednio w aplikacji.
- Zmniejszenie komunikatu diagnostycznego na ekranie Kamer do małego paska statusu, tak aby nie zasłaniał podglądu na żywo.
- Przełączenie artefaktów updatera Windows na mały payload `nsis.zip` dla kanału NSIS, przy zachowaniu pełnego instalatora `.exe` jako fallback.

## Zmiany techniczne

- Dotknięte moduły: backend Tauri odpowiedzialny za start/restart proxy i logowanie, ekran Ustawień → Urządzenia, ekran Kamer, workflow release.
- Dotknięte pliki:
  - `src-tauri/src/lib.rs`
  - `src/components/Settings/DevicesTab.tsx`
  - `src/components/Cameras/Cameras.tsx`
  - `src-tauri/tauri.conf.json`
  - `.github/workflows/release.yml`
  - `README.md`
- Nowe komendy Tauri:
  - `camera_proxy_start`
  - `camera_proxy_restart`
  - `camera_proxy_read_log`
- Log proxy zapisuje się do pliku `camera-proxy.log` w katalogu danych aplikacji.
- `latest.json` publikuje teraz target `windows-x86_64-nsis` z małym artefaktem `*-setup.nsis.zip`; target `windows-x86_64` pozostaje jako fallback do pełnego instalatora.

## Migracja i zgodność

- Paczka jest hotfixem updaterowym dla komputerów z działającym mechanizmem auto-update.
- Zachowuje istniejące ustawienia lokalne i bazę SQLite.
- Dla Tauri updater v2 na Windows preferowany jest teraz mały artefakt `nsis.zip`; pełny `.exe` pozostaje kompatybilnym fallbackiem.
- Ustawienia kamer nadal pozostają lokalne dla danego komputera.

## Testy wykonane przed publikacją

- `cargo check --manifest-path src-tauri/Cargo.toml` — OK.
- `npm run build` — OK.
- `npm run tauri build` — OK, wygenerowano pełny instalator oraz mały artefakt `nsis.zip` z podpisami.

## Artefakty

- Pełny instalator: `Parking.OS_2026.1.4_x64-setup.exe`
- Mały payload updatera: `Parking.OS_2026.1.4_x64-setup.nsis.zip`
- Rozmiar instalatora: `81.09 MB`
- Rozmiar paczki ZIP: `81.09 MB`
- SHA-256 instalatora: `C0925EB92F332B62E3A7FDBBFA5BBD1EC82AF8424803C51866BE9DB021B77A29`
- SHA-256 paczki ZIP: `827FE4560859F83A9AFE2F53974A2AADDAA22F1EDD3553C11C6129AD9F3845A5`
- Link release: `https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.4/`

## Uwagi wdrożeniowe

- To jest pierwsza wersja, w której kanał Windows NSIS może przejść na mały payload updatera zamiast pełnego instalatora.
- W praktyce `nsis.zip` nie daje jeszcze realnie małego transferu, bo zawiera już skompresowany instalator NSIS; prawdziwe małe update będą wymagały osobnego mechanizmu różnicowego albo rozdzielenia ciężkiego runtime od aplikacji.
- Jeśli po aktualizacji proxy kamer nadal nie wystartuje, szczegóły będą dostępne bezpośrednio w aplikacji w Ustawienia → Urządzenia.
- Na ekranie Kamer komunikat o problemie z proxy nie powinien już zasłaniać obrazu.