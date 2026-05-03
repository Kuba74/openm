# Upstream Contribution Research

**Date:** 2026-05-03
**Companion to:** [2026-05-03-partner-master-migration.md](../2026-05-03-partner-master-migration.md)
**Status:** Research complete — long-term planning

## TLDR

Twój fork (Kuba74/openm) ma 173 commitów ahead upstream/main (open-mercato/open-mercato). Phase 1 PR (`customer_tax_identities` + walidatory NIP/REGON/KRS/PESEL/VAT-EU) jest **wartościowy generycznie** — nie jest PL-specific (modeluje multi-country tax identifiers). Powinien być contributable upstream **z drobnymi zmianami** (PL checksum logic isolated do oddzielnego helpera). 4 inne ficzery z naszej pracy też mają potential. Reszta (May MVP, polskie konfiguracje, sync z erp-fromee) to wyłącznie kompozycja — zostaje w forku.

## Stan rozjazdu

```
upstream/main (open-mercato/open-mercato)
       ↓ pull
origin/main (Kuba74/openm)        ← 0 ahead, 1 behind upstream/main (95f7aa1ef auth-fix #1771)
       ↓ pull main
origin/develop (Kuba74/openm)     ← 173 commits ahead upstream/main
```

## Klasyfikacja zmian per kategoria

### Klasa A — Engine features, contributable upstream

Kandydaci do PR'a do open-mercato/open-mercato:

| # | Feature | PR# (twój) | Generic value | Upstream readiness |
|---|---|---|---|---|
| A1 | `customer_tax_identities` model + checksumy | [#1](https://github.com/Kuba74/openm/pull/1) | **Wysoki** — multi-country, multi-kind, partial unique index, soft-delete | ⚠️ PL checksum logic (NIP/REGON/KRS/PESEL) trzeba wyizolować |
| A2 | `customer_company_billing.salesOwnerUserId` + `defaultOfferValidityDays` | [#4](https://github.com/Kuba74/openm/pull/4) | **Średni** — sales-side properties użyteczne w każdym B2B | ✅ Generic |
| A3 | Partial unique index na `customer_person_company_links` (`is_primary` per company) | [#4](https://github.com/Kuba74/openm/pull/4) | **Wysoki** — invariant powinien być standardowy | ✅ Generic |
| A4 | Partial unique index na `customer_addresses` (`is_primary` per type) | [#4](https://github.com/Kuba74/openm/pull/4) | **Wysoki** — same | ✅ Generic |
| A5 | JDG reclassification helper (sole proprietor pattern) | [#3](https://github.com/Kuba74/openm/pull/3) | **Niski** — bardzo PL-specific | ❌ Skip upstream |
| A6 | `getSalesCustomers` / `isSalesCustomer` helpery | [#4](https://github.com/Kuba74/openm/pull/4) | **Wysoki** — zwraca generycznych customers z roli, nic PL-specyficznego | ✅ Generic |
| A7 | `getPrimaryContact` / `getDefaultOfferAddress` helpery z fallback chain | [#4](https://github.com/Kuba74/openm/pull/4) | **Wysoki** — generic patterns | ✅ Generic |

### Klasa B — Konfiguracja PL, zostaje w forku

| # | Feature | Reason for fork-only |
|---|---|---|
| B1 | PL VAT rates seed (23/8/5/0/zw + `is_exempt`) | Polski tax law specific |
| B2 | Polskie formaty numeracji (OF/ZS/FV/KOR/KFV) | Polish business convention |
| B3 | Default currency PLN | Tenant config, not engine |
| B4 | Polskie tłumaczenia i18n | Per-tenant, lub: contribute jako PL pack do openm i18n |

### Klasa C — Integracje fork-specific

| # | Feature | Reason |
|---|---|---|
| C1 | Sync z erp-fromee | Twój specyficzny ERP; mogło by być template'em "sync_external_erp" w upstream |
| C2 | Historical SalesOffer migration | Same |
| C3 | KlientFirma → construction_objects future migration | Domain-specific |

### Klasa D — Engine improvements (small but useful)

| # | Feature | Notes |
|---|---|---|
| D1 | `is_exempt` boolean na `sales_tax_rates` | **Wysoki** — VAT-zwolnione vs 0% jest international concept (USA: tax-exempt orgs, EU: VAT-exempt categories) |
| D2 | `formatFinancial` helper z `currencies.decimalPlaces` | **Wysoki** — proper financial rounding to currency precision |
| D3 | Multi-VAT totals breakdown w document calculations | **Średni** — dobry dla compliance reportingu (VAT registers) |
| D4 | `defineLink(customers:company_billing → auth:user)` | **Niski** — pattern już jest w openm, my tylko używamy |

## Strategia upstream contribution

### Phase 0 — Po MVP (czerwiec 2026)

Po lądowaniu PR #1-#4 i May MVP, ekstrahuj subset features Klasy A jako **clean upstream-friendly PR'y**:

#### Upstream PR'a 1: `customer_tax_identities`

```
Title: feat(customers): add normalized tax-identity model with multi-country support

Subset:
- CustomerTaxIdentity entity (bez specific country logic)
- Generic taxIdentityKind enum (NIP, REGON, KRS, PESEL, VAT_EU, VAT, EORI, OTHER) — ale walidacja generic
- Partial unique index on (country_code, kind, value)
- API CRUD routes (generic)
- Empty validators.ts hooks — contributors mogą dodać per-country
- i18n keys (en + de jako 2 locales)
- Tests dla podstawowej validacji (length, format)

Out of scope:
- Polish-specific checksum logic (zostaje w forku jako packages/core-pl/customers/lib/taxIdentityChecksums.ts)
- Polish dictionary entries
```

Estymata: 8-12 h (rebase/cherry-pick + abstract PL logic + write generic tests).

#### Upstream PR'a 2: Primary uniqueness invariants

```
Title: feat(customers): enforce partial unique indexes on primary contact + address

Subset:
- Partial unique index on customer_person_company_links(company_entity_id) WHERE is_primary
- Partial unique index on customer_addresses(entity_id, address_type) WHERE is_primary
- getPrimaryContact + getDefaultOfferAddress helpers
- Tests
```

Estymata: 4-6 h.

#### Upstream PR'a 3: Sales-side billing properties

```
Title: feat(customers): add sales properties on customer_company_billing

Subset:
- salesOwnerUserId column
- defaultOfferValidityDays column
- defineLink to auth:user
- getSalesOwner + getDefaultOfferValidityDays helpers
- UI section "Sales settings" w company profile widget
```

Estymata: 4-6 h.

#### Upstream PR'a 4: `is_exempt` flag on tax rates

```
Title: feat(sales): add is_exempt flag for tax rates outside VAT system

Subset:
- is_exempt boolean column on sales_tax_rates
- taxCalculationService skip logic for exempt rates
- Tests showing distinction between vat-0 and exempt
- i18n key for "exempt" badge
```

Estymata: 3-4 h.

### Phase 1 — Co miesiąc po MVP (lipiec+ 2026)

Synchronizacja: **co tydzień** pull `upstream/main` → `origin/main` → merge do `origin/develop`. Eliminuje rozjazd.

Jeśli upstream merge'uje nasze contributions (Klasa A) — zniknie potrzeba duplikatów w forku.

### Phase 2 — PL pack jako companion (post-MVP, opcjonalnie)

Rozważyć: utworzyć **`@open-mercato/pl-pack` plugin module** w upstream, który:
- Dodaje PL VAT rates seed
- Dodaje PL document numbering formats
- Dodaje Polish i18n locale
- Dodaje PL checksumy (NIP/REGON/KRS/PESEL)

Inne kraje mogą podobnie tworzyć `de-pack`, `fr-pack`, etc. — partycja per-locale w architekturze plugin'ów.

Estymata: 16-24 h (jako oddzielny mini-PR roadmap).

## Korzyści z upstream contribution

| Korzyść | Impact |
|---|---|
| **Mniej rozjazdu** z mainem upstream | Łatwiejsze cykliczne `git pull upstream main` |
| **Reduced maintenance burden** | Featur zsync'owany — nie musimy robić rebase'ów po każdej upstream zmianie |
| **Społeczność open-mercato** dostaje PL-friendly tax identities, useful invariants | Dobra wola, networking |
| **Walidacja designu** | Code review od maintainerów upstream'u → confidence że nasz design jest dobry |
| **Future contributions** od innych użytkowników do features które wniosłeś | Możliwe gdy są ogólnie używane |

## Ryzyka

| # | Ryzyko | Mitigation |
|---|---|---|
| M1 | Upstream odrzuca PR (nie ich priority lub konflikt z roadmap'em) | Zachowaj forks; jeśli odrzucenie, kontynuuj w forku |
| M2 | Upstream wymaga znaczących zmian (np. inny naming convention dla taxIdentityKind) | Akceptuj — feedback poprawia design; rebrand'uj w forku jeśli musisz |
| M3 | Long review cycle (>3 miesiące) blokuje korzyści sync'u | Time-box: jeśli >3 miesiące review → fallback do fork-only |
| M4 | PL checksumy są silnie powiązane z resztą feature'ów; trudno wyizolować | Strategy A: extension hook system w upstream; Strategy B: separate PR z `customers-pl` extension package |

## Action items (post-MVP)

1. ⏳ Czerwiec 2026: po stabilizacji MVP, zacząć extraction PR'a 1 (tax_identities)
2. Po PR'a 1 merge: PR'a 2-4 sequencyjnie
3. Po lipcu: regular sync `upstream/main` → `origin/main` (co tydzień)
4. Listopad/grudzień 2026: rozważyć `@open-mercato/pl-pack` proposal

## Decision points

1. **Czy w ogóle kontrybuować upstream?**
   - Plus: less divergence, community goodwill
   - Minus: Wymaga dodatkowej pracy (extraction, abstract'owanie, review cycle)
   - **Rekomenduję: TAK dla A1+A2+A3+A4 (high-value, generic), NIE dla A5 (JDG za bardzo PL-specific)**

2. **Czas:** kiedy zacząć?
   - **Rekomenduję: po May MVP demo** — żeby najpierw udowodnić wartość biznesową, potem dzielić się kodem

3. **Jak struktur'ować `pl-pack`?**
   - **Rekomenduję: oddzielne ćwiczenie post-MVP**, nie blocker

## Sources

- `git log --oneline upstream/main..origin/develop | wc -l` → 173 commits
- `git log --oneline origin/main..upstream/main` → 1 commit (`#1771 fix(auth)`)
- PR #1, #3, #4 (nasze branche)
- ADR-1..10 z master spec'u
