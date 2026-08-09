# CodeQL high-severity triage for PR 169

Date: 2026-08-09

Scope: draft consolidation PR `codex/platform-monorepo`

Evidence: GitHub code-scanning alerts queried with `pr=169` before this remediation

## Baseline

- 150 alerts were associated with the pull request: 29 open high severity, 95 open medium severity, 23 previously dismissed high-severity alerts, and 3 previously dismissed medium-severity alerts.
- 26 of the 29 open high-severity alerts were in the newly imported Web UK tree.
- This triage does not waive the medium-severity findings. They remain a separate, route-by-route validation queue.

## Remediated in this branch

The following reachable runtime patterns now have regression coverage and code changes:

- Eight Web UK HTML-to-text conversions no longer use incomplete tag-stripping regular expressions. They use `sanitize-html` through the shared `htmlToPlainText` helper, which drops script/style/non-text elements before producing plain text.
- Seven email checks no longer use the polynomial regular expression identified by CodeQL. They use the shared, length-bounded `isValidEmail` parser.
- The session-timeout client accepts its rendered tenant login URL only when it is a same-origin absolute path (`/…`, but not `//…`); otherwise it uses `/login`.

Expected alert impact after the replacement scan: 16 Web UK high-severity alerts should close (8 incomplete multi-character sanitization, 7 polynomial ReDoS, 1 DOM redirect/XSS flow).

## Reviewed findings that are not reachable vulnerabilities

### Rate limiting (3)

- `web-uk/src/routes/events.js`: the flagged mutation is mounted behind the application-wide `generalLimiter` and `postOnly(formLimiter)` in `src/server.js`.
- `web-uk/src/routes/blog.js` and `web-uk/src/routes/polls.js`: these legacy route modules are not imported or mounted by `src/server.js`. The active blog and poll modules are also mounted behind the global and form limiters.

Disposition: false positive / unreachable duplicate module. Do not add a second limiter at the flagged lines.

### Token validation (3)

- `web-uk/src/server.js`: `cookieParser(COOKIE_SECRET)` initializes signed-cookie verification; authentication reads `req.signedCookies.token`, not the unsigned cookie collection.
- The other two alerts are in Jest fixtures that create deliberately simplified request objects and are not runtime code.

Disposition: false positive. Signed-cookie and CSRF middleware tests remain the controlling evidence.

### Development-only scanners (5)

- Four findings are in Web UK localization, visual-check, and ledger generator scripts. Their regular expressions parse checked-out templates/source or generated Markdown; they do not process HTTP request data or render runtime HTML.
- `scripts/check-admin-ui-literals.mjs` similarly inspects checked-out TSX source and does not sanitize runtime input.

Disposition: false positive for runtime exploitability. Keep these tools non-production and do not reuse their parsers as request sanitizers.

### React Markdown export (2)

`CommercialBoundaryAdminPage.tsx` escapes pipe and newline characters while generating a downloaded Markdown report. The values are not injected into HTML and the escaping is formatting, not a security sanitizer.

Disposition: false positive for XSS/sanitization. Preserve the Markdown-only output boundary.

## Remaining required work

- Let CodeQL rescan the replacement SHA and confirm the 16 expected high-severity closures.
- Review any high alert that remains at a remediated line before classifying it.
- Triage the 95 open medium alerts separately, beginning with the server-side redirect group; validate each redirect sink against the shared local-return URL guard rather than dismissing the group wholesale.
- Do not merge while a newly reachable high-severity alert remains unexplained or unremediated.
