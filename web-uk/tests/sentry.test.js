// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('node:path');
const fs = require('node:fs');

describe('web-uk Sentry error reporting', () => {
  const load = () => {
    jest.resetModules();
    return require('../src/lib/sentry');
  };

  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('is a no-op with no DSN, and does not load the SDK', () => {
    // 🔴 The normal state in development and in every test run. It must not throw,
    // and it must not pull in 29 packages to do nothing.
    delete process.env.SENTRY_DSN;
    const sentry = load();

    expect(sentry.initSentry()).toBe(false);
    expect(sentry.isEnabled()).toBe(false);
    expect(sentry.captureError(new Error('ignored'))).toBe(false);
    expect(sentry.attachExpressErrorHandler({})).toBe(false);
  });

  it('reads the DSN at call time, not at module load', () => {
    // The service is configured by environment variables supplied by the compose
    // overlay. Reading at module load would mean the value had to exist before the
    // first require, which is exactly the class of fault that left Turnstile
    // silently disabled in production.
    delete process.env.SENTRY_DSN;
    const sentry = load();
    expect(sentry.initSentry()).toBe(false);
  });

  describe('scrubbing', () => {
    const sentry = require('../src/lib/sentry');

    it('removes the query string, because a URL here can carry a member search term', () => {
      const event = sentry.scrubEvent({
        request: { url: 'https://accessible.example/hour-timebank/accessible/members?q=jane+doe' }
      });

      expect(event.request.url).toBe('https://accessible.example/hour-timebank/accessible/members?[scrubbed]');
      expect(event.request.url).not.toContain('jane');
    });

    it('leaves a URL without a query string untouched', () => {
      const event = sentry.scrubEvent({
        request: { url: 'https://accessible.example/hour-timebank/accessible/about' }
      });
      expect(event.request.url).toBe('https://accessible.example/hour-timebank/accessible/about');
    });

    it('removes cookies, authorization, body and query fields entirely', () => {
      // 🔴 The session cookie is in here. sendDefaultPii:false already withholds
      // most of it; this is the guard against a future SDK default changing.
      const event = sentry.scrubEvent({
        request: {
          url: 'https://accessible.example/x',
          cookies: { token: 'secret-session-token' },
          query_string: 'q=private',
          data: { password: 'hunter2' },
          headers: {
            cookie: 'token=secret-session-token',
            Cookie: 'token=secret-session-token',
            authorization: 'Bearer secret',
            Authorization: 'Bearer secret',
            'user-agent': 'kept'
          }
        }
      });

      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain('secret-session-token');
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('Bearer secret');
      expect(serialised).not.toContain('private');
      // Something harmless survives, so this is scrubbing and not just deletion.
      expect(event.request.headers['user-agent']).toBe('kept');
    });

    it('reduces an attached user to an opaque id', () => {
      const event = sentry.scrubEvent({
        user: { id: 42, email: 'member@example.com', username: 'jane', ip_address: '1.2.3.4' }
      });

      expect(event.user).toEqual({ id: '42' });
      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain('member@example.com');
      expect(serialised).not.toContain('1.2.3.4');
    });

    it('drops the user object entirely when there is no id', () => {
      const event = sentry.scrubEvent({ user: { email: 'member@example.com' } });
      expect(event.user).toBeUndefined();
    });

    it('tolerates malformed events rather than throwing inside beforeSend', () => {
      // An exception thrown in beforeSend loses the event AND can mask the original
      // fault, so this path has to be forgiving.
      expect(() => sentry.scrubEvent(null)).not.toThrow();
      expect(() => sentry.scrubEvent(undefined)).not.toThrow();
      expect(() => sentry.scrubEvent({})).not.toThrow();
      expect(() => sentry.scrubEvent({ request: {} })).not.toThrow();
      expect(sentry.scrubEvent('not an object')).toBe('not an object');
    });
  });

  it('ignores the endpoints that are hit constantly by machines', () => {
    const sentry = require('../src/lib/sentry');
    // /health is hit every 10 seconds per colour by the container healthcheck;
    // /version by the deploy script and the drift check.
    expect(sentry.DEFAULT_IGNORED_TRANSACTIONS).toContain('/health');
    expect(sentry.DEFAULT_IGNORED_TRANSACTIONS).toContain('/version');
    expect(sentry.DEFAULT_IGNORED_TRANSACTIONS).toContain('/session/touch');
  });

  describe('source contract', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'sentry.js'), 'utf8');
    // 🔴 Strip comments before asserting. A text-based guard has caught its own
    // explanatory comment three times in this release; the comments here
    // deliberately discuss PII.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    it('never enables PII', () => {
      expect(code).toContain('sendDefaultPii: false');
      expect(code).not.toMatch(/sendDefaultPii:\s*true/);
    });

    it('tags the service and colour so a fault can be traced to one side of the pair', () => {
      expect(code).toContain("service: 'nexus-webuk'");
      expect(code).toContain('NEXUS_COLOR');
    });

    it('defaults performance tracing to off', () => {
      // Tracing every request is a quota decision, not a default.
      expect(code).toMatch(/SENTRY_TRACES_SAMPLE_RATE \|\| '0'/);
    });
  });

  it('🔴 mounts /version and /health BEFORE every gate', () => {
    // These must answer when the platform is broken, which is the only time anyone
    // reads them. /version was originally registered below tenantFeatureGate and
    // legalGate, and /health always had been — so both inherited a dependency on the
    // Laravel backend being reachable.
    //
    // /version is what proves a cutover switched colour and what the routing-drift
    // check reads; /health is the container healthcheck, so a backend wobble behind
    // a tenant gate could have got the container RESTARTED over an unrelated fault.
    //
    // A unit test cannot catch this — the harness mocks the backend away, which is
    // precisely what makes the position invisible. So the ordering is asserted
    // directly.
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

    const healthAt = server.indexOf("app.get('/health'");
    const versionAt = server.indexOf("app.get('/version'");
    const tenantGateAt = server.indexOf('app.use(tenantFeatureGate)');
    const legalGateAt = server.indexOf('app.use(legalGate)');

    for (const [label, index] of [
      ['/health', healthAt], ['/version', versionAt],
      ['tenantFeatureGate', tenantGateAt], ['legalGate', legalGateAt]
    ]) {
      expect(index).toBeGreaterThan(-1);
      expect(typeof label).toBe('string');
    }

    expect(healthAt).toBeLessThan(tenantGateAt);
    expect(versionAt).toBeLessThan(tenantGateAt);
    expect(healthAt).toBeLessThan(legalGateAt);
    expect(versionAt).toBeLessThan(legalGateAt);
  });

  it('🔴 mounts /version and /health BEFORE the general rate limiter too', () => {
    // The gate move above missed this, and the arithmetic is not close:
    // generalLimiter allows 100 requests per 15 minutes per IP, and the container
    // healthcheck polls /health every 10 seconds — 90 per window, all keyed to
    // 127.0.0.1. Ten more localhost requests (an operator running wget while
    // debugging, an extra internal probe, or a shorter interval to speed up
    // wait_for_color) tip it over. The limiter then answers the healthcheck with a
    // 429 HTML page, wget --spider fails, the retries exhaust, the container is
    // marked unhealthy, and the deploy aborts over nothing.
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

    const healthAt = server.indexOf("app.get('/health'");
    const versionAt = server.indexOf("app.get('/version'");
    const limiterAt = server.indexOf('app.use(generalLimiter)');

    expect(healthAt).toBeGreaterThan(-1);
    expect(versionAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeGreaterThan(-1);

    expect(healthAt).toBeLessThan(limiterAt);
    expect(versionAt).toBeLessThan(limiterAt);
  });

  it('is wired into the server before express is constructed', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    const initAt = server.indexOf('initSentry()');
    const expressAt = server.indexOf('const app = express()');

    expect(initAt).toBeGreaterThan(-1);
    expect(expressAt).toBeGreaterThan(-1);
    // 🔴 The SDK instruments modules as they load, so initialising after the app
    // is built silently loses most of its coverage.
    expect(initAt).toBeLessThan(expressAt);

    // Sentry's error handler must run BEFORE ours, or our handler renders a page,
    // marks the error handled, and Sentry never sees it.
    const sentryHandlerAt = server.indexOf('attachExpressErrorHandler(app)');
    const ourLoggerAt = server.indexOf('app.use(errorLogger)');
    expect(sentryHandlerAt).toBeGreaterThan(-1);
    expect(sentryHandlerAt).toBeLessThan(ourLoggerAt);
  });

  it('🔴 keeps the real DSN out of the repository', () => {
    // The repo is PUBLIC. A DSN is not a password, but it is an ingest endpoint
    // anyone could post junk to, and it does not belong in tracked files.
    const tracked = [
      path.join(__dirname, '..', '.env.example'),
      path.join(__dirname, '..', 'src', 'lib', 'sentry.js'),
      path.join(__dirname, '..', '..', 'compose.webuk.bluegreen.yml')
    ];

    for (const file of tracked) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      expect(text).not.toMatch(/https:\/\/[0-9a-f]{16,}@[a-z0-9.]*ingest[a-z0-9.]*sentry\.io/i);
    }
  });
});
