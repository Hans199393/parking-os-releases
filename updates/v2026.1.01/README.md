# README aktualizacji

## Wersja

- Wersja: `v2026.1.01`
- Wersja semver paczki Tauri/updater: `2026.1.1` (Tauri nie akceptuje segmentu `01` w patch version)
- Data: `2026-05-17`
- Typ paczki: `update`

## Zakres zmian

- Dodanie działającego modułu radia internetowego dla pracownika z wejściem w sidebarze, pełnym widokiem oraz małym pływającym panelem sterowania.
- Dodanie wyszukiwarki stacji, ulubionych, lokalnego zapisu preferencji oraz uprawnienia `radio.*` sterowanego przez administratora.
- Naprawa synchronizacji lokalnej: wybór per dzień w ekranie Sync faktycznie zapisuje teraz wybrane rekordy do lokalnej bazy zamiast kończyć się pozornym sukcesem bez zmian.
- Naprawa środowiska kamer na gołym systemie: update nie usuwa już bundlowanego runtime kamer, a widok kamer pokazuje diagnostykę brakującego lub martwego lokalnego proxy.
- Uzupełnienie CSP Tauri dla radia: wyszukiwarka stacji, favicony i zewnętrzne streamy HTTP/HTTPS są dozwolone także w wersji spakowanej.
- Naprawa sterowania radiem: kliknięcie karty wyników wybiera teraz stację do głównego panelu sterowania, a etykieta panelu nie udaje już aktywnej stacji.

## Założenia funkcjonalne na start

- Radio uruchamiane ręcznie po kliknięciu.
- Odtwarzanie trwa do momentu ręcznego wyłączenia przez użytkownika.
- Wiele stacji do wyboru oraz możliwość konfiguracji listy w ustawieniach.
- Ustawienia radia zapisują się lokalnie na komputerze.
- Panel radia pokazuje nazwę stacji, status i jeśli możliwe metadane nadawane przez radio, np. tytuł utworu.
- W przypadku błędu streamu użytkownik dostaje komunikat błędu.

## Zmiany techniczne

- Dotknięte moduły: `Sidebar`, `App`, `CommandPalette`, `permissions`, lokalny store, nowy moduł `Radio`, `SyncManager`, `Cameras`, backend Tauri i instalator NSIS.
- Dotknięte pliki:
	- `src/lib/permissions.ts`
	- `src/components/Sidebar/Sidebar.tsx`
	- `src/App.tsx`
	- `src/components/CommandPalette/CommandPalette.tsx`
	- `src/components/Settings/settingsTypes.ts`
	- `src/lib/defaultSettings.ts`
	- `src/lib/session.ts`
	- `src/components/Radio/Radio.tsx`
	- `src/components/Radio/radioCatalog.ts`
	- `src/components/Radio/useRadioPlayer.ts`
	- `src/components/Radio/FloatingRadioPanel.tsx`
	- `src/components/Radio/RadioFAB.tsx`
	- `src/components/Sync/SyncManager.tsx`
	- `src/components/Cameras/Cameras.tsx`
	- `src-tauri/src/lib.rs`
	- `src-tauri/nsis-hooks.nsh`
	- `src-tauri/tauri.conf.json`
- Nowe ustawienia / klucze konfiguracyjne:
	- `radio_autoplay`
	- `radio_volume`
	- `radio_muted`
	- `radio_last_station_id`
	- `radio_last_station_name`
	- `radio_last_stream_url`
	- `radio_panel_open`
	- `radio_favorites`
- Integracja katalogu stacji: publiczne API Radio Browser (`topclick` + wyszukiwanie po nazwie/tagach).
- Odtwarzanie: trwały `Audio` w root-cie aplikacji + obsługa HLS przez `hls.js` dla strumieni `.m3u8`.
- Synchronizacja: przy mieszanym wyborze `local/remote` wykonywany jest rzeczywisty merge do `daily_revenue`, a po zapisie aplikacja restartuje się żeby odświeżyć połączenia SQLite.
- Kamery: instalator zawsze zostawia `node.exe`, `ffmpeg.exe` i `rtsp-proxy`, a UI sprawdza czy proxy żyje pod `http://localhost:8888/`.
- CSP: dodane wyjątki dla `*.radio-browser.info`, zewnętrznych favicon i streamów audio `http/https`.

## Migracja i zgodność

- Paczka ma być przygotowana jako `update`.
- Ustawienia radia są prywatne dla komputera i nie powinny nadpisywać wspólnych ustawień chmurowych.
- Update do tej wersji przywraca komplet zależności kamer wymaganych na gołym systemie.
- Zmiany sync dotyczą tabeli `daily_revenue`, bo to ten zakres jest obecnie porównywany i rozstrzygany w UI.

## Testy wymagane przed publikacją

- Aktualizacja z `2026.1.0` do `2026.1.01` bez utraty obecnych ustawień.
- Test odtwarzania radia, zmiany stacji, głośności i mute.
- Test uprawnień: administrator decyduje kto może korzystać z radia.
- Test kamer na drugim laptopie.
- Test synchronizacji danych do lokalnego zapisu na drugim laptopie.
- Wykonane dotąd: `npm run build` w `parking_os` — OK.
- Wykonane dotąd: `cargo check --manifest-path src-tauri/Cargo.toml` — OK.
- Wykonane dotąd: `npm run tauri build` — OK, wygenerowano instalator NSIS.

## Artefakty

- Paczka update: `Parking.OS_2026.1.1_x64-setup.exe`
- Suma kontrolna SHA-256: `26DB22F6658DB5F614B429997E18EC9C939CEF9976AE41316C6F2D36A04350C3`
- Link pobrania: `do uzupełnienia po publikacji`

## Uwagi wdrożeniowe

- Ten plik ma być aktualizowany razem z implementacją i dołączany do każdej kolejnej paczki update.
- Ten release zamyka trzy osobne ryzyka dla `v2026.1.01`: radio w runtime Tauri, lokalny zapis po sync oraz brak runtime kamer na czystym Windowsie.
