# Canonical React API Contract Matrix

Generated: 2026-08-18T11:08:27.8434979+01:00

- Laravel SHA: `8f6d527bd87d9c07cc5c619bf397b2cad7592f41`
- ASP.NET SHA: `8f6d527bd87d9c07cc5c619bf397b2cad7592f41`
- Static call-site rows: 2407
- Unique method/path contracts: 2078
- Method-evidenced contracts: 1899
- Method-unresolved contracts: 179
- ASP.NET static route/method gaps: 5
- Laravel static route/method gaps: 16

This is static call-site evidence, not a parity score. Payloads, response envelopes, status codes, auth, tenancy, uploads, side effects, and unchanged-client runtime remain separate semantic and certification gates.

## ASP.NET static gaps

| Method | Path | Laravel | ASP.NET | Call sites | Representative source |
| --- | --- | --- | --- | ---: | --- |
| POST | `/api/v2/auth/oauth/{id}/link` | exists POST | missing  | 1 | `pages/settings/tabs/ConnectedAccountsTab.tsx` |
| UNRESOLVED | `/api/v2/auth/oauth/{id}/redirect` | exists-unambiguous-method GET | missing  | 1 | `components/auth/OAuthButtons.tsx` |
| DELETE | `/api/v2/auth/oauth/{id}/unlink` | exists DELETE | missing  | 1 | `pages/settings/tabs/ConnectedAccountsTab.tsx` |
| UNRESOLVED | `/api/v2/auth/oauth/enabled-providers` | exists-unambiguous-method GET | missing  | 1 | `components/auth/OAuthButtons.tsx` |
| GET | `/api/v2/auth/oauth/me/identities` | exists GET | missing  | 1 | `pages/settings/tabs/ConnectedAccountsTab.tsx` |

The complete deduplicated matrix is `canonical-react-api-contract-matrix.csv`; machine-readable metadata and both gap sets are in `canonical-react-api-contract-summary.json`.
