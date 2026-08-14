// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK Design System conventions that are easy to lose and hard to notice.
 *
 * Added 2026-08-13 after a GDS-standards audit. Each test here pins a convention that
 * was ABSENT and is now implemented, so it cannot silently regress.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getTenantBootstrap: jest.fn().mockResolvedValue({
    data: { id: 2, name: 'Test Community', slug: 'test', modules: {}, features: {} },
  }),
  submitContactMessage: jest.fn(),
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const read = (p) => fs.readFileSync(path.join(VIEWS, p), 'utf8');

describe('GDS conventions', () => {
  describe('"Error: " page-title prefix (validation failures)', () => {
    /**
     * 🔴 GDS: a form page re-rendering with a validation error must prefix its <title>
     * with "Error: " so a screen reader announces the failure before anything else.
     * Neither accessible frontend did this — a shared gap with Blade, fixed because
     * GOV.UK guidance wins (owner decision 2026-08-13).
     */
    it('computes the prefix centrally from the validation locals actually in use', () => {
      const base = read('layouts/base.njk');
      expect(base).toContain('{% set pageValidationFailed =');
      // The four validation surfaces in use across the app.
      for (const local of ['pageHasErrors', 'hasErrors', 'error', 'errors | length']) {
        expect(base).toContain(local);
      }
      // Translated, not hardcoded English.
      expect(base).toContain("t('states.error_prefix')");
      // Actually applied to the title.
      expect(base).toContain('{{ titleErrorPrefix }}{{ resolvedPageTitle }}');
    });

    /**
     * 🔴 `errorMessage` must NOT trigger the prefix. It drives NOTIFICATION banners for
     * page-level failures ("we could not load…") on ~24 pages, not field validation.
     * Including it would announce "Error:" on pages with nothing to correct.
     */
    it('does not treat notification-banner errorMessage as a validation failure', () => {
      const base = read('layouts/base.njk');
      const expr = /\{% set pageValidationFailed =[^%]*%\}/.exec(base);
      expect(expr).not.toBeNull();
      expect(expr[0]).not.toContain('errorMessage');
    });

    /**
     * Every template that overrides the pageTitle block must re-emit the prefix, or it
     * is silently lost on exactly the pages that need it.
     */
    it('keeps the prefix on all four pageTitle overrides', () => {
      for (const file of ['login.njk', 'register.njk', 'forgot-password.njk', 'reset-password.njk']) {
        const source = read(file);
        expect(source).toMatch(/\{%\s*block pageTitle\s*%\}\{\{ titleErrorPrefix \}\}/);
      }
    });
  });

  describe('back links on question pages', () => {
    /**
     * GDS: a question page offers a back link in a consistent position at the top.
     * Reuses only EXISTING translated keys — new keys are blocked on Irish translation.
     */
    it('gives the question pages that lacked one a back link', () => {
      expect(read('reset-password.njk')).toContain('govuk-back-link');
      expect(read('search/advanced.njk')).toContain('govuk-back-link');
    });

    /**
     * 🔴 Deliberately absent, do not "fix": sign-in step 1 has no previous step, so a
     * back link there would point nowhere meaningful. The 2FA step already has one.
     * Registration likewise has no previous step — its "already have an account" link
     * is a different affordance.
     */
    it('does not add a back link to pages with no previous step', () => {
      const login = read('login.njk');
      // The only back link in login.njk is inside the 2FA branch.
      const beforeTwoFactor = login.split('show2fa')[0];
      expect(beforeTwoFactor).not.toContain('govuk-back-link');
    });
  });

  describe('cookie banner', () => {
    /**
     * 🔴 GDS specifies a BUTTON for "Hide cookie message", not a link: the control
     * dismisses a message, it does not navigate. Must keep working without JavaScript,
     * so it is a real form submit rather than a JS dismiss.
     */
    it('hides the confirmation with a button, submitted without JavaScript', () => {
      const banner = read('partials/cookie-banner.njk');
      expect(banner).toContain('/cookie-consent/hide');
      expect(banner).toMatch(/<button type="submit"[^>]*>\{\{ t\("cookie_banner\.hide"\)/);
      expect(banner).not.toMatch(/<a class="govuk-link" href="\{\{ currentUrl \}\}">\{\{ t\("cookie_banner\.hide"\)/);
    });

    it('serves the hide route with CSRF protection and a safe local redirect', () => {
      const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
      const route = /app\.post\('\/cookie-consent\/hide'[\s\S]{0,600}?\}\);/.exec(server);
      expect(route).not.toBeNull();
      expect(route[0]).toContain('doubleCsrfProtection');
      expect(route[0]).toContain('safeLocalPath');
    });
  });

  describe('session timeout', () => {
    /**
     * 🔴 The client used to hardcode 30 minutes independently of the Express session
     * maxAge, so changing the server's session length silently desynchronised the
     * warning — firing after the session had already died, or minutes early, with
     * nothing failing. res.locals.sessionTimeout existed and was consumed by nothing.
     */
    it('takes the session length from the server, not a hardcoded client constant', () => {
      const base = read('layouts/base.njk');
      expect(base).toContain('data-session-timeout-minutes="{{ sessionTimeout }}"');

      const script = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'js', 'timeout-warning.js'), 'utf8'
      );
      expect(script).toContain('[data-session-timeout-minutes]');
      expect(script).toContain('resolveSessionTimeoutMinutes');
      // The fallback must not be able to produce a negative warning window.
      expect(script).toContain('declared > WARNING_BEFORE_MINUTES');
    });

    /**
     * 🔴 The timeout modal has always posted `timeout=true`; the logout handler ignored
     * it and told the member "You have signed out.", implying they chose to. Reuses the
     * already-translated states.auth_required rather than adding an untranslatable key.
     */
    it('distinguishes an expired session from a deliberate sign-out', () => {
      const auth = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
      expect(auth).toContain('signedOutByTimeout');
      expect(auth).toContain("'/login?status=auth-required'");
      expect(auth).toContain("'/login?status=signed-out'");
    });
  });

  describe('consistent help (WCAG 2.2 3.2.6)', () => {
    /**
     * 🔴 A help mechanism must appear in the same relative place on EVERY page.
     * alphaFooterColumns returned [] whenever no tenant was routed, which deleted the
     * entire footer — Help centre and Contact included — from the shared root and
     * tenant chooser. The one page a lost visitor is most likely to be on offered no
     * route to help at all.
     *
     * The tenant-specific columns still require a tenant (module/feature gated). Only
     * the Support column renders tenant-free, because /help, /contact, /about and
     * /trust-and-safety all resolve un-prefixed on the shared host.
     */
    it('keeps the Support column when no tenant is routed', () => {
      const { buildShellLocals } = require('../src/lib/accessible-shell');
      const locals = buildShellLocals({ query: {}, path: '/', originalUrl: '/' }, false);

      const keys = locals.alphaFooterColumns.map((c) => c.key);
      expect(keys).toContain('support');

      const support = locals.alphaFooterColumns.find((c) => c.key === 'support');
      const hrefs = support.links.map((l) => l.href);
      expect(hrefs).toContain('/help');
      expect(hrefs).toContain('/contact');
    });

    it('still gates the tenant-specific columns behind a routed tenant', () => {
      const { buildShellLocals } = require('../src/lib/accessible-shell');
      const locals = buildShellLocals({ query: {}, path: '/', originalUrl: '/' }, false);
      const keys = locals.alphaFooterColumns.map((c) => c.key);
      expect(keys).not.toContain('platform');
    });
  });

  describe('production hardening', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

    /**
     * 🔴 This process had NO signal handler. The Dockerfile runs node as PID 1 with no
     * init and no STOPSIGNAL, so `docker stop` delivers SIGTERM straight to it and
     * Node's default is to exit immediately — severing in-flight responses and dropping
     * Redis without a quit. On a blue/green switch that is exactly when traffic is
     * still arriving.
     */
    it('shuts down gracefully on SIGTERM and SIGINT', () => {
      expect(server).toContain("process.on('SIGTERM'");
      expect(server).toContain("process.on('SIGINT'");
      expect(server).toContain('server.close(');
      // Redis must be closed, not dropped.
      expect(server).toContain('sessionStore.client.quit');
      // Sentry transmission is async; exiting without flushing loses the events.
      expect(server).toContain('flushSentry');
    });

    /**
     * A hung keep-alive socket must not hold the container past the orchestrator's
     * grace period — being SIGKILLed is the outcome graceful shutdown exists to avoid.
     */
    it('bounds shutdown with an unref-ed timeout and is idempotent', () => {
      expect(server).toContain('SHUTDOWN_TIMEOUT_MS');
      expect(server).toContain('forceExit.unref()');
      expect(server).toContain('if (shuttingDown) return;');
    });

    /**
     * The urlencoded `verify` hook buffers the entire raw body onto the request, so the
     * limit is the only thing bounding that copy. Left implicit it was Express's
     * undocumented-at-the-call-site 100kb default.
     */
    it('states body size limits explicitly', () => {
      expect(server).toContain("const BODY_LIMIT = '256kb'");
      expect(server).toContain('limit: BODY_LIMIT');
      expect(server).toContain('express.json({ limit: BODY_LIMIT })');
    });
  });

  describe('error-message visually-hidden prefix (translated, not English "Error")', () => {
    /**
     * 🔴 govuk-frontend's error-message macro defaults its visually-hidden prefix to the
     * hardcoded English "Error". A screen reader in any other language heard "Error"
     * immediately before the translated message. Every `errorMessage:` object that
     * carries text/html must pass `visuallyHiddenText` sourced from the translated
     * `states.error_prefix`, with the key's own colon stripped (the macro re-adds one,
     * so passing "Error:" straight renders "Error::").
     */
    it('every errorMessage object in the views supplies a translated visuallyHiddenText', () => {
      const fs2 = require('node:fs');
      const VIEWS = path.join(__dirname, '..', 'src', 'views');
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs2.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(entry.parentPath ?? dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.name.endsWith('.njk')) continue;
          const src = fs2.readFileSync(full, 'utf8');
          // Each `errorMessage: {` object must contain visuallyHiddenText within a small
          // window (single-line or the few-line multiline form used in groups/*).
          let idx = src.indexOf('errorMessage: {');
          while (idx !== -1) {
            const window = src.slice(idx, idx + 220);
            if (!window.includes('visuallyHiddenText')) {
              offenders.push(`${path.relative(VIEWS, full)} @${idx}`);
            }
            idx = src.indexOf('errorMessage: {', idx + 1);
          }
        }
      };
      walk(VIEWS);
      expect(offenders).toEqual([]);
    });

    it('strips the key colon so the prefix renders once, not "Error::"', () => {
      // Both spellings must use the replace/trim form; a raw t("states.error_prefix")
      // (which ends in a colon) would double up against the macro's own colon.
      const fs2 = require('node:fs');
      const VIEWS = path.join(__dirname, '..', 'src', 'views');
      const raw = [];
      const walk = (dir) => {
        for (const entry of fs2.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(entry.parentPath ?? dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.name.endsWith('.njk')) continue;
          const src = fs2.readFileSync(full, 'utf8');
          // A visuallyHiddenText fed from the prefix key but NOT stripped.
          const re = /visuallyHiddenText:\s*t\("states\.error_prefix"\)(?!\s*\|\s*replace)/g;
          if (re.test(src)) raw.push(path.relative(VIEWS, full));
        }
      };
      walk(VIEWS);
      expect(raw).toEqual([]);
    });
  });

  describe('rendered behaviour', () => {
    let app;
    beforeAll(() => {
      jest.resetModules();
      app = require('../src/server');
    });

    /**
     * End-to-end proof rather than source inspection: an empty contact submission must
     * come back with both the error summary AND the prefixed title.
     */
    it('prefixes the title when the contact form comes back with errors', async () => {
      const agent = request.agent(app);
      const page = await agent.get('/test/accessible/contact');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text);
      expect(csrf).not.toBeNull();

      const posted = await agent
        .post('/test/accessible/contact')
        .type('form')
        .send({ _csrf: csrf[1] });

      // POST-redirect-GET: follow to the page that renders the errors.
      const location = posted.headers.location || '/test/accessible/contact';
      const shown = await agent.get(location.replace(/^https?:\/\/[^/]+/, ''));

      expect(shown.text).toContain('govuk-error-summary');
      expect(shown.text).toMatch(/<title>Error: /);
    });
  });
});
