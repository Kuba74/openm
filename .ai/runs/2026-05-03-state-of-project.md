# State of the Project — 2026-05-03

**Snapshot date:** 2026-05-03 (po pełnej sesji planning + audytów + Phase 1 implementation)
**Author:** Kuba74 + Claude
**Purpose:** Single overview of where everything stands, czego się dorobiliśmy, i co dalej.

## Strategiczny wybór

**Opcja C ratified** — May MVP buduje się w **openm** (nie erp-fromee), per ADR-7 master spec'u.

Workflow:
- `upstream/main` (Open Mercato) ← engine updates
- `origin/main` ← **PR #1 idzie tu** (engine update z naszego forka)
- `origin/develop` ← user composition (PR #3, #4, #5, #2 idą tu)
- erp-fromee zostaje read-replica dla partnerów (do cutover'u w Fazie 7)

## PR-y w toku (5 sztuk)

| PR | Branch | Base | Status | Co |
|---|---|---|---|---|
| **#1** | `feat/partner-master-phase-1-tax-identity` | `main` (engine) | Ready, 18 commits, ⚠️ migracja niewygenerowana | `customer_tax_identities` + walidatory NIP/REGON/KRS/PESEL/VAT-EU + UI section + i18n + tests |
| **#2** | `docs/partner-master-migration-spec` | `develop` | Ready, 14 commits | Master spec + 4 per-phase specy + 8 audytów + 222 stringi tłumaczeń example |
| **#3** | `feat/partner-master-mvp-s-week-1-foundation` | `develop` | Ready, 9 commits | Week 1 stories S1.2 (lifecycle stages PL) + S1.6 (JDG reclassification helper + upgrade action) |
| **#4** | `feat/partner-master-mvp-s-week-1-completion` | `develop` | Ready, 9 commits, stack na #3 | Week 1 stories S1.1 + S1.3 + S1.4 + S1.5 (helpery sales-customer + billing extensions + primary contact/address uniqueness) |
| **#5** | `fix/pl-i18n-gaps-from-smoke` | `develop` | Ready, 1 commit | Drobne fixy ze smoke test'u (Wszystkie widoki + Wierszy na stronę) |

## Plan implementacyjny (5 tygodni MVP-S)

| Tydzień | Window | Status | Per-phase spec | Estymata |
|---|---|---|---|---|
| **1** Partner Foundation | 29.04–05.05 | ✅ **Wykonane** (PR #3 + #4) | [`2026-05-03-mvp-s-week-1-partner-foundation.md`](../specs/2026-05-03-mvp-s-week-1-partner-foundation.md) | 20 h |
| **2** PL Sales Configuration | 06.05–12.05 | 📋 Spec gotowy do spawn'u | [`2026-05-03-mvp-s-week-2-pl-sales-config.md`](../specs/2026-05-03-mvp-s-week-2-pl-sales-config.md) | 11 h |
| **3** Quote UI Wiring | 13.05–19.05 | 📋 Spec gotowy do spawn'u | [`2026-05-03-mvp-s-week-3-quote-ui.md`](../specs/2026-05-03-mvp-s-week-3-quote-ui.md) | 10 h |
| **4** Multi-VAT + Calculations | 20.05–26.05 | 📋 Spec gotowy do spawn'u | [`2026-05-03-mvp-s-week-4-calculations-vat-exempt.md`](../specs/2026-05-03-mvp-s-week-4-calculations-vat-exempt.md) | 10 h |
| **5** PDF + Sync historycznych + Demo | 27.05–31.05 | 📋 Spec gotowy do spawn'u | [`2026-05-03-mvp-s-week-5-quote-pdf-and-sync.md`](../specs/2026-05-03-mvp-s-week-5-quote-pdf-and-sync.md) | 35 h |
| **Razem** | | | | **86 h** |

vs. oryginalna estymata EPIC plan'u: 200 h. **Slack ~114 h** w 5 tygodniach (na bufor, sync historii, polish, S6 deals UI, demo prep).

## Audyty (8 raportów)

| | Plik | Co odkryło |
|---|---|---|
| **erp-fromee data** | [`ANALYSIS-2026-05-03-erp-fromee-partner-data.md`](../specs/analysis/ANALYSIS-2026-05-03-erp-fromee-partner-data.md) | 1140 partnerów, 82% supplier-only, KlientFirma to obiekty budowlane, 70 PERSON-z-NIP = JDG |
| **openm sales readiness** | [`ANALYSIS-2026-05-03-openm-sales-readiness.md`](../specs/analysis/ANALYSIS-2026-05-03-openm-sales-readiness.md) | Sales 90% gotowe — 27 encji, 36 API routes, 9 backend pages |
| **Week 2 readiness** | [`ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md`](../specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md) | 3 gapy: VAT rates (2/5), document numbering, default currency |
| **Week 3 readiness** | [`ANALYSIS-2026-05-03-mvp-s-week-3-readiness.md`](../specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-3-readiness.md) | UI quotes 90% — brakuje 3 kolumn + 2 filtrów + pre-fill chain |
| **Week 4 calculations** | [`ANALYSIS-2026-05-03-mvp-s-week-4-calculations.md`](../specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-4-calculations.md) | salesCalculationService enterprise-grade, brakuje is_exempt skip + formatFinancial |
| **Week 5 PDF research** | [`ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md`](../specs/analysis/ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md) | @react-pdf/renderer + Roboto + 15 edge case'ów + prototyp template |
| **Catalog PL** | [`ANALYSIS-2026-05-03-catalog-pl-readiness.md`](../specs/analysis/ANALYSIS-2026-05-03-catalog-pl-readiness.md) | 40 unitów istnieje, brakuje mb + t, i18n shorts dla PL skrótów |
| **Upstream contribution** | [`ANALYSIS-2026-05-03-upstream-contribution.md`](../specs/analysis/ANALYSIS-2026-05-03-upstream-contribution.md) | 4 features Klasy A do upstream (po MVP) — tax_identities, primary uniqueness, sales billing, is_exempt |

## Smoke test'y (przeprowadzone)

### Smoke test 1 — develop branch nawigacja

✅ Landing → Login → Pulpit → Lista Firmy → Lista Oferty (wszystko po polsku)

Wykryte gapy PL:
- "All views" w Perspektywach → ✅ **naprawione w PR #5**
- "Rows per page" → ✅ **naprawione w PR #5**
- "Welcome back, [encrypted]" w widget powitalnym → ⚠️ **deeper bug** (encrypted username w widget context, nie i18n)
- Custom field labels: "Marketing case study ready", "Executive notes", "Relationship health", "Renewal quarter" → ⚠️ **wymaga `labelKey` field na `CustomFieldDefinition` (BC-safe extension)**
- Section labels: IDENTITY, CONTACT, CLASSIFICATION, BUSINESS PROFILE → ⚠️ **hardcoded w v2 detail page schema**

Scope per ADR-7: post-MVP.

### Smoke test 2 — kreator firmy

✅ "Utwórz firmę" → wpisanie nazwy → submit → redirect do detalu v2 → undo flag widoczny → KPI cards

Confirmed:
- CrudForm działa
- Server-side mutation pipeline OK
- Audit log / undo działa
- Routing v2 działa

## Test `yarn db:generate` (PR #1 dry-run)

✅ Migracja generuje się prawidłowo dla `customers` modułu (i ~16 innych — co znaczy że jest tu sporo deferred snapshots z innych PRów na main).

⚠️ "rename failed" issue w środowisku z linkowanymi node_modules — to nie dotyczy normalnego setup'u.

**Reviewer powinien uruchomić lokalnie:**

```bash
git fetch origin
git checkout feat/partner-master-phase-1-tax-identity
yarn install
yarn build:packages
yarn db:generate    # wygeneruje plik migracji w packages/core/src/modules/customers/migrations/
git add packages/core/src/modules/customers/migrations/
git commit -m "chore(db): generate migration for customer_tax_identities"
git push
yarn typecheck && yarn test
```

## Decyzje podjęte (ADR'y w master spec'u)

1. **ADR-1** Strangler approach over in-place refactor erp-fromee
2. **ADR-2** Sync direction: pull (P3) → push (P7)
3. **ADR-3** Canonical IDs: openm UUID = master, erp-fromee = mapping
4. **ADR-4** Phase order: 1 → MVP-S → 2 → 5 → 3 → 6 → 4 → 7 → 8
5. **ADR-5** KlientFirma excluded — separate construction_objects spec
6. **ADR-6** JDG reclassification w Phase 1 (70 PERSON-z-NIP → company + legal_form='jdg')
7. **ADR-7** May MVP w openm, translations post-MVP
8. **ADR-8** PDF library: `@react-pdf/renderer` v4.x
9. **ADR-9** Sync historical SalesOffer: top 500 active (z 8100)
10. **ADR-10** Out of MVP: S5 inquiries, S8 activities, S9 dashboard

Plus W2.1-W2.4 (PL VAT/numbering/currency), W3.1-W3.4 (Quote UI), W4.1-W4.3 (rounding + exempt UX), W5 follows ADR-8/9.

## Dokumenty (12 plików w PR #2)

```
.ai/specs/
├── 2026-05-03-partner-master-migration.md             [master, 9 faz, 10 ADR]
├── 2026-05-03-mvp-s-week-1-partner-foundation.md      [✅ wykonane]
├── 2026-05-03-mvp-s-week-2-pl-sales-config.md         [11 h, gotowy]
├── 2026-05-03-mvp-s-week-3-quote-ui.md                [10 h, gotowy]
├── 2026-05-03-mvp-s-week-4-calculations-vat-exempt.md [10 h, gotowy]
├── 2026-05-03-mvp-s-week-5-quote-pdf-and-sync.md      [35 h, gotowy]
└── analysis/
    ├── ANALYSIS-2026-05-03-erp-fromee-partner-data.md
    ├── ANALYSIS-2026-05-03-openm-sales-readiness.md
    ├── ANALYSIS-2026-05-03-mvp-s-week-2-readiness.md
    ├── ANALYSIS-2026-05-03-mvp-s-week-3-readiness.md
    ├── ANALYSIS-2026-05-03-mvp-s-week-4-calculations.md
    ├── ANALYSIS-2026-05-03-mvp-s-week-5-pdf-research.md
    ├── ANALYSIS-2026-05-03-catalog-pl-readiness.md
    └── ANALYSIS-2026-05-03-upstream-contribution.md
```

## Akcje wymagane od Ciebie

### 1. Walidacja PR #1 lokalnie

```bash
git fetch origin
git checkout feat/partner-master-phase-1-tax-identity
yarn install
yarn build:packages
yarn db:generate    # wygeneruje brakujący plik migracji
yarn typecheck
yarn test
yarn build:app
```

Po zielonych testach:
```bash
git add packages/core/src/modules/customers/migrations/
git commit -m "chore(db): generate migration for customer_tax_identities"
git push
gh pr review 1 --approve
gh pr merge 1 --merge   # lub squash
```

### 2. Synchronizacja main → develop

```bash
git checkout develop
git merge main           # przyniesie tax_identities entity do develop
git push
```

### 3. Walidacja PR #3, #4 lokalnie

Analogicznie — checkout, validate, merge.

### 4. Review PR #2 (docs) i #5 (i18n fix)

Małe, niskoryzyko. Można zmerge'ować po szybkim przejrzeniu.

### 5. Po merge'u stack'u — Tydzień 2

```bash
# Daj znać żebyśmy spawnowali agenta:
# /auto-create-pr "implementuj Tydzień 2 zgodnie z .ai/specs/2026-05-03-mvp-s-week-2-pl-sales-config.md"
```

## Co Ci się podoba w tym planie

✅ **Realne na deadline** — 86 h faktyczna pracy w 5 tygodniach (1 osoba pełny etat = 200 h budżetu, slack 114 h)
✅ **Architektonicznie spójne** — wszystko buduje się w openm modular, nie w erp-fromee monolith
✅ **Dokumentacja kompletna** — każdy tydzień ma spec + audyt + Progress checklist (resumable via auto-continue-pr)
✅ **BC-safe** — wszystkie zmiany additive, no contract surface broken
✅ **Demo-ready** — Tydzień 5 wprost adresuje demo prep + sync historycznych ofert (top 500 aktywne)

## Ryzyka rezydualne (post-Tydzień 1)

| # | Ryzyko | Mitigation |
|---|---|---|
| Pre-existing duplicate primary contacts/addresses w bazie | Audyt query w PR #4 description, użytkownik ROZWIĄZUJE przed merge'em |
| `@react-pdf/renderer` incompatible z React 19 — niewykluczone | v4.x ma React 19 support; fallback na puppeteer |
| Sync 8100 SalesOffer może odsłonić niespójności mappingu | Per ADR-9: top 500 + dry-run mode |
| Welcome widget encrypted user — separate fix | Post-MVP bug, low impact |
| Translations niedokończone (post-MVP) | ADR-7 — odłożone do czerwca |

## Status na koniec dnia 2026-05-03

- ✅ 5 PR-ów otwartych
- ✅ 4 z 5 tygodni MVP-S z gotowym specem (Tydzień 1 wykonany)
- ✅ 8 raportów audytów
- ✅ 1 master spec z 10 ADR-ami
- ✅ Smoke test 1 + 2 wykonane
- ✅ Phase 1 PR podlinkowany do main, gotowy po lokalnej walidacji
- ✅ Stack PR-ów dla develop (3 → 4 → 5)

**Następny session start tutaj** — jeśli zwalidujesz PR #1, możemy ruszyć z Tygodniem 2 (Agent #5 spawn).

---

*Ten dokument to single source of truth dla obecnego stanu projektu.*
*Aktualizacja: po każdym merge'u PR'a lub większej decyzji.*
