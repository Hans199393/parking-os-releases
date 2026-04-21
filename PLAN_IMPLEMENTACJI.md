# PLAN IMPLEMENTACJI — Parking.OS Finanse
> Ostatnia aktualizacja: 17.04.2026
> Status: oczekuje na potwierdzenie użytkownika

---

## ✅ JUŻ ZAIMPLEMENTOWANE (sesja 16–17.04.2026)

- [x] **Faza 1 — database.ts**
  - Migracje: `base_qty_*` (baza na jutro), `weather`, `temperature`
  - Migracja `invoices` → nowa kategoria `'Inwestycja'`
  - Nowe funkcje: `getTotalInvestments()`, `getTotalRevenue()`, `deleteDailyRevenue()`
  - Computed fields: `base_total`, `do_sejfu` w `computeTotals()`

- [x] **Faza 2 — Settings.tsx**
  - Sekcja "Prowizje bezgotówkowe" — pole `card_commission_rate` (0–5%), zapis do Tauri Store

- [x] **Faza 3 — RevenueForm (Finances.tsx)**
  - Krok 1: Stan saszetki (nominały qty_*)
  - Krok 2: Baza na jutro (nominały base_qty_*)
  - Płatności bezgotówkowe (karta + BLIK + live netto z prowizją)
  - Kontekst dnia: 4-przyciskowy picker pogody + temperatura + notatki
  - Podsumowanie: SUMA W SASZETCE → BAZA → DO SEJFU → Karta/BLIK Netto → RAZEM

- [x] **Faza 4 — Main Finances UI**
  - 5 kart KPI: Przychody / Koszty oper. / Inwestycje / Zysk-Strata / ROI Tracker
  - Tabela: Data | DO SEJFU | Karta | BLIK | Razem | Auta | Pogoda+temp | akcje
  - Badge `Inwestycja` (fioletowy) w tabeli faktur
  - Usuwanie raportu z potwierdzeniem hasłem Parking.OS

- [x] **Faza 5 — Excel Właścicielski (excel.ts)**
  - `exportOwnerToExcel()` — elegancki arkusz z KPI boxami, naprzemiennymi wierszami,
    formatowaniem liczb, zamrożonymi nagłówkami, autofiiltrem
  - Kolumny: Data+Dzień | Pogoda&Temp | DO SEJFU | Karta/BLIK Netto |
    Koszty Inwest. | Koszty Oper. | ZYSK NA RĘKĘ | Postęp ROI | Komentarze
  - ROI footer z info o pozostałej kwocie do spłaty
  - Przycisk "Excel Właścicielski" obok "Eksportuj Excel" w nagłówku Finansów

---

## 📋 DO POTWIERDZENIA — Planowane funkcje

### BLOK A — Raporty w podzakładkach (zamiast/obok eksportu Excel)

- [ ] **A1** — Nowa podzakładka `Raport dzienny`
  - Szczegóły wybranego dnia: wszystkie nominały, baza, bezgotówkowe, faktury tego dnia, zysk netto dnia
  - Klik na wiersz w tabeli Przychody → otwiera ten widok

- [ ] **A2** — Nowa podzakładka `Raport miesięczny`
  - KPI boxy (jak w Excel właścicielskim ale w aplikacji)
  - Tabela dzienna z kolumną "Liczba aut"
  - Zestawienie kosztów wg kategorii (Usługi/Podatki/Materiały/Inwestycja)
  - Średni dzienny przychód, najlepszy dzień miesiąca

- [ ] **A3** — Nowa podzakładka `Raport roczny`
  - Wiersz per miesiąc: przychód / koszty / zysk
  - ROI tracker roczny
  - Najlepszy/najgorszy miesiąc
  - Wynik podatkowy (przychód − koszty oper., bez Inwestycji)

> **Uwaga:** Excel pozostaje jako export do archiwizacji/druku — raporty w aplikacji to widok "na żywo"

---

### BLOK B — System Analityczny z danymi historycznymi

- [ ] **B1** — Import danych z Excela (jednorazowy)
  - Nowa podzakładka "Import historyczny"
  - Wgraj plik `.xlsx` → aplikacja mapuje kolumny (data, gotówka, karta, BLIK)
  - Dane trafiają do tej samej tabeli `daily_revenue` z datami `2025-xx-xx` / `2024-xx-xx`
  - Brakujące pola (base_qty, weather) = NULL/0

- [ ] **B2** — System tagów specjalnych dni
  - Nowa kolumna `tags TEXT` w `daily_revenue`
  - Auto-detekcja: Boże Ciało (Wielkanoc+60dni), Wniebowzięcie NMP (15.08), dni wolne PL, długi weekend
  - Możliwość ręcznego tagu w formularzu dziennym (np. "jarmark", "festyn")

- [ ] **B3** — Podzakładka `Analityka`
  - **Porównanie roczne:** tabela Czerwiec/Lipiec/Sierpień × rok, ze zmianą %
  - **Statystyki dnia tygodnia:** średni przychód Pt/Sb/Nd osobno
  - **TOP/BOTTOM dni:** najlepszy i najgorszy dzień z każdego roku
  - **Pogoda a przychód:** średni przychód wg pogody (tylko 2026+)
  - **Prognoza sezonu:** ekstrapolacja na podstawie 2024+2025 → szacunek dla 2026

---

### BLOK C — Dodatkowe pytania (odpowiedz aby odblokować B1–B3)

1. **Format starego Excela** — czy masz oddzielne kolumny gotówka/karta/BLIK, czy tylko suma dzienna?
2. **Ile lat danych** — tylko 2025, czy też 2024?
3. **Tagi retroaktywne** — czy chcesz ręcznie oznaczyć stare dni ze starych plików?
4. **Prognoza** — czy chcesz ją teraz, czy zostawić na później?

---

## 🔢 Proponowana kolejność implementacji (po potwierdzeniu)

```
1. Blok A (podzakładki raportów) — nie wymaga importu, od razu działa na 2026
2. B1 (importer Excel) — gdy dostarczysz plik ze starym formatem
3. B2 (tagi specjalnych dni) — po imporcie, żeby retroaktywnie oznaczyć
4. B3 (Analityka) — ostatni, bo bazuje na 1+2+3
```
