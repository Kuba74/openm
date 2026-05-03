# ERP-fromee Import — Edge Cases (Contacts + Addresses + Banks)

**Date:** 2026-05-03
**Companion to:** [erp-fromee-import-edge-cases-2026-05-03.md](erp-fromee-import-edge-cases-2026-05-03.md), [.ai/specs/2026-05-03-erp-fromee-import-customers.md](../.ai/specs/2026-05-03-erp-fromee-import-customers.md)
**Scope:** Edge cases dla mappers Contacts / Addresses / Banks + multi-* handling

## Cel

Po D5-D7 (companies + tax + roles, basic flow), ten dokument pokrywa **D8-D11** dla bardziej złożonych mapperów: contactFunction translation, address type enum, multi-bank, encryption.

## D8 — German contactFunction translation

### Problem

`CompanyContact.contactFunction` w erp-fromee ma niemiecką taksonomię (Architekt, Statiker, Bauherr, Verkauf, Einkauf, Buchhaltung, Qualität, Logistik, Technik, Sonstige) jako free text. openm `customer_person_company_roles.role_value` używa angielskich/uniwersalnych slug'ów (decision_maker, budget_holder, technical_evaluator, primary_contact, end_user) per dictionary.

Mapping ad-hoc to translation matrix.

### Decyzja D8: Mapowanie inline w mapper'ze, missing → `'other'`

- **Reason:** Stable mapping table w kodzie (vs. konfigurowanie per-tenant) — auditable + version-controlled.
- **How:**
  ```typescript
  const CONTACT_FUNCTION_MAP: Record<string, string> = {
    'Architekt': 'architect',
    'Statiker': 'structural_engineer',
    'Bauherr': 'project_owner',
    'Verkauf': 'sales',
    'Einkauf': 'procurement',
    'Buchhaltung': 'accounting',
    'Qualität': 'quality',
    'Logistik': 'logistics',
    'Technik': 'technical',
    'Sonstige': 'other',
  }
  function mapContactFunction(german: string | null): string {
    if (!german) return 'other'
    return CONTACT_FUNCTION_MAP[german.trim()] ?? 'other'
  }
  ```
- **Acceptance:** Unmapped entries logged jako warning (`WARN: Unmapped contactFunction "Sonderaufgaben" for contact ${id}, defaulting to "other"`). Dry-run report agreguje listę unmapped values.
- **Future:** Można dodać `--enrich-contact-functions` flag żeby rozszerzać mapping z manual review.
- **Tests:** 11 cases (10 known + 1 unknown).

## D9 — Address type mapping (PRIMARY/INVOICE/DELIVERY → openm)

### Problem

erp-fromee `CompanyAddress.type` enum: `PRIMARY` | `INVOICE` | `DELIVERY`. openm `customer_addresses.address_type` (z partial unique index z Tygodnia 1) używa innych wartości — typowo `office` | `billing` | `shipping` | `home` | `work`.

Mapowanie 1:1:

### Decyzja D9: `PRIMARY → office`, `INVOICE → billing`, `DELIVERY → shipping`

- **Reason:** Najbliższe semantyczne odpowiedniki w openm dictionary `address_type`. `office` jest default'em dla glównego adresu firmy w openm.
- **How:**
  ```typescript
  const ADDRESS_TYPE_MAP: Record<string, string> = {
    'PRIMARY': 'office',
    'INVOICE': 'billing',
    'DELIVERY': 'shipping',
  }
  ```
- **Acceptance:** Wszystkie 405 adresów z erp-fromee mapowane bez błędu. Partial unique index per (entity_id, address_type) z Tygodnia 1 honorowany — jeśli >1 PRIMARY na firmę → first-wins (jak D6).
- **Tests:** 4 cases (PRIMARY, INVOICE, DELIVERY, multi-PRIMARY first-wins).

## D10 — Multi-bank handling (66 → 1 in MVP)

### Problem

erp-fromee ma `CompanyBankAccount` 1:N (66 firm ma >0 banków). openm `customer_company_billing` (Tydzień 1) jest 1:1 — single bank. Multi-bank model `customer_company_bank_accounts` odłożony do Fazy 4.

### Decyzja D10: Import tylko **primary bank** w MVP, ostatnie konto archive'owane jako warning

- **Reason:** 5.8% pokrycia + 0 SEPA w bazie → primary-only daje 100% pokrycie kluczowego pola IBAN. Multi-bank to Faza 4.
- **How:**
  ```typescript
  const primaryBank = banks.find(b => b.isPrimary && b.isActive)
                    ?? banks.find(b => b.isActive)
                    ?? banks[0]
  // Skip non-primary banks for MVP, log warning per skipped:
  // WARN: Skipped bank account ${id} for company ${companyId} (not primary in MVP — multi-bank in Phase 4)
  ```
- **Acceptance:** 66 customer_company_billing rows z primary IBAN. Skipped bank accounts udokumentowane w report.
- **Future Faza 4:** `--include-secondary-banks` flag w sync_erp_fromee CLI doda customer_company_bank_accounts insertions.
- **Tests:** 4 cases (single bank, multi-bank with primary, multi-bank without primary, no bank).

## D11 — IBAN encryption mandatory or opt-in

### Problem

openm ma `TenantDataEncryptionService` z feature flag per tenant. PII fields (PESEL, IBAN) MOGĄ być encrypted at rest. Tydzień 1 nie zaaplikował encryption do `customer_company_billing.bankAccountMasked` ani do `customer_tax_identities.value where kind=PESEL`.

Pytanie: import skrypt:
- **A** Pisze plain text (delegate encryption do runtime gdy update'owane przez UI)
- **B** Pisze pre-encrypted (jeśli feature flag enabled)

### Decyzja D11: **Opcja B — auto-encrypt jeśli flag enabled**, fallback na plain

- **Reason:** GDPR-by-default — jeśli tenant ma encryption enabled, import nie powinien tworzyć clear-text PII. Spójne z `findWithDecryption` runtime pattern.
- **How:**
  ```typescript
  import { TenantDataEncryptionService } from '@open-mercato/core/modules/auth/...'
  
  async function maybeEncryptIban(iban: string, scope: Scope, ctx: ImportContext): Promise<string> {
    const enc = ctx.container.resolve('tenantDataEncryption') as TenantDataEncryptionService
    if (!enc.isEnabledForTenant(scope.tenantId)) return iban
    return enc.encryptForTenant(iban, scope)
  }
  ```
- **Acceptance:** Dry-run wskazuje czy encryption enabled per scope; commit run respektuje ten state. PESEL (jeśli kiedyś importowane) — same path.
- **Tests:** 2 cases (encryption on → ciphertext stored; off → plain stored).

## Pre-import audit queries (uzupełnienie do D5-D7)

```sql
-- D8: contactFunction values distribution
SELECT "contactFunction", count(*) FROM "CompanyContact"
WHERE "contactFunction" IS NOT NULL
GROUP BY "contactFunction" ORDER BY count(*) DESC;
-- Expected: 10 known German values + maybe few outliers.

-- D9: address type distribution
SELECT type, count(*) FROM "CompanyAddress"
GROUP BY type;
-- Expected: PRIMARY/INVOICE/DELIVERY only.

-- D10: multi-bank companies
SELECT "companyId", count(*) FROM "CompanyBankAccount"
WHERE "isActive" = true
GROUP BY "companyId" HAVING count(*) > 1;
-- Per audit: low number, will be skipped per D10.
```

## Mappers — implementation impact

| Mapper | D5 | D6 | D7 | D8 | D9 | D10 | D11 |
|---|---|---|---|---|---|---|---|
| companyToPartner | ✅ | — | — | — | — | — | — |
| taxIdentities | ✅ | — | — | — | — | — | ⚠️ (PESEL future) |
| roles | — | — | — | — | — | — | — |
| contacts | — | ✅ | — | ✅ | — | — | — |
| addresses | — | ✅ | — | — | ✅ | — | — |
| billing | — | — | ✅ | — | — | ✅ | ✅ |
| metadata | ✅ | — | — | — | — | — | — |

## Risk register (uzupełnienie)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| E4 | D8: nowe contactFunction values w erp-fromee bez mapping → wszystko leci do 'other' | Low | Audit query w pre-import; warning per unknown value |
| E5 | D9: różne tenant'y mają różne address_type dictionaries | Low | Mapping fallback'uje na default 'other' jeśli `address_type` nie istnieje w docelowym dictionary |
| E6 | D10: użytkownik oczekuje wszystkich banków → MVP skip wprowadza zaskoczenie | Medium | Pełna lista skipped banks w report; doc explicit że Faza 4 to dorobi |
| E7 | D11: encryption mismatch (był enabled w trakcie importu, potem wyłączony) → IBAN nieczytelny | Low | Snapshot encryption state przy starcie, fail fast jeśli zmiana w trakcie |

## Status

- D8 **ratified** (inline mapping table, fallback 'other')
- D9 **ratified** (PRIMARY → office, INVOICE → billing, DELIVERY → shipping)
- D10 **ratified** (primary-only w MVP, multi-bank w Fazie 4)
- D11 **ratified** (auto-encrypt jeśli flag enabled, plain fallback)

D5-D7 ratyfikowane w companion doc [erp-fromee-import-edge-cases-2026-05-03.md](erp-fromee-import-edge-cases-2026-05-03.md).

**Ten dokument + companion = full pre-implementation contract dla import skrypt'u.**
