# Parking.OS — Release 2026.1.14

**Data:** 2026-06-04

---

## Zakres zmian

Dwa poprawki: fix raportu porannego (usunięte rezerwacje pojawiały się w wiadomości) oraz konfigurowalna blokada ekranu po bezczynności w Ustawieniach → System.

---

## Zmiany techniczne

### parking_botaimess/lib/supabase.js — fix `getTodayReservations`
- Dodano filtr `.is('deleted_at', null)` do zapytania `getTodayReservations()`.
- Przyczyna buga: `deleteReservation` w Parking.OS wykonuje soft-delete (ustawia `deleted_at`, nie zmienia `status`). Wcześniej zapytanie filtrowało jedynie `status = 'confirmed'`, przez co rezerwacje miękko usunięte przez operatora nadal pojawiały się w porannym raporcie Messenger.

### parking_os/src/lib/defaultSettings.ts
- Dodano klucz `session_idle_timeout_min: '0'` (domyślnie wyłączone).

### parking_os/src/components/Settings/settingsTypes.ts
- Klucz `'session_idle_timeout_min'` dodany do `ALL_SETTINGS_KEYS`.

### parking_os/src/components/Settings/useSettings.ts
- Klucz `session_idle_timeout_min: '0'` dodany do lokalnej mapy `DEFAULTS`.

### parking_os/src/components/Settings/Settings.tsx
- `<SystemTab>` otrzymuje teraz `values` i `set` z hooka `useSettings`.

### parking_os/src/components/Settings/SystemTab.tsx
- Dodana sekcja **„Blokada ekranu po bezczynności"** z polem liczbowym (0–120 minut, 0 = wyłączone).
- Ikona: `Timer` (lucide-react).
- Zmiana obowiązuje natychmiast bez restartu.

### parking_os/src/App.tsx
- Dodany listener `app:settings-saved` — gdy użytkownik zmieni `session_idle_timeout_min` w Ustawieniach, `idleTimeoutMin` w App.tsx aktualizuje się na żywo bez ponownego logowania.

### tauri.conf.json
- Wersja: `2026.1.13` → `2026.1.14`

---

## Testy

- TS errors: brak (`get_errors` na wszystkich zmienionych plikach zwrócił 0 błędów)
- Build lokalny: do uruchomienia (`.\build-production.ps1`)

---

## Artefakty

| Plik | Opis |
|------|------|
| `Parking.OS_2026.1.14_x64-setup.exe` | Instalator NSIS (główny) |
| `Parking.OS_2026.1.14_x64-setup.nsis.zip` | ZIP do auto-updater |
| `*.sig` | Sygnatury Tauri updater |
| `latest.json` | Manifest updatera |

---

## Rollout

1. `.\build-production.ps1` → przy `Password:` naciśnij Enter
2. Skopiuj artefakty do `release-packages\parking_os_v2026.1.14\`
3. Wygeneruj `latest.json` wg `RELEASE_HOWTO.md` krok 4
4. Push kodu i taga: `git tag v2026.1.14 && git push origin master && git push origin v2026.1.14`
5. Utwórz GitHub Release przez API i wgraj 5 plików (krok 6–7 w RELEASE_HOWTO.md)
6. **Bot `parking_botaimess`**: wdróż na Vercel (`vercel --prod` lub push do repo podpiętego pod Vercel)
