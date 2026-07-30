# Security Scanning

Last reviewed: 2026-07-30

Project NEXUS is a public AGPL repository. Security scanning must distinguish reachable production risk from development-tooling noise.

## Reporting a Vulnerability

Do **not** open a public issue for an unpatched vulnerability. Use the private disclosure path documented in [`SECURITY.md`](../SECURITY.md).

---

## Security Sources Of Truth

| Document or file | Purpose |
| --- | --- |
| `SECURITY.md` | Public vulnerability disclosure policy and safe-research rules. |
| `.github/workflows/security-scan.yml` | CI security scan workflow (runs nightly + on every push to `main`). |
| `.github/workflows/dependency-review.yml` | Lightweight PR gate — runs only when package files change. |
| `owasp-suppressions.xml` | OWASP Dependency-Check suppressions with documented reasons. |
| `.trivyignore` | Trivy suppressions with documented reasons. |
| `.npm-audit-exceptions.json` | npm-audit exceptions (advisory id, scope, reason, added date) consumed by `scripts/npm-audit-gate.mjs`. |
| `.semgrepignore` | Semgrep path exclusions (dead/legacy code). |
| `composer.lock`, `package-lock.json`, `react-frontend/package-lock.json`, `e2e/package-lock.json`, `mobile/package-lock.json` | Dependency state that scanners evaluate. |

---

## CI Scan Coverage

The `security-scan.yml` workflow runs the following tools in order. The CI definition is the authoritative reference — this table is a summary only.

| # | Tool (step name) | What it covers | Blocking? |
| --- | --- | --- | --- |
| 1 | `composer audit --locked` | PHP CVEs in `composer.lock` | Yes |
| 2 | Trivy filesystem (table) | Filesystem CVEs at CRITICAL/HIGH | Yes, respects `.trivyignore` |
| 3 | Trivy filesystem (SARIF) | Same — uploads to GitHub Security tab | No (visibility only) |
| 4 | Semgrep (SAST) | PHP injection, secret patterns, security anti-patterns | No (SARIF upload only) |
| 5 | TruffleHog (`Check for Hardcoded Secrets`) | Verified secrets in git history | Yes |
| 6 | Enlightn Security Checker (`PHP Security Checker`) | A second advisory-database pass over `composer.lock` | Yes |
| 7 | `scripts/npm-audit-gate.mjs` (`NPM Audit (production deps — blocking)`) | Production npm CVEs at high+ across the root, React, E2E, and mobile lockfiles | Yes, respects `.npm-audit-exceptions.json` |
| 8 | OWASP Dependency-Check | Transitive CVEs across PHP + installed root/React/E2E npm dependency trees, CVSS ≥ 7 | Yes, respects `owasp-suppressions.xml` |
| 9 | Trivy container scan (separate `container-scan` job) | OS/library CVEs inside the built Docker image | Yes (push events only) |

The npm step is **not** raw `npm audit`. It runs `scripts/npm-audit-gate.mjs` four times — bare, `--prefix react-frontend`, `--prefix e2e`, and `--prefix mobile --package-lock-only`. The wrapper blocks on `high`/`critical` advisories unless the advisory carries a dated, scope-matched entry in `.npm-audit-exceptions.json`, in which case it is printed as excepted and the gate still exits 0. Consequence: the local commands below can surface a HIGH that CI deliberately passes. One exception is live today — `GHSA-mh99-v99m-4gvg` (`brace-expansion`, scope `mobile`, added 2026-07-25).

Full scan results land in the GitHub Security tab (SARIF uploads) and as workflow artifacts for the OWASP HTML report.

Dependency-Check's network-dependent Node Audit Analyzer is disabled because it
duplicates the explicit blocking `npm audit` commands and turns npm Audit API
outages into false CI failures. Its separate Node Package Analyzer remains
enabled for the installed root, React, and E2E trees while `npm audit` remains
authoritative for npm advisories.

The workflow intentionally does not install `mobile/node_modules` for the OWASP
pass. React Native packages vendor CocoaPods/Gem templates and native binaries
inside that directory; recursively treating those reference files as deployed
dependencies creates broad, incorrect CPE matches. The mobile production
lockfile is still a blocking `npm audit` target and is scanned from the clean
checkout by Trivy, so advisory coverage remains without converting vendored
build artifacts into runtime findings.

### Temporary mobile build-tool risk acceptance

As of 2026-07-15, Expo/Metro still resolves `image-size@1.2.1`. The package has
no patched release for [CVE-2025-71319](https://nvd.nist.gov/vuln/detail/CVE-2025-71319),
[CVE-2025-71329](https://nvd.nist.gov/vuln/detail/CVE-2025-71329), or
[CVE-2025-71330](https://nvd.nist.gov/vuln/detail/CVE-2025-71330); npm latest is
also affected. The dependency is used by Metro only while reading
repository-controlled source assets during development and bundling. It is not
included in the APK/IPA runtime and has no path from user-uploaded images.

This build-time denial-of-service risk is accepted until Expo/Metro moves to a
patched implementation. Re-review on any Expo, Metro, or `image-size` update,
and no later than 2026-10-15.

---

## Running Routine Dependency Checks Locally

Run these before opening a PR when you have changed any lock file. They are fast and catch the most common class of finding before CI does.

### PHP

```bash
composer audit --locked --no-interaction
```

- Checks `composer.lock` against the PHP Security Advisories database.
- A clean run prints nothing and exits 0.
- Any output names a package, a CVE or advisory ID, and a severity. Resolve by upgrading the affected package or, if the path is unreachable, by adding a suppression (see below).

### npm (production dependencies only)

```bash
npm audit --omit=dev --audit-level=high
npm --prefix react-frontend audit --omit=dev --audit-level=high
npm --prefix e2e audit --omit=dev --audit-level=high
npm --prefix mobile audit --package-lock-only --omit=dev --audit-level=high
```

- `--omit=dev` restricts the check to packages that ship in the production bundle. Build tools, dev servers, and test frameworks are excluded; their advisories are real noise against the production risk surface.
- `--audit-level=high` exits non-zero only on high or critical findings.
- The output groups findings by severity and names the vulnerable package, the advisory, the fix version (if one exists), and the dependency path.

To see all severities (informational):

```bash
npm audit --omit=dev
```

To reproduce the blocking CI gate exactly — including the `.npm-audit-exceptions.json` allowances — run the wrapper instead:

```bash
node scripts/npm-audit-gate.mjs
node scripts/npm-audit-gate.mjs --prefix react-frontend
node scripts/npm-audit-gate.mjs --prefix e2e
node scripts/npm-audit-gate.mjs --prefix mobile --package-lock-only
```

### Quick local Trivy scan (optional)

```bash
trivy fs . --severity CRITICAL,HIGH --ignorefile .trivyignore
```

Requires Trivy installed locally (`brew install trivy` / `apt install trivy` / [trivy.dev/latest/getting-started/installation](https://trivy.dev/latest/getting-started/installation/)). This runs the same filesystem scan as CI.

---

## Reading Scanner Output

### `composer audit` / `npm audit`

Both tools print a table grouped by severity. The key fields to check:

- **Package name and version** — confirm you have the affected version.
- **Advisory or CVE ID** — search the advisory for the vulnerable code path. Many advisories affect features (e.g. XML parsing, OAuth callbacks) that the project may not exercise.
- **Fixed in** — upgrade to at least this version. Check for lock-file conflicts before upgrading.

### OWASP Dependency-Check (HTML report)

The HTML artifact produced by CI groups findings by dependency and by CVE. Columns to read:

- **Severity / CVSS** — the CI gate blocks at CVSS ≥ 7 (HIGH). Lower scores are informational.
- **Evidence** — shows why OWASP linked this CVE to this package. CPE mismatches (the CVE is for a package with a similar name but a different ecosystem) are the most common false-positive class.
- **Related Dependencies** — shows which file in the project pulled in the affected package. If the file is a dev tool only, the production exposure is zero.

### Trivy

Trivy prints a table of findings per file/layer. The table shows the library, the installed version, the fixed version, and the CVE ID. A `(unfixed)` note on the fixed version means no patch exists yet — container scans run with `--ignore-unfixed` for this reason.

---

## Suppression Policy

Suppressions exist to keep the signal-to-noise ratio high. A suppression that hides a real finding is worse than no suppression.

### When a suppression is appropriate

- The vulnerable code path is not reachable from the project (wrong CPE match, unused feature, dev-only package).
- No fix is available yet and the exposure is accepted pending an upgrade.
- The finding is a kernel-level OS CVE in a container that does not run as root and has no privilege-escalation path.

A suppression is **not** appropriate just because a finding is inconvenient or because upgrading is difficult. If upgrading is hard, document why in the suppression and set a short review date.

### What every suppression must contain

1. **CVE or advisory ID** — the specific identifier being suppressed.
2. **Reason** — a plain-English sentence explaining why the finding is not a real risk in this project.
3. **Review date** — when the suppression should be re-evaluated (recommended: 90 days, or when the dependency next has a release).

### Trivy suppression format (`.trivyignore`)

Each entry is a CVE ID on its own line. Inline comments (`#`) carry the required reason and review date:

```
# CVE-2099-12345: affects the XML parser feature of libfoo; project does not
# use XML parsing anywhere in the dependency graph. Review: 2026-09-23.
CVE-2099-12345
```

Group related entries under a shared comment block when multiple CVEs share the same reason.

### OWASP Dependency-Check suppression format (`owasp-suppressions.xml`)

```xml
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
  <suppress until="2026-09-23Z">
    <notes>
      CVE-2099-12345: affects the XML parser feature of example-lib; project
      does not use XML parsing. Suppressed until next release of example-lib.
    </notes>
    <packageUrl regex="true">^pkg:npm/example-lib@.*$</packageUrl>
    <cve>CVE-2099-12345</cve>
  </suppress>
</suppressions>
```

The `until` date enforces expiry — OWASP Dependency-Check will re-surface the finding after that date even if the suppression file is not updated.

### npm-audit exception format (`.npm-audit-exceptions.json`)

`scripts/npm-audit-gate.mjs` reads the `exceptions` array. An entry only applies to the tree whose npm prefix matches its `scope` (or `*` for every tree):

```json
{
  "exceptions": [
    {
      "id": "GHSA-xxxx-xxxx-xxxx",
      "scope": "mobile",
      "package": "example-lib",
      "reason": "No in-range fix; the only npm-offered fix is a breaking major of an on-hold app. Path processes repo-controlled input at build time only.",
      "added": "2026-07-25"
    }
  ]
}
```

There is no automatic expiry here — the gate prints every excepted advisory on each run, and the file's own comment requires a quarterly review alongside `.trivyignore`. Remove an entry as soon as an in-range fix ships.

### Suppression hygiene rules

- Do not include secrets, private contacts, live IP addresses, or credential paths in suppression files.
- Explain why the finding is not reachable, not just that it has been reviewed.
- Review suppressions when a dependency moves from development tooling into production runtime.
- Prefer upgrading security-sensitive packages even when exposure is low.
- When a suppression expires or a fixed version ships, remove the suppression and upgrade.

---

## CI Scan Schedule and Gate Summary

| When | What runs | Blocks merge? |
| --- | --- | --- |
| Every push to `main` | Full security scan + container scan | Yes (composer, Trivy, TruffleHog, OWASP, npm audit) |
| Nightly (02:00 UTC) | Full security scan | Yes |
| PR touching package files | Dependency review (GitHub Dependency Graph) | Informational only (Dependency Graph not yet enabled) |

The full scan does not run on PRs by default. PR-time coverage comes from the dependency-review workflow and from the fact that every merge to `main` triggers the full scan.

---

## Related Checks

```bash
npm run check:docs
npm run check:version
```

Run the workflow-defined security checks in CI for release decisions. Do not run repeated local audits merely to recreate the same known noise classes.
