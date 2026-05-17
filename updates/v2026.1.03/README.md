# README aktualizacji

## Wersja

- Wersja: `v2026.1.03`
- Wersja semver paczki Tauri/updater: `2026.1.3`
- Data: `2026-05-17`
- Typ paczki: `update`

## Zakres zmian

- Naprawa lokalnego proxy kamer: po starcie aplikacji proxy dostaje aktualne adresy `cam*_rtsp_url` z lokalnego `settings.json`, zamiast polegać wyłącznie na wbudowanym `rtsp-proxy/.env`.
- Naprawa fałszywego czerwonego komunikatu o awarii proxy: jeśli `http://127.0.0.1:8888/` realnie odpowiada, ekran Kamer nie pokazuje już błędu tylko dlatego, że proces nie był śledzony jako child aplikacji.
- Utrzymanie fallbacku konfiguracyjnego: gdy w `settings.json` brakuje któregoś RTSP, proxy nadal może użyć wartości z `.env`, zamiast zostać uruchomione z pustą zmienną.
- Ujednolicenie ścieżek runtime proxy między dev i buildem: backend poprawnie rozpoznaje zasoby zarówno z bundla Tauri, jak i z repo podczas uruchomienia developerskiego.

## Zmiany techniczne

- Dotknięte moduły: backend Tauri odpowiedzialny za start proxy i diagnostykę kamer, skrypt `rtsp-proxy/server.js`, wersjonowanie release.
- Dotknięte pliki:
  - `src-tauri/src/lib.rs`
  - `rtsp-proxy/server.js`
  - `src-tauri/tauri.conf.json`
  - `.github/workflows/release.yml`
  - `README.md`
- Nowe ustawienia / klucze konfiguracyjne: brak.
- `server.js` zachowuje teraz priorytet: jawne zmienne środowiskowe > `.env`.

## Migracja i zgodność

- Paczka jest hotfixem updaterowym dla komputerów z działającym mechanizmem auto-update.
- Nie wymaga migracji SQLite.
- Zachowuje istniejące ustawienia lokalne.
- Nie dodaje jeszcze synchronizacji `settings.json` między komputerami; update korzysta z lokalnych ustawień kamer zapisanych na danym komputerze.

## Testy wykonane przed publikacją

- `cargo check --manifest-path src-tauri/Cargo.toml` — OK po zmianie logiki startu proxy i diagnostyki.
- `node --check rtsp-proxy/server.js` — OK.
- `cargo check --manifest-path src-tauri/Cargo.toml` — OK po dodaniu fallbacku dla pustych `CAM*_RTSP`.
- `npm run tauri build` z podpisaniem updatera `2026.1.3` — OK.

## Artefakty

- Paczka update: `Parking.OS_2026.1.3_x64-setup.exe`
- Suma kontrolna SHA-256: `80E41F8BF4723EDB9CC1AF5110BBA8A8E108225FECF1FC6AA5FF20BEB66CFFBB`
- Link pobrania: `https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.3/Parking.OS_2026.1.3_x64-setup.exe`

## Uwagi wdrożeniowe

- Ten update naprawia dwa problemy jednocześnie: fałszywy banner diagnostyczny oraz rozjazd między ustawieniami kamer w aplikacji a konfiguracją używaną przez lokalny proxy.
- Jeśli po aktualizacji drugi komputer nadal nie pokaże obrazu, trzeba sprawdzić jego lokalny `settings.json`, bo ten update nie synchronizuje ustawień kamer między maszynami.