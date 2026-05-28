# Instrukcja Kamer I Proxy

Stan na: `2026-05-21`

Ten dokument zbiera to, co realnie trzeba bylo zrobic, zeby kamery w `Parking.OS` dzialaly poprawnie w devie i po update na drugim komputerze. Celem jest unikniecie ponownego debugowania od zera.

## Koncowa dzialajaca konfiguracja kamer

- Kamera 1:
  - Format RTSP (przykład): `rtsp://[user]:[pass]@192.168.0.51:554/cam/realmonitor?channel=1&subtype=0`
  - Rzeczywisty adres jest zapisany w `%APPDATA%\com.klose.parking-os\settings.json` (klucz `cam1_rtsp_url`)
- Kamera 2:
  - `rtsp://192.168.0.57:554/onvif1`
- Kamera 3:
  - `rtsp://192.168.0.50:554/onvif1`

Wazne:

- kamery sa dostepne tylko w tej samej sieci lokalnej / Wi-Fi,
- samo dzialanie na jednym komputerze nie oznacza jeszcze, ze drugi komputer ma poprawne zapisane ustawienia,
- zrodlem prawdy dla zainstalowanej aplikacji nie jest `.env`, tylko lokalny plik ustawien w AppData.

## Zrodlo prawdy dla adresow RTSP

Najwazniejsze miejsce dla zainstalowanej aplikacji:

- `%APPDATA%\com.klose.parking-os\settings.json`

To w tym pliku musza siedziec poprawne adresy `cam1_rtsp_url`, `cam2_rtsp_url`, `cam3_rtsp_url`.

Pliki, ktore musza miec zgodne defaulty w repo:

- `src/lib/defaultSettings.ts`
- `src-tauri/default-settings.json`

Plik pomocniczy dla dev / diagnostyki:

- `rtsp-proxy/.env`

Uwaga:

- `.env` nie moze byc traktowany jako glowny stan dla zainstalowanej aplikacji,
- proxy musi czytac aktualne adresy z ustawien przekazanych przez runtime, a nie zakladac stare wartosci z bundla.

## Co bylo zepsute

Glowne przyczyny problemu z kamerami byly cztery:

1. Bledne stare defaulty kamer 1 i 3.
2. Stare wartosci zapisane juz w `%APPDATA%\com.klose.parking-os\settings.json` po wczesniejszych instalacjach.
3. Podwojnie uruchomione proxy / `mediamtx` / `ffmpeg`, ktore robily konflikty portow.
4. Zbyt optymistyczne sprawdzanie zdrowia proxy tylko po endpointcie `/`, bez potwierdzenia realnych manifestow HLS.

Stare bledne wartosci, ktore powodowaly problemy:

- kamera 1: stary adres z `.50:37777`
- kamera 3: stary adres z `.53:554/onvif1`

Sam update defaultow nie wystarczal, bo zainstalowana aplikacja trzymala juz stare wartosci w AppData.

## Co trzeba bylo zmienic, zeby zaczelo dzialac

### 1. Poprawic defaulty kamer w kodzie

Trzeba bylo ustawic poprawne adresy dla kamery 1 i 3 w tych plikach:

- `src/lib/defaultSettings.ts`
- `src-tauri/default-settings.json`

Bez tego nowe instalacje dalej startowalyby na zlych adresach.

### 2. Dodac migracje starych ustawien w backendzie Rust

Trzeba bylo dodac migracje w:

- `src-tauri/src/lib.rs`

Zasada migracji:

- nadpisujemy tylko znane stare bledne wartosci legacy,
- nie ruszamy recznie zmienionych adresow operatora,
- migracja uruchamia sie przed startem proxy.

To byl kluczowy fix dla drugiego komputera po update.

### 3. Nie odpalac drugiego proxy, jezeli jedno juz dziala poprawnie

Trzeba bylo zabezpieczyc start proxy po stronie Rust i dev, zeby aplikacja:

- nie odpalala drugiego procesu na zajetym `8888`,
- nie robila konfliktu na `8554` i `8000`,
- nie uznawala za sukces sytuacji, w ktorej root proxy odpowiada, ale nie ma manifestow `cam1/cam2/cam3`.

Dotkniete miejsca:

- `src-tauri/src/lib.rs`
- `vite.config.ts`

### 4. Poprawic konfiguracje mediamtx

W `rtsp-proxy/server.js` trzeba bylo generowac konfiguracje mediamtx z `rtspTransport`, a nie starym `sourceProtocol`.

### 5. Dolaczyc `reqwest` blocking po stronie Rust

Poniewaz backend zacząl sprawdzac zdrowie lokalnego proxy przez klienta HTTP blokujacego, trzeba bylo dolaczyc `blocking` w:

- `src-tauri/Cargo.toml`

## Jak szybko sprawdzic, czy kamery sa naprawde OK

### Krok 1. Sprawdz zapisane ustawienia aplikacji

```powershell
$appData = Join-Path $env:APPDATA 'com.klose.parking-os'
Get-Content (Join-Path $appData 'settings.json') -Raw
```

Oczekiwane wartosci:

- `cam1_rtsp_url` -> `.51:554/...`
- `cam2_rtsp_url` -> `.57:554/onvif1`
- `cam3_rtsp_url` -> `.50:554/onvif1`

### Krok 2. Sprawdz, czy sama kamera odpowiada po RTSP

Przyklad:

```powershell
& 'g:\parking_2026\ffmpeg-8.1-essentials_build\bin\ffprobe.exe' -v error -rtsp_transport udp -rw_timeout 5000000 -select_streams v:0 -show_entries stream=codec_name,width,height -of compact=p=0:nk=1 "rtsp://192.168.0.50:554/onvif1"
```

Jezeli `ffprobe` nie widzi obrazu, to problem jest sieciowy / RTSP, nie w UI.

### Krok 3. Sprawdz lokalne proxy

Root health:

```powershell
Invoke-WebRequest http://127.0.0.1:8888/
```

To nie wystarcza samo w sobie. Trzeba jeszcze sprawdzic manifesty HLS:

```powershell
Invoke-WebRequest http://127.0.0.1:8888/stream/cam1.m3u8
Invoke-WebRequest http://127.0.0.1:8888/stream/cam2.m3u8
Invoke-WebRequest http://127.0.0.1:8888/stream/cam3.m3u8
```

Proxy jest naprawde zdrowe dopiero wtedy, gdy manifesty dla oczekiwanych kamer zwracaja `200`.

### Krok 4. Sprawdz logi

Najwazniejszy log:

- `%APPDATA%\com.klose.parking-os\camera-proxy.log`

Typowe objawy:

- `EADDRINUSE` -> zyje stary proces i blokuje port,
- brak manifestu `camX.m3u8` -> kamera nie zostala poprawnie uruchomiona przez proxy,
- bledy ffmpeg / mediamtx -> problem runtime, nie tylko UI.

## Gdy kamery znowu przestana dzialac

Przejdz ta checkliste w tej kolejnosci:

1. Czy oba komputery sa w tej samej sieci lokalnej / Wi-Fi?
2. Czy `%APPDATA%\com.klose.parking-os\settings.json` ma poprawne RTSP dla wszystkich 3 kamer?
3. Czy `http://127.0.0.1:8888/stream/cam1.m3u8`, `cam2.m3u8`, `cam3.m3u8` daja odpowiedz `200`?
4. Czy nie zostaly osierocone procesy `node .\server.js`, `mediamtx.exe`, `ffmpeg.exe`?
5. Czy porty `8888`, `8554`, `8000` nie sa zajete przez stary runtime?
6. Czy `camera-proxy.log` pokazuje realny blad, a nie tylko objaw w UI?

## Gdy problem wraca tylko po update

To oznacza zwykle jedno z ponizszych:

- stara wartosc zostala zachowana w `settings.json`,
- nowy build nie zawiera zgodnych defaultow,
- update nie doszedl na drugi komputer,
- publiczny `latest.json` byl zly i aplikacja nie pobrala nowej wersji.

Wniosek praktyczny:

- jezeli lokalnie w devie kamery dzialaja, a po update nie dzialaja, najpierw sprawdz `settings.json` oraz manifest updatera, a dopiero potem sam frontend.

## Gdy sprawdzanie aktualizacji pokazuje `error decoding response body`

To nie jest problem kamery, tylko publicznego manifestu updatera.

Na `2026-05-21` problemem bylo to, ze `latest.json` musial byc opublikowany jako UTF-8 bez BOM. Manifest z BOM potrafil wywalic blad dekodowania przy `Sprawdz aktualizacje`.

Praktyczna zasada:

- `latest.json` publikuj jako UTF-8 bez BOM,
- na Windows waliduj go najlepiej przez `curl.exe -L`, a nie tylko przez `Invoke-WebRequest`.

## Powiazana instrukcja

Instrukcja publikacji update znajduje sie obok:

- `UPDATE_INSTRUKCJA.md`