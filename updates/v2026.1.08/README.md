# README aktualizacji

## Wersja

- Wersja: `v2026.1.08`
- Wersja semver paczki Tauri/updater: `2026.1.8`
- Data: `2026-05-23`
- Typ paczki: `security hotfix`

## Zakres zmian

- Naprawa desktopowego Orła: aplikacja pokazuje teraz czytelne błędy dla nieważnego klucza API, złego endpointu, limitu zapytań i problemów sieciowych.
- Ukrycie sekretów integracji w trybie tylko do odczytu, żeby operator bez uprawnienia `settings.edit_integrations` nie widział kluczy i haseł.
- Domknięcie porządków bezpieczeństwa po wcześniejszym wycieku: puste domyślne sekrety w buildzie oraz guardraile skanowania sekretów w repo.
- Release nie bundluje już lokalnego `rtsp-proxy/.env`, więc updater buduje się i działa z czystego źródła bez prywatnego pliku środowiskowego.

## Zmiany techniczne

- Dotknięte moduły: desktopowy klient Orzeł, panel Integracje, domyślne ustawienia Tauri, skanowanie sekretów, workflow release.
- Dotknięte pliki:
  - `src/lib/orzelAssistant.ts`
  - `src/components/Chat/OrzelAssistantPanel.tsx`
  - `src/components/Settings/IntegrationsTab.tsx`
  - `src/lib/defaultSettings.ts`
  - `src-tauri/default-settings.json`
  - `src-tauri/src/lib.rs`
  - `src-tauri/tauri.conf.json`
  - `scripts/secret-scan.mjs`
  - `.githooks/pre-commit`
  - `.github/workflows/secret-scan.yml`
- Nowe ustawienia / klucze konfiguracyjne:
  - `orzel_api_base_url` jako jawny endpoint OpenAI-compatible dla desktopowego Orła.

## Migracja i zgodność

- Nie wymaga migracji bazy danych ani ręcznej zmiany danych aplikacji.
- Zachowuje istniejące ustawienia lokalne i dane SQLite.
- WWW i Messenger nie są zmieniane przez ten update; desktopowy Orzeł nadal wymaga ważnego lokalnego klucza API w ustawieniach aplikacji.

## Testy wykonane przed publikacją

- `cargo check` — OK.
- `npm run build` — OK.
- `npm run tauri build` — OK, wygenerowano podpisane `setup.exe`, `setup.exe.sig`, `setup.nsis.zip` i `setup.nsis.zip.sig` dla `2026.1.8`.

## Artefakty

- Pełny instalator: `Parking.OS_2026.1.8_x64-setup.exe`
- Payload updatera: `Parking.OS_2026.1.8_x64-setup.nsis.zip`
- Podpis instalatora: `Parking.OS_2026.1.8_x64-setup.exe.sig`
- Podpis paczki ZIP: `Parking.OS_2026.1.8_x64-setup.nsis.zip.sig`
- Rozmiar instalatora: `80.72 MB`
- Rozmiar paczki ZIP: `80.72 MB`
- SHA-256 instalatora: `A6C12B9168EFB2C1901DEE7BDCC1675C7D1AAF45B96ED77311C9E3F2CCB58D8C`
- SHA-256 paczki ZIP: `919CEDB99C1D68B9036F546AB11A10E4C3658D17622C240C93B9120CCE778566`
- Link release: `https://github.com/Hans199393/parking-os-releases/releases/tag/v2026.1.8`

## Uwagi wdrożeniowe

- Po aktualizacji sprawdź w Parking.OS `Ustawienia -> Integracje -> AI Asystent`, czy desktopowy klucz API jest ważny.
- Ta paczka nie rusza konfiguracji WWW ani Messengera; dotyczy tylko aplikacji desktopowej i jej zabezpieczeń.
- Kanał updatera dalej używa `latest.json` oraz `*.nsis.zip`; to nie jest delta update i transfer będzie zbliżony do pełnego instalatora.