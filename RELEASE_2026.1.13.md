# Parking.OS — Release 2026.1.13

**Data:** 2026-05-31

---

## Zakres zmian

Pełne przeprojektowanie wizualne modułów **Rezerwacje** i **Finanse** — spójne z nowym Dashboardem (v2026.1.12). Zero zmian logiki biznesowej.

---

## Zmiany techniczne

### Reservations.tsx
- **Tab bar**: 5 płaskich zakładek → 3 główne (`Kalendarz | Zarządzanie | Logi`) + dynamiczne pod-zakładki dla grupy Zarządzanie (`Historia | Czarna lista | Oczekujący`). Styl `glass-strong` z separatorem.
- **Karty rezerwacji w panelu dnia**: przebudowane na nowoczesny układ — rejestracja jako "hero text" (`font-mono font-bold tracking-widest`), kolorowa kropka statusu (teal/emerald/orange/slate), badge BAN, akcje edit/delete widoczne po najechaniu.

### Finances.tsx
- **Summary strip**: 5 kart `<Card>` w `grid-cols-5` → jeden `glass-strong` pasek poziomy z 5 metrykami inline oddzielonymi pionowymi separatorami.
- **Zakładki Wpisy**: usunięta osobna zakładka "Faktury" — połączona z "Przychody" w jedną zakładkę `Przychody & Faktury`.
- **Widok Przychody & Faktury**: dwie kolumny obok siebie — lewa (flex-[3]) tabela przychodów dziennych ze sticky nagłówkiem, prawa (flex-[2]) nowoczesna lista faktur z kolorowymi kropkami kategorii i akcjami on-hover. Każda kolumna ma własny przycisk dodawania.

### tauri.conf.json
- Wersja: `2026.1.12` → `2026.1.13`

---

## Testy

- TS errors: brak (`get_errors` na obu plikach zwrócił 0 błędów)
- Build lokalny: zakończony sukcesem (Vite + Rust + NSIS)

---

## Artefakty

| Plik | Opis |
|------|------|
| `Parking.OS_2026.1.13_x64-setup.exe` | Instalator NSIS (główny) |
| `Parking.OS_2026.1.13_x64-setup.nsis.zip` | ZIP do auto-updater |
| `*.sig` | Sygnatury Tauri updater |
| `latest.json` | Manifest updatera |

---

## Rollout

1. GitHub Actions (`release.yml`) uruchamia się po push taga `v2026.1.13`
2. Build na `windows-latest`, artefakty publikowane jako GitHub Release
3. `latest.json` wgrywany do release — aplikacje sprawdzają aktualizację przy starcie
