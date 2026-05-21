# README aktualizacji

## Wersja

- Wersja: `v2026.1.06`
- Wersja semver paczki Tauri/updater: `2026.1.6`
- Data: `2026-05-21`
- Typ paczki: `hotfix`

## Zakres zmian

- Hotfix startu lokalnego proxy kamer po instalacji przez updater.
- Usunięcie zależności runtime proxy od `express` i zewnętrznego `node_modules`.
- Zachowanie tego samego API proxy (`/`, `/stream/*`, `/ptz/:camId`) przy starcie z wbudowanego `node.exe`.

## Zmiany techniczne

- Dotknięte moduły: lokalny RTSP -> HLS proxy, konfiguracja bundla Tauri, release workflow, dokumentacja update.
- Dotknięte pliki:
  - `rtsp-proxy/server.js`
  - `src-tauri/tauri.conf.json`
  - `.github/workflows/release.yml`
  - `README.md`
- Proxy zostal przepisany z `express` na wbudowany serwer `http` z Node.js.
- Endpointy `GET /`, `GET/HEAD /stream/*`, `POST /ptz/:camId` i obsluga CORS/JSON dzialaja bez paczek npm.
- Z bundla Tauri usunieto zasoby `rtsp-proxy/package.json` i `rtsp-proxy/node_modules/**/*`, bo updater na Windows potrafil rozkladac te pliki w runtime w sposob niezgodny z oczekiwaniami Node.
- Fix usuwa blad runtime `Cannot find module 'body-parser'`, ktory blokowal autostart kamer po aktualizacji.

## Migracja i zgodność

- Paczka jest hotfixem updaterowym dla komputerow z dzialajacym mechanizmem auto-update.
- Zachowuje istniejące ustawienia lokalne i baze SQLite.
- Nie zmienia konfiguracji kamer ani logiki UI; naprawia wyłącznie start procesu proxy w buildzie Windows.
- Nie wymaga dodatkowych zaleznosci systemowych poza dotychczasowym bundlowanym `node.exe`, `ffmpeg.exe` i `mediamtx.exe`.

## Testy wykonane przed publikacją

- `npm run tauri build` — OK, wygenerowano podpisany instalator oraz `nsis.zip` dla `2026.1.6`.
- Uruchomienie `src-tauri/target/release/bin/node.exe src-tauri/target/release/rtsp-proxy/server.js` — OK, proxy startuje bez bledu `express` / `body-parser`.
- `Invoke-RestMethod http://127.0.0.1:8899/` na release runtime — OK, status `running` i lista kamer zwracana poprawnie.
- Wczesniejszy log z `%APPDATA%\com.klose.parking-os\camera-proxy.log` wskazywal rzeczywista przyczyne awarii: `Cannot find module 'body-parser'` po updaterze.

## Artefakty

- Pełny instalator: `Parking.OS_2026.1.6_x64-setup.exe`
- Mały payload updatera: `Parking.OS_2026.1.6_x64-setup.nsis.zip`
- Rozmiar instalatora: `80.66 MB`
- Rozmiar paczki ZIP: `80.66 MB`
- SHA-256 instalatora: `51C9B5CF2A1DAF5C9004E6A6885A3C295186FE8BFAD7FDD88637C1254C9B4D07`
- SHA-256 paczki ZIP: `04350E1F53CBC003B4759B94F7550E44D56811433CF3FB9723A62AC8144285EF`
- Link release: `https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.6/`

## Uwagi wdrożeniowe

- To jest hotfix tylko dla problemu startu proxy kamer po updaterze.
- Po instalacji / aktualizacji warto sprawdzić `%APPDATA%\com.klose.parking-os\camera-proxy.log`, jeśli kamera nadal nie ruszy z powodu samego RTSP lub ffmpeg.
- Lokalny katalog `target/release` moze zachowac stare `node_modules` z poprzednich buildow, ale nowy `server.js` nie korzysta juz z tych zaleznosci.
- Kanał updatera zostaje bez zmian: preferowany `windows-x86_64-nsis`, fallback `windows-x86_64`.
