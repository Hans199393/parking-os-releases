# mediamtx — setup dla kamer UDP (YCC365Plus)

## Problem

Kamery **cam2** i **cam3** (YCC365Plus C-P05) używają UDP RTSP i zamykają sesję RTSP
po ~21 sekundach bez właściwego keepalive. ffmpeg nie wysyła OPTIONS keepalive regularnie → strumień zamarza co ~21s → ffmpeg restartuje → 5s przerwy → cycle.

## Rozwiązanie

**mediamtx** działa jako lokalny RTSP proxy:
- Utrzymuje połączenie do kamer z keepalive OPTIONS co ~10s
- ffmpeg łączy się przez TCP do `rtsp://127.0.0.1:8554/cam2` (stabilne)
- server.js automatycznie wykrywa `mediamtx.exe` i go uruchamia

## Pobieranie

1. Wejdź na: https://github.com/bluenviron/mediamtx/releases/latest
2. Pobierz: `mediamtx_vX.X.X_windows_amd64.zip`
3. Wypakuj i skopiuj **mediamtx.exe** do tego katalogu:
   ```
   G:\parking_2026\parking_os\rtsp-proxy\mediamtx.exe
   ```

## Jak to działa

Po umieszczeniu `mediamtx.exe`:
1. `node server.js` automatycznie generuje `mediamtx_auto.yml` z adresami kamer
2. Uruchamia mediamtx jako child process (nasłuchuje na `rtsp://127.0.0.1:8554/`)
3. Czeka 2 sekundy aż mediamtx podłączy się do kamer
4. Uruchamia ffmpeg → czyta z `rtsp://127.0.0.1:8554/cam2` (TCP, stabilne)

Jeśli `mediamtx.exe` nie istnieje — server.js działa jak wcześniej (fallback do bezpośredniego UDP).

## Bez mediamtx (opcja)

Jeśli nie chcesz używać mediamtx, możesz ustawić w `.env`:
```
USE_MEDIAMTX=false
```
(ale wtedy cam2/cam3 będą zamrażać się co ~21s)
