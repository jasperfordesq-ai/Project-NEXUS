# Canonical React API Contract Matrix

Generated: 2026-08-10T07:39:29.7563968+01:00

- Laravel SHA: `f98b8bc1cbcc4d559f5ae918bce16d2353d4fcef`
- ASP.NET SHA: `f98b8bc1cbcc4d559f5ae918bce16d2353d4fcef`
- Static call-site rows: 2406
- Unique method/path contracts: 2077
- Method-evidenced contracts: 1898
- Method-unresolved contracts: 179
- ASP.NET static route/method gaps: 58
- Laravel static route/method gaps: 16

This is static call-site evidence, not a parity score. Payloads, response envelopes, status codes, auth, tenancy, uploads, side effects, and unchanged-client runtime remain separate semantic and certification gates.

## ASP.NET static gaps

| Method | Path | Laravel | ASP.NET | Call sites | Representative source |
| --- | --- | --- | --- | ---: | --- |
| GET | `/api/v2/admin/events/{id}/attendance-reward` | exists GET | missing  | 1 | `admin/api/adminApi.ts` |
| PUT | `/api/v2/admin/events/{id}/attendance-reward` | exists PUT | missing  | 1 | `admin/api/adminApi.ts` |
| GET | `/api/v2/admin/events/attendance-claims` | exists GET | missing GET | 1 | `admin/api/adminApi.ts` |
| POST | `/api/v2/admin/events/attendance-claims/{id}/retry` | exists POST | missing  | 1 | `admin/api/adminApi.ts` |
| POST | `/api/v2/admin/events/attendance-claims/{id}/reverse` | exists POST | missing  | 1 | `admin/api/adminApi.ts` |
| GET | `/api/v2/admin/gamification/challenges` | exists GET | missing  | 1 | `admin/api/adminApi.ts` |
| POST | `/api/v2/admin/gamification/challenges` | exists POST | missing  | 1 | `admin/api/adminApi.ts` |
| DELETE | `/api/v2/admin/gamification/challenges/{id}` | exists DELETE | missing  | 1 | `admin/api/adminApi.ts` |
| PUT | `/api/v2/admin/gamification/challenges/{id}` | exists PUT | missing  | 1 | `admin/api/adminApi.ts` |
| GET | `/api/v2/admin/partner-venues` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| POST | `/api/v2/admin/partner-venues` | exists POST | missing  | 1 | `lib/partner-venues-api.ts` |
| PUT | `/api/v2/admin/partner-venues/{id}` | exists PUT | missing  | 1 | `lib/partner-venues-api.ts` |
| POST | `/api/v2/admin/partner-venues/{id}/archive` | exists POST | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/admin/partner-venues/{id}/staff` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| POST | `/api/v2/admin/partner-venues/{id}/staff` | exists POST | missing  | 1 | `lib/partner-venues-api.ts` |
| DELETE | `/api/v2/admin/partner-venues/{id}/staff/{id}` | exists DELETE | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/admin/partner-venues/reports/summary` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/admin/partner-venues/visits/export.csv` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/admin/performance/summary` | exists GET | missing  | 1 | `admin/modules/performance/PerformanceDashboard.tsx` |
| GET | `/api/v2/admin/safeguarding/authority-attestations` | exists GET | missing  | 1 | `admin/modules/safeguarding/SafeguardingDashboard.tsx` |
| POST | `/api/v2/admin/safeguarding/authority-attestations` | exists POST | missing  | 1 | `admin/modules/safeguarding/SafeguardingDashboard.tsx` |
| POST | `/api/v2/admin/safeguarding/authority-attestations/{id}/revoke` | exists POST | missing  | 1 | `admin/modules/safeguarding/SafeguardingDashboard.tsx` |
| GET | `/api/v2/admin/safeguarding/support-actions` | exists GET | missing  | 1 | `admin/modules/safeguarding/SafeguardingDashboard.tsx` |
| POST | `/api/v2/admin/safeguarding/support-actions/{id}/attest` | exists POST | missing  | 1 | `admin/modules/safeguarding/SafeguardingDashboard.tsx` |
| GET | `/api/v2/admin/super/federation/external-status` | exists GET | missing  | 1 | `admin/api/adminApi.ts` |
| GET | `/api/v2/admin/super/platform-capabilities` | exists GET | missing  | 1 | `admin/api/adminApi.ts` |
| PUT | `/api/v2/admin/super/platform-capabilities` | exists PUT | missing  | 2 | `admin/api/adminApi.ts` |
| POST | `/api/v2/admin/super/users/{id}/impersonate` | exists POST | missing  | 1 | `admin/api/adminApi.ts` |
| UNRESOLVED | `/api/v2/auth/impersonate/end` | exists-unambiguous-method POST | missing  | 1 | `lib/impersonate.ts` |
| UNRESOLVED | `/api/v2/auth/impersonate/exchange` | exists-unambiguous-method POST | missing  | 1 | `lib/impersonate.ts` |
| GET | `/api/v2/partner-venues` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/partner-venues/my-visits` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/partner-venues/pass` | exists GET | missing  | 1 | `lib/partner-venues-api.ts` |
| POST | `/api/v2/partner-venues/pass/rotate` | exists POST | missing  | 1 | `lib/partner-venues-api.ts` |
| POST | `/api/v2/partner-venues/visits/verify/{id}` | exists POST | missing  | 1 | `lib/partner-venues-api.ts` |
| GET | `/api/v2/public/events` | exists GET | missing  | 1 | `lib/public-events-api.ts` |
| GET | `/api/v2/public/events/{id}` | exists GET | missing  | 1 | `lib/public-events-api.ts` |
| UNRESOLVED | `/api/v2/safeguarding/consent-to-guardian` | exists-unambiguous-method POST | missing  | 1 | `pages/settings/tabs/SafeguardingTab.tsx` |
| UNRESOLVED | `/api/v2/safeguarding/decline-guardian` | exists-unambiguous-method POST | missing  | 1 | `pages/settings/tabs/SafeguardingTab.tsx` |
| POST | `/api/v2/safeguarding/guardian-permissions` | exists POST | missing  | 1 | `pages/settings/tabs/SafeguardingTab.tsx` |
| GET | `/api/v2/safeguarding/my-guardians` | exists GET | missing  | 2 | `components/safeguarding/GuardianConsentPrompt.tsx;pages/settings/tabs/SafeguardingTab.tsx` |
| GET | `/api/v2/safeguarding/my-wards` | exists GET | missing  | 1 | `pages/settings/tabs/SafeguardingTab.tsx` |
| UNRESOLVED | `/api/v2/safeguarding/withdraw-guardian-consent` | exists-unambiguous-method POST | missing  | 1 | `pages/settings/tabs/SafeguardingTab.tsx` |
| GET | `/api/v2/support-actions/confirm/{id}` | exists GET | missing  | 1 | `pages/subaccounts/SupportActionConfirmPage.tsx` |
| POST | `/api/v2/support-actions/confirm/{id}` | exists POST | missing  | 1 | `pages/subaccounts/SupportActionConfirmPage.tsx` |
| POST | `/api/v2/users/me/parent-accounts/{id}/message-access/withdraw` | exists POST | missing  | 1 | `components/subaccounts/SubAccountsManager.tsx` |
| PUT | `/api/v2/users/me/parent-accounts/{id}/permissions` | exists PUT | missing  | 1 | `components/subaccounts/SubAccountsManager.tsx` |
| POST | `/api/v2/users/me/sub-accounts/{id}/listings` | exists POST | missing  | 1 | `components/subaccounts/SupportPrepareModal.tsx` |
| POST | `/api/v2/users/me/sub-accounts/{id}/listings/{id}/image` | exists POST | missing  | 1 | `components/subaccounts/SupportPrepareModal.tsx` |
| GET | `/api/v2/users/me/sub-accounts/{id}/messages` | exists GET | missing  | 2 | `pages/subaccounts/SupportedMessagesPage.tsx` |
| GET | `/api/v2/users/me/sub-accounts/{id}/messages/{id}` | exists GET | missing  | 1 | `pages/subaccounts/SupportedMessagesPage.tsx` |
| POST | `/api/v2/users/me/sub-accounts/{id}/transfer` | exists POST | missing  | 1 | `components/subaccounts/SupportPrepareModal.tsx` |
| GET | `/api/v2/users/me/sub-accounts/{id}/wallet` | exists GET | missing  | 1 | `components/subaccounts/SupportPrepareModal.tsx` |
| GET | `/api/v2/users/me/support-actions` | exists GET | missing  | 3 | `components/subaccounts/SupportActionPrompt.tsx;components/subaccounts/SupportActionsPanel.tsx` |
| POST | `/api/v2/users/me/support-actions` | exists POST | missing  | 2 | `components/subaccounts/SupportPrepareModal.tsx` |
| DELETE | `/api/v2/users/me/support-actions/{id}` | exists DELETE | missing  | 1 | `components/subaccounts/SupportActionsPanel.tsx` |
| POST | `/api/v2/users/me/support-actions/{id}/confirm` | exists POST | missing  | 1 | `components/subaccounts/SupportActionsPanel.tsx` |
| POST | `/api/v2/users/me/support-actions/{id}/decline` | exists POST | missing  | 1 | `components/subaccounts/SupportActionsPanel.tsx` |

The complete deduplicated matrix is `canonical-react-api-contract-matrix.csv`; machine-readable metadata and both gap sets are in `canonical-react-api-contract-summary.json`.
