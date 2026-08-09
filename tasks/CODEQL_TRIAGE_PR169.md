# CodeQL triage for PR 169

Date: 2026-08-09

Scope: draft consolidation PR `codex/platform-monorepo`

Evidence: GitHub code-scanning alerts queried with `pr=169` at commit
`3d4a67c4e375c1bf4fef51697000c11c44feab8e`, followed by source and data-flow
review of every alert newly attributed to the PR.

## Result

- The replacement scan reported 105 new alerts: 10 high and 95 medium.
- All 105 were reviewed and given an individual, evidence-bearing disposition
  in GitHub. The PR CodeQL check changed from failure to success.
- Three high alerts remain open on the PR query, but all three pre-date this PR:
  two Markdown-export formatting findings in the React administration client
  and one static source-scanner finding. They are not counted as new alerts by
  the PR gate.
- CodeQL and its severity threshold remain enabled and unchanged.

## High-severity findings introduced by the imported Web UK tree

### Rate limiting (3)

- `web-uk/src/routes/events.js`: the flagged mutation is mounted behind the
  application-wide `generalLimiter` and `postOnly(formLimiter)` in
  `src/server.js`.
- `web-uk/src/routes/blog.js` and `web-uk/src/routes/polls.js`: these legacy
  router modules are not imported or mounted by `src/server.js`. The active
  blog and poll implementations are mounted behind the global and form
  limiters.

Disposition: false positive / unreachable duplicate module. No rate-limit
policy or thresholds were changed.

### Token validation (3)

- `web-uk/src/server.js`: `cookieParser(COOKIE_SECRET)` performs signed-cookie
  verification and authentication reads `req.signedCookies.token`, not the
  unsigned cookie collection. State-changing routes use the double-CSRF
  middleware.
- The other two findings are Jest fixtures with deliberately simplified
  request objects; they are not deployed handlers.

Disposition: runtime false positive plus two test-only findings.

### Development-only source scanners (4)

The localization audit, visual-check, and API-ledger scripts inspect checked-out
templates or source and produce local diagnostic text or Markdown. They do not
process HTTP request data or render runtime HTML.

Disposition: false positive for runtime exploitability. These parsers must not
be reused as sanitizers for untrusted runtime input.

## Medium-severity findings

### Server-side redirects (92)

- 88 alerts share the same reported taint source: a Jest onboarding fixture
  that deliberately assigns request-derived test data to `res.locals.urlFor`.
  Production tenant-routing middleware owns that function; the route sinks use
  application-constructed local paths.
- Two tenant-routing redirects construct a fixed local pathname and append only
  the original query suffix. The request cannot select a scheme or host.
- The cookie-consent return redirect and notification return redirect pass the
  shared local-return guard. The guard was additionally hardened to reject
  backslashes, encoded and double-encoded protocol-relative paths, control
  characters, and malformed percent escapes. Focused Jest coverage exercises
  these cases.

Disposition: 90 data-flow false positives and two guarded redirects with
additional defense-in-depth hardening.

### Test cookies (2)

Both alerts point to cookie-shaped Jest input used to exercise authentication
and onboarding behavior. They do not configure or transmit production cookies.

Disposition: used in tests.

### Sensitive GET value (1)

The flagged value is a numeric employer ID read from a route path parameter,
not sensitive data supplied in a GET query string. It selects a public employer
profile.

Disposition: false positive.

## Verification

- `npm.cmd test -- --runInBand tests/url-validator.test.js tests/federation-onboarding-session.test.js`
- Result: 2 suites passed, 18 tests passed.
- `npm.cmd run lint`
- Result: passed.
- `npm.cmd test -- --runInBand`
- Result: 58 suites passed, 1,779 tests passed.
- GitHub CodeQL aggregate check: success after the 105 new-alert dispositions.
- A fresh CodeQL scan is still required on the final pushed SHA to prove that
  the committed hardening and alert fingerprints remain correctly classified.

## Merge boundary

Do not merge if a fresh scan introduces a new unexplained alert or if any
runtime reachability assumption above changes. The three older branch alerts
remain a separate remediation queue and are not waived by this PR triage.
