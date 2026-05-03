# ERP-fromee Import — Edge Cases (Companies + Tax + Roles)

**Date:** 2026-05-03
**Companion to:** [.ai/specs/2026-05-03-erp-fromee-import-customers.md](../.ai/specs/2026-05-03-erp-fromee-import-customers.md), [.ai/specs/analysis/ANALYSIS-2026-05-03-import-readiness-erp-fromee.md](../.ai/specs/analysis/ANALYSIS-2026-05-03-import-readiness-erp-fromee.md)
**Scope:** Edge cases dla mappers Company / TaxIdentity / Role w skrypcie one-time importu

## Cel

Spec D1-D4 (filtr ról, JDG, source attribution, INTERNAL) pokrywa happy path. Audyt erp-fromee ujawnił **dodatkowe edge cases** wymagające wyraźnych decyzji zanim skrypt poleci na produkcji. Ten dokument zbiera D5-D7 dla obszaru companies + tax + roles.

## D5 — Conflicting tax IDs (Company.taxId vs Company.metadata)

### Problem

W erp-fromee `Company.taxId` jest top-level kolumną oraz potencjalnie zduplikowane w `Company.metadata.legacyKlientFirmaId` lub innych pól JSONB ze starszych importów. Audyt: `2 rekordy` mają `metadata.statusRelacji='klient'` ale 200 ma rolę CUSTOMER — niezsynchronizowane.

Dla Tax IDs: jeden NIP w `Company.taxId='5260250995'`, inny w metadata? Trzeba zdecydować autoritative source.

### Decyzja D5: `Company.taxId` (i pokrewne kolumny) jest **autoritative**

- **Reason:** Top-level kolumna jest ENFORCED via DB level (NOT NULL constraints, indices). Metadata JSONB to free-form, often stale.
- **How:** Mapper czyta TYLKO z `Company.taxId/regon/krs/vatEu`. `metadata.legacyKlientFirmaId` zachowane wyłącznie jako audit trail w `customer_entities.metadata.external_links.legacy_klient_firma_id`.
- **Conflict handling:** Jeśli skrypt wykryje że `metadata.taxId !== Company.taxId` — log warning ale użyj kolumny.
- **Tests:** Unit test dla scenariusza `metadata.taxId="123"` + `Company.taxId="999"` → import preserves "999", warning logged.

## D6 — Multi-primary contacts (data integrity)

### Problem

Audyt: 9 rekordów `CompanyContact` ma `isPrimary=true`. Ale konstraktor partial unique index (Tydzień 1) wymaga **maksymalnie 1 primary per company**. Jeśli erp-fromee ma:
- 0 primary → OK
- 1 primary → OK (auto-mapped)
- 2+ primary per company → constraint violation podczas insert'u

### Decyzja D6: First-wins per (company, createdAt asc), warning logged

- **Reason:** Najstarszy contact prawdopodobnie był pierwszy primary (intencjonalnie). Późniejsi marked primary by error / manual override który nie przeszedł walidacji.
- **How:**
  1. Pre-import audit query: `SELECT companyId, count(*) FROM CompanyContact WHERE isPrimary=true GROUP BY companyId HAVING count(*)>1`
  2. Dla każdego konfliktu: pierwszy contact (`MIN(createdAt)`) zostaje `is_primary=true`, reszta `is_primary=false` w openm
  3. Warning per row: `WARN: Demoted contact ${id} from primary (later than ${first_id}; tie broken by createdAt ASC)`
- **Acceptance:** Dry-run pokazuje listę demoted contacts; commit run wykonuje demotion automatycznie.
- **Tests:** Unit test z 3 primary contacts → first wins, 2 demoted.

## D7 — SEPA mandate handling

### Problem

`CompanyBankAccount` ma 4 SEPA-related fields: `sepaMandateId`, `sepaMandateDate`, `sepaMandateType`, `sepaMandateStatus`. Audyt: **0 rekordów** ma populated SEPA fields. Ale podstawowy bankAccount (66 firm, 64 z IBAN) ma legitne dane.

openm `customer_company_billing` (Tydzień 1) NIE MA SEPA columns. Multi-bank model (`customer_company_bank_accounts`) odłożony do Fazy 4.

### Decyzja D7: **Skip SEPA fields w MVP imporcie** (current dataset i tak ich nie ma)

- **Reason:** 0/66 rekordów ma SEPA → zero data loss. Mapper writes IBAN do `customer_company_billing.bankAccountMasked` (single primary bank). Faza 4 doda pełne SEPA support gdy multi-bank model wjedzie.
- **How:**
  1. Mapper czyta `CompanyBankAccount.iban` jeśli `isPrimary=true && isActive=true`, fallback na pierwszy aktywny
  2. SEPA fields ignorowane (warning gdy populated, ale 0 rekordów)
  3. `customer_company_billing.bankName ← CompanyBankAccount.bankName`
  4. `customer_company_billing.bankAccountMasked ← maskIban(CompanyBankAccount.iban)`
- **Future:** W Fazie 4 (multi-bank) re-run import z `--include-sepa` flag, doda kolumny SEPA do `customer_company_bank_accounts`.
- **Acceptance:** Dry-run nie pokazuje SEPA warning'ów (bo 0 records). Commit OK.
- **Tests:** Unit test z mock'iem CompanyBankAccount mającym sepaMandateId='X' → import preserves IBAN, ignores SEPA, logs warning.

## Pre-import audit queries (run before --commit)

```sql
-- D5: tax ID conflicts
SELECT id, "taxId", metadata->>'legacyKlientFirmaId' AS legacy
FROM "Company"
WHERE "taxId" IS NOT NULL
  AND metadata->>'legacyKlientFirmaId' IS NOT NULL
  AND "taxId" != metadata->>'legacyKlientFirmaId';
-- Expected: 0 rows. If >0, log + decide manual fix per company.

-- D6: multi-primary contacts
SELECT "companyId", count(*) FROM "CompanyContact"
WHERE "isPrimary" = true AND "isActive" = true
GROUP BY "companyId" HAVING count(*) > 1;
-- Expected: per audit, low/zero rows. If >0 — first-wins applied.

-- D7: SEPA presence (sanity check)
SELECT count(*) FROM "CompanyBankAccount" WHERE "sepaMandateId" IS NOT NULL;
-- Expected per audit: 0. If >0 — D7 strategy needs revisit.
```

## Mappers — implementation notes

| Story | Mapper file | Edge case handling |
|---|---|---|
| S1 | `companyToPartner.ts` | D5 (taxId autoritative), JDG reclassification (D2) |
| S2 | `taxIdentities.ts` | D5 (one row per kind from top-level columns only) |
| S3 | `roles.ts` | D4 (skip INTERNAL only mode) |
| S4 | `contacts.ts` | D6 (first-wins for multi-primary) |
| S5 | `addresses.ts` | (covered in companion edge-cases-addresses doc) |
| S6 | `billing.ts` | D7 (skip SEPA in MVP) |
| S7 | `metadata.ts` | D5 (top-level wins over metadata fields) |

## Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| E1 | D5: tax ID conflicts cause silent data loss | Low | Pre-import audit query; warnings in dry-run |
| E2 | D6: multi-primary edge case not caught early | Medium | Audit query MUST run before --commit; abort if >0 unless --force |
| E3 | D7: future SEPA need requires schema change | Low | Documented Faza 4 path; current dataset has 0 SEPA |

## Status

- D5 **ratified** (top-level wins, metadata audit-only)
- D6 **ratified** (first-wins per createdAt ASC, warning logged)
- D7 **ratified** (skip SEPA in MVP, Faza 4 will add multi-bank + SEPA)

Ten dokument cierpienia jest baseline'm dla S1/S2/S3/S6 mappers. Companion: [erp-fromee-import-edge-cases-contacts-addresses-banks-2026-05-03.md](erp-fromee-import-edge-cases-contacts-addresses-banks-2026-05-03.md) covers D8-D11.
