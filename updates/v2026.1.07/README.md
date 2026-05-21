# README aktualizacji

## Wersja

- Wersja: `v2026.1.07`
- Wersja semver paczki Tauri/updater: `2026.1.7`
- Data: `2026-05-21`
- Typ paczki: `hotfix`

## Zakres zmian

- Korekta domyślnych adresów RTSP dla kamer 1 i 3 w buildzie release.
- Automatyczna migracja starych zapisanych ustawień kamer po update, ale tylko gdy nadal mają znane błędne legacy wartości.
- Ochrona przed podwójnym startem lokalnego proxy kamer w release i dev, żeby nie dochodziło do konfliktów na portach `8888`, `8554` i `8000`.

## Zmiany techniczne

- Dotknięte moduły: ustawienia kamer, autostart proxy w Rust, dev startup proxy w Vite, RTSP -> HLS proxy, release metadata.
- Dotknięte pliki:
  - `src/lib/defaultSettings.ts`
  - `src-tauri/default-settings.json`
  - `src-tauri/src/lib.rs`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `vite.config.ts`
  - `rtsp-proxy/server.js`
  - `src-tauri/tauri.conf.json`
  - `.github/workflows/release.yml`
  - `README.md`
- Dodano migrację legacy RTSP dla kamer 1 i 3 w `%APPDATA%\com.klose.parking-os\settings.json`, żeby update naprawiał stare błędne adresy bez ręcznej edycji po instalacji.
- Backend Rust wykrywa już zdrowy lokalny proxy i nie startuje drugiej instancji; jeśli port `8888` zajmuje niepełny proxy, zwracany jest jasny błąd zamiast cichego konfliktu.
- Dev plugin Vite sprawdza istniejący proxy i sprząta własne procesy po zamknięciu, więc `npm run tauri dev` nie zostawia osieroconych `node`, `ffmpeg` i `mediamtx`.
- `reqwest` ma włączone `blocking`, bo health check proxy po stronie Rust korzysta z klienta blokującego.
- `rtsp-proxy/server.js` generuje konfigurację mediamtx z `rtspTransport`, zgodnie z obecną składnią mediamtx.

## Migracja i zgodność

- Paczka migruje tylko znane błędne legacy adresy kamer 1 i 3.
- Jeżeli operator wpisał własne adresy RTSP, update ich nie nadpisuje.
- Zachowuje istniejące ustawienia lokalne, bazę SQLite i logi aplikacji.
- Nie wymaga dodatkowych zależności systemowych poza dotychczas bundlowanymi `node.exe`, `ffmpeg.exe` i `mediamtx.exe`.

## Testy wykonane przed publikacją

- `cargo check` — OK.
- `npm run build` — OK.
- `npm run tauri build` — OK, wygenerowano podpisane `setup.exe`, `setup.exe.sig`, `setup.nsis.zip` i `setup.nsis.zip.sig` dla `2026.1.7`.
- Lokalnie potwierdzono działanie wszystkich trzech kamer po poprawkach konfiguracji i konfliktów proxy.
- Po zatrzymaniu kolidujących procesów `node`, `ffmpeg` i `mediamtx` bundling release przeszedł poprawnie bez błędu `os error 32`.

## Artefakty

- Pełny instalator: `Parking.OS_2026.1.7_x64-setup.exe`
- Payload updatera: `Parking.OS_2026.1.7_x64-setup.nsis.zip`
- Rozmiar instalatora: `80.70 MB`
- Rozmiar paczki ZIP: `80.70 MB`
- SHA-256 instalatora: `B94172295B52217139B7440CDF1521079CD6E613C7B47CB57C7A06F921EFFD1B`
- SHA-256 paczki ZIP: `AC0554304F306B44C7C1106C974C72A3C6B1461D111E7C2E0504940FC7DBA893`
- Link release: `https://github.com/Hans199393/parking-os-releases/releases/tag/v2026.1.7`

## Uwagi wdrożeniowe

- Ta paczka przenosi pełen fix kamer do kanału updatera dla drugiego komputera.
- `nsis.zip` nadal waży praktycznie tyle samo co pełny instalator; to nie jest delta update.
- Jeżeli po aktualizacji kamera nadal nie ruszy, najpierw sprawdź ekran kamer, sekcję proxy w `Ustawienia -> Urządzenia` oraz log `%APPDATA%\com.klose.parking-os\camera-proxy.log`.