# Instrukcja Update I Publikacji Na GitHub

Stan na: `2026-05-21`

Ten dokument opisuje poprawny proces wypuszczania nowego update dla `Parking.OS`, razem z pushem na GitHub i publikacją tak, aby drugi komputer mógł pobrać wersję przez `Ustawienia -> System -> Sprawdź aktualizacje`.

## Najważniejsze zasady

- Wersję updatera kontroluje `src-tauri/tauri.conf.json`, nie `package.json`.
- Tag releasu ma format `v2026.1.6`, a wersja semver w Tauri ma format `2026.1.6`.
- Folder dokumentacji update ma format `updates/v2026.1.06/README.md`.
- Asset w release musi nazywać się dokładnie `latest.json`.
- `latest.json` musi byc zapisany jako UTF-8 bez BOM. BOM potrafi wywolac w aplikacji blad `error decoding response body` przy `Sprawdz aktualizacje`.
- Release musi zawierać komplet plików:
  - `Parking.OS_<wersja>_x64-setup.exe`
  - `Parking.OS_<wersja>_x64-setup.exe.sig`
  - `Parking.OS_<wersja>_x64-setup.nsis.zip`
  - `Parking.OS_<wersja>_x64-setup.nsis.zip.sig`
  - `latest.json`
- Nie wrzucać do commita śmieci runtime, szczególnie:
  - `rtsp-proxy/hls_output/*`
  - stare pliki w `downloads/*`
- Jeśli przy podpisywaniu pojawia się `Password:`, wciskasz pusty Enter.
- `nsis.zip` jest kanałem updatera, ale obecnie nie daje realnie małego transferu. To nie jest delta update.

## Krok 1. Sprawdzenie repo przed pracą

Uruchom:

```powershell
Set-Location "g:\parking_2026\parking_os"
git status --short
```

Przed dalszą pracą upewnij się, że:

- zmienione są tylko pliki związane z fixem lub featurem,
- nie ma przypadkowo staged `hls_output`,
- nie ma przypadkowo staged starych instalatorów i plików z `downloads`.

Jeśli chcesz zrobić kopię bezpieczeństwa przed release:

```powershell
$dst = "g:\parking_2026\parking_backup\v2026.1.x_$(Get-Date -Format 'yyyy-MM-dd_HHmm')"
Copy-Item "g:\parking_2026\parking_os" $dst -Recurse -Exclude @("target","node_modules",".git")
Write-Host "Kopia: $dst"
```

## Krok 2. Podbicie wersji i dokumentacji

Zmień wersję w tych miejscach:

1. `src-tauri/tauri.conf.json`
   - ustaw `"version": "2026.1.X"`
2. `.github/workflows/release.yml`
   - ustaw domyślny tag workflow na `v2026.1.X`
3. `README.md`
   - ustaw wskaźnik na nowy plik `updates/v2026.1.0X/README.md`
4. utwórz nowy plik dokumentacji update:
   - `updates/v2026.1.0X/README.md`

W praktyce:

- semver updatera: `2026.1.6`
- tag Git: `v2026.1.6`
- folder z dokumentacją: `updates/v2026.1.06/README.md`

Do nowego pliku release notes używaj szablonu:

- `updates/README_TEMPLATE.md`

## Krok 3. Walidacja lokalna przed buildem release

Uruchom minimalny zestaw walidacji:

```powershell
Set-Location "g:\parking_2026\parking_os"
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Jeżeli zmiana dotyczy tylko backendu Rust, `cargo check` jest obowiązkowe.

Jeżeli zmiana dotyczy frontendu, `npm run build` jest obowiązkowe.

Jeżeli zmiana dotyczy update lub bundla, finalnie i tak musi przejść pełny build Tauri.

## Krok 4. Signed build release

Uruchom build z kluczem podpisującym:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "g:\parking_2026\tauri-signing-key.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
Set-Location "g:\parking_2026\parking_os"
npm run tauri build
```

Jeżeli terminal pokaże `Password:`, wciskasz pusty Enter.

Po poprawnym buildzie powinny powstać pliki:

- `src-tauri/target/release/bundle/nsis/Parking.OS_<wersja>_x64-setup.exe`
- `src-tauri/target/release/bundle/nsis/Parking.OS_<wersja>_x64-setup.exe.sig`
- `src-tauri/target/release/bundle/nsis/Parking.OS_<wersja>_x64-setup.nsis.zip`
- `src-tauri/target/release/bundle/nsis/Parking.OS_<wersja>_x64-setup.nsis.zip.sig`

## Krok 5. Sumy kontrolne i rozmiary

Po buildzie zbierz nazwy, rozmiary i SHA-256:

```powershell
Set-Location "g:\parking_2026\parking_os"
$version = '2026.1.6'
$exe = Get-Item "src-tauri\target\release\bundle\nsis\Parking.OS_${version}_x64-setup.exe"
$zip = Get-Item "src-tauri\target\release\bundle\nsis\Parking.OS_${version}_x64-setup.nsis.zip"

[ordered]@{
  exeName = $exe.Name
  exeSizeMB = [math]::Round($exe.Length / 1MB, 2)
  exeSha256 = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash
  zipName = $zip.Name
  zipSizeMB = [math]::Round($zip.Length / 1MB, 2)
  zipSha256 = (Get-FileHash $zip.FullName -Algorithm SHA256).Hash
} | ConvertTo-Json
```

Następnie uzupełnij nowy plik `updates/v2026.1.0X/README.md` o:

- zakres zmian,
- testy,
- artefakty,
- sumy kontrolne,
- link release.

## Krok 6. Push kodu na GitHub

Nie rób ślepo `git add -A`, jeśli repo ma śmieci runtime. Lepiej dodawać tylko właściwe pliki.

Przykład:

```powershell
Set-Location "g:\parking_2026\parking_os"
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json .github/workflows/release.yml README.md updates/v2026.1.06/README.md
git commit -m "fix(cameras): opis zmian"
git push
```

Jeżeli zmieniałeś inne pliki releasowe, dodaj tylko te konkretne pliki.

## Krok 7. Tag releasu

Po pushu tworzysz albo przepinasz tag:

```powershell
Set-Location "g:\parking_2026\parking_os"
git tag -f v2026.1.6
git push origin refs/tags/v2026.1.6 --force
```

To powinno uruchomić workflow release na GitHub Actions.

## Krok 8. Weryfikacja workflow release

Sprawdź, czy workflow ruszył i czy nie padł wcześnie:

```powershell
$ProgressPreference = 'SilentlyContinue'
Invoke-RestMethod -Uri "https://api.github.com/repos/Hans199393/parking-os-releases/actions/runs?per_page=5" -Headers @{ 'User-Agent' = 'Copilot' } |
  ConvertTo-Json -Depth 5
```

Najczęstsze rzeczy do sprawdzenia:

- czy run jest na właściwym tagu `v2026.1.X`,
- czy `Setup Node.js 22` nie padł,
- czy workflow doszedł do `Create GitHub Release`.

Ważne: w tym repo workflow działa z roota repo, więc ścieżki w `.github/workflows/release.yml` muszą wskazywać bez prefiksu `parking_os/`.

Poprawne przykłady:

- `package-lock.json`
- `src-tauri/...`

Błędne przykłady:

- `parking_os/package-lock.json`
- `parking_os/src-tauri/...`

## Krok 9. Weryfikacja publicznego manifestu updatera

Po publikacji sprawdź publiczny `latest.json`:

```powershell
$ProgressPreference = 'SilentlyContinue'
$json = Invoke-RestMethod -Uri "https://github.com/Hans199393/parking-os-releases/releases/latest/download/latest.json" -Headers @{ 'User-Agent' = 'Copilot' }

[ordered]@{
  version = $json.version
  nsisZipUrl = $json.platforms.'windows-x86_64-nsis'.url
  nsisZipSignaturePresent = [string]::IsNullOrWhiteSpace($json.platforms.'windows-x86_64-nsis'.signature) -eq $false
  fallbackExeUrl = $json.platforms.'windows-x86_64'.url
  fallbackSignaturePresent = [string]::IsNullOrWhiteSpace($json.platforms.'windows-x86_64'.signature) -eq $false
} | ConvertTo-Json
```

Jesli chcesz sprawdzic surowe bajty pliku i upewnic sie, ze nie ma BOM, uzyj:

```powershell
$tmp = Join-Path $env:TEMP 'parking_os_public_latest_curl.bin'
curl.exe -L -A Copilot -o $tmp "https://github.com/Hans199393/parking-os-releases/releases/latest/download/latest.json"
Format-Hex -Path $tmp | Select-Object -First 4
```

Pierwszy bajt powinien zaczynac sie od `{`, a nie od `EF BB BF`.

To musi potwierdzić:

- nową wersję,
- URL do `nsis.zip`,
- URL fallback do `.exe`,
- obecność obu podpisów.

## Krok 10. Weryfikacja publicznego release

Sprawdź, czy GitHub release istnieje i ma komplet assetów:

```powershell
$ProgressPreference = 'SilentlyContinue'
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Hans199393/parking-os-releases/releases/tags/v2026.1.6" -Headers @{ 'User-Agent' = 'Copilot' }
$release.assets | Select-Object -ExpandProperty name
```

Na liście powinny być:

- `latest.json`
- `Parking.OS_2026.1.6_x64-setup.exe`
- `Parking.OS_2026.1.6_x64-setup.exe.sig`
- `Parking.OS_2026.1.6_x64-setup.nsis.zip`
- `Parking.OS_2026.1.6_x64-setup.nsis.zip.sig`

## Krok 11. Test na drugim komputerze

Na komputerze docelowym:

1. uruchom aplikację,
2. wejdź w `Ustawienia -> System`,
3. kliknij `Sprawdź aktualizacje`,
4. potwierdź, że wykrywana jest nowa wersja,
5. po aktualizacji sprawdź, czy fix rzeczywiście działa.

Jeżeli update dotyczy kamer, sprawdź od razu:

- ekran kamer,
- `Ustawienia -> Urządzenia -> Proxy`,
- log `camera-proxy.log`, jeśli problem nie zniknął.

## Ścieżka awaryjna: gdy GitHub Actions nie dowozi release

Jeżeli workflow padnie, a lokalny build i podpisane artefakty już masz, nie musisz blokować releasu.

Wtedy robisz ręczną publikację release z lokalnych plików.

### Co trzeba opublikować ręcznie

- `Parking.OS_<wersja>_x64-setup.exe`
- `Parking.OS_<wersja>_x64-setup.exe.sig`
- `Parking.OS_<wersja>_x64-setup.nsis.zip`
- `Parking.OS_<wersja>_x64-setup.nsis.zip.sig`
- `latest.json`

### Jak ma wyglądać `latest.json`

```json
{
  "version": "2026.1.6",
  "notes": "Parking.OS 2026.1.6",
  "pub_date": "2026-05-21T12:00:00Z",
  "platforms": {
    "windows-x86_64-nsis": {
      "signature": "<zawartosc pliku .nsis.zip.sig>",
      "url": "https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.6/Parking.OS_2026.1.6_x64-setup.nsis.zip"
    },
    "windows-x86_64": {
      "signature": "<zawartosc pliku .exe.sig>",
      "url": "https://github.com/Hans199393/parking-os-releases/releases/download/v2026.1.6/Parking.OS_2026.1.6_x64-setup.exe"
    }
  }
}
```

Najważniejsze zasady awaryjnej publikacji:

- plik musi być nazwany dokładnie `latest.json`,
- URL-e muszą wskazywać dokładnie na tag bieżącego releasu,
- podpis `windows-x86_64-nsis` musi pochodzić z `.nsis.zip.sig`,
- podpis `windows-x86_64` musi pochodzić z `.exe.sig`.

## Finalna checklista przed zamknięciem tematu

- wersja w `src-tauri/tauri.conf.json` jest poprawna,
- nowy plik w `updates/v2026.1.0X/README.md` istnieje,
- `README.md` wskazuje nową dokumentację update,
- `cargo check` przeszedł,
- `npm run build` przeszedł,
- `npm run tauri build` przeszedł,
- release na GitHub istnieje,
- release ma `latest.json` i oba podpisane artefakty,
- publiczny `latest.json` pokazuje właściwą wersję,
- drugi komputer widzi update przez `Sprawdź aktualizacje`.

## Typowe błędy i diagnoza

### Błąd: aplikacja wykrywa update, ale pobieranie nie startuje lub nigdy nie kończy

**Objaw:** Na drugiej maszynie klikasz „Sprawdź aktualizacje", pojawia się spinner lub pasek postępu, ale pobieranie stoi w miejscu. Nie ma błędu — po prostu nic się nie dzieje.

**Przyczyna (zidentyfikowana 2026-05-24, v2026.1.10):** Release na GitHubie istnieje i ma status `published`, ale brakuje jednego lub kilku wymaganych plików. Tauri updater odpytuje `latest.json` → dostaje 404 → kończy się cicho. Aplikacja może przez to próbować kanału awaryjnego (Vercel manifest), który podaje URL `raw.githubusercontent.com` zamiast CDN GitHuba — ten URL jest kilkadziesiąt razy wolniejszy dla pliku 84 MB.

**Diagnoza:**

```powershell
# Sprawdź jakie assety faktycznie są w release:
$ProgressPreference = 'SilentlyContinue'
Invoke-RestMethod "https://api.github.com/repos/Hans199393/parking-os-releases/releases/latest" -Headers @{'User-Agent'='Copilot'} |
  Select-Object -ExpandProperty assets |
  Select-Object name, size, state | Format-Table -AutoSize

# Sprawdź czy latest.json jest dostępny publicznie:
Invoke-RestMethod "https://github.com/Hans199393/parking-os-releases/releases/latest/download/latest.json" -Headers @{'User-Agent'='Copilot'} |
  Select-Object version
```

Jeśli lista assetów jest niekompletna (brakuje `latest.json`, `.nsis.zip`, `.sig`), to jest właśnie ten błąd.

**Naprawa:**

1. Znajdź ID release:
   ```powershell
   $token = "<twój_token>"
   (Invoke-RestMethod "https://api.github.com/repos/Hans199393/parking-os-releases/releases/latest" -Headers @{Authorization="token $token";'User-Agent'='Copilot'}).id
   ```
2. Prześlij brakujące pliki (patrz sekcja „Ścieżka awaryjna" wyżej).
3. Szczególnie ważne: `latest.json` musi być UTF-8 bez BOM i musi zawierać obie platformy (`windows-x86_64-nsis` i `windows-x86_64`).
4. Po uploadeach ponownie zweryfikuj endpoint `latest.json` (Krok 9).

**Prewencja:** Każdy release musi mieć komplet 5 plików zanim ogłosisz go jako gotowy. Po pushu taga zawsze uruchom weryfikację z Kroku 10, zanim powiesz użytkownikowi że update jest dostępny.

---

### Błąd: `error decoding response body` przy Sprawdź aktualizacje

**Przyczyna:** `latest.json` zapisany z BOM (pierwsze 3 bajty `EF BB BF`). Diagnoza i fix — patrz Krok 9 (sekcja o weryfikacji BOM).

---

### Błąd: update wykrywany, pobieranie rusza, ale pasek postępu stoi na 0%

**Przyczyna (historyczna, naprawiona w v2026.1.9):** Stara wersja `lib.rs` używała `copy_to()` bez emitowania zdarzeń postępu. Naprawione przez pętlę 64KB chunks z `app.emit(HELPER_UPDATE_PROGRESS_EVENT, ...)` po każdym bloku. Jeśli problem wraca, sprawdź czy `helper_update_download_and_launch_installer` w `src-tauri/src/lib.rs` rzeczywiście ma tę pętlę.

---

## Skrócona ścieżka robocza

Jeżeli wszystko idzie standardowo, kolejność jest taka:

1. zrobić fix,
2. podbić wersję i dokumentację,
3. zrobić `cargo check` i `npm run build`,
4. zrobić signed `npm run tauri build`,
5. zebrać hash i rozmiary,
6. uzupełnić release notes,
7. `git add` tylko właściwe pliki,
8. `git commit` i `git push`,
9. `git tag -f v...` i push taga,
10. sprawdzić `latest.json`,
11. sprawdzić update na drugim komputerze.