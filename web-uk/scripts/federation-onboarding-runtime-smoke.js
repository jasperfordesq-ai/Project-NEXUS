// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'federation-smoke-cookie-secret-1234567890';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'federation-smoke-session-secret-1234567890';
process.env.ACCESSIBLE_BACKEND_TARGET = process.env.ACCESSIBLE_BACKEND_TARGET || 'laravel';
process.env.TENANT_ID = process.env.TENANT_ID || '2';

const { CookieJar, extractCsrfToken, resolveOptions } = require('./laravel-runtime-smoke');
const api = require('../src/lib/api');
const app = require('../src/server');

const SETTING_KEYS = [
  'profile_visible_federated',
  'appear_in_federated_search',
  'show_skills_federated',
  'show_location_federated',
  'show_reviews_federated',
  'messaging_enabled_federated',
  'transactions_enabled_federated',
  'email_notifications',
  'service_reach',
  'travel_radius_km'
];

const EXPECTED_SELECTION = {
  federation_optin: true,
  profile_visible_federated: false,
  appear_in_federated_search: true,
  show_skills_federated: false,
  show_location_federated: true,
  show_reviews_federated: false,
  messaging_enabled_federated: false,
  transactions_enabled_federated: true,
  email_notifications: false,
  service_reach: 'travel_ok',
  travel_radius_km: 77
};

function settingsFrom(result) {
  const data = result && result.data ? result.data : result;
  return (data && data.settings) || {};
}

function assertSettingValues(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${label}: ${key} did not match the expected value.`);
    }
  }
}

function listen(appToListen) {
  return new Promise((resolve, reject) => {
    const server = appToListen.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createWebClient(baseUrl) {
  const cookies = new CookieJar();

  return async function request(path, { method = 'GET', form } = {}) {
    const headers = { Accept: 'text/html' };
    const cookieHeader = cookies.header();
    if (cookieHeader) headers.Cookie = cookieHeader;

    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: 'manual'
    });
    cookies.storeFrom(response.headers);

    return {
      response,
      text: await response.text()
    };
  };
}

async function restoreSettings(token, original) {
  const payload = { federation_optin: true };
  for (const key of SETTING_KEYS) payload[key] = original[key];

  await api.callFederationApi(token, 'POST', '/setup', payload);
  if (!original.federation_optin) {
    await api.callFederationApi(token, 'POST', '/opt-out');
  }

  const restored = settingsFrom(await api.callFederationApi(token, 'GET', '/settings'));
  assertSettingValues(restored, {
    federation_optin: Boolean(original.federation_optin),
    ...Object.fromEntries(SETTING_KEYS.map((key) => [key, original[key]]))
  }, 'fixture restoration');
}

async function runFederationOnboardingRuntimeSmoke(options = {}) {
  const config = resolveOptions(options, process.env);
  const directLogin = await api.login(config.email, config.password, config.tenant);
  const token = directLogin.access_token || directLogin.token;
  if (!token) throw new Error('Laravel login did not return an access token.');

  const original = settingsFrom(await api.callFederationApi(token, 'GET', '/settings'));
  for (const key of ['federation_optin', ...SETTING_KEYS]) {
    if (original[key] === undefined) {
      throw new Error(`Laravel federation settings did not expose ${key}; refusing to mutate the fixture.`);
    }
  }

  const server = await listen(app);
  const webBaseUrl = `http://127.0.0.1:${server.address().port}`;
  const web = createWebClient(webBaseUrl);
  const checks = [];
  let primaryError;

  try {
    if (original.federation_optin) {
      await api.callFederationApi(token, 'POST', '/opt-out');
    }

    const loginPage = await web('/login');
    const loginPost = await web('/login', {
      method: 'POST',
      form: {
        _csrf: extractCsrfToken(loginPage.text),
        email: config.email,
        password: config.password,
        tenant_slug: config.tenant
      }
    });
    if (loginPost.response.status !== 302) {
      throw new Error(`Web login returned ${loginPost.response.status}.`);
    }

    const hub = await web('/federation');
    if (!hub.text.includes('href="/federation/onboarding"') || !hub.text.includes('Opt in to federation')) {
      throw new Error('Federation hub did not expose the Laravel onboarding CTA.');
    }
    checks.push('hub-onboarding-cta');

    const privacy = await web('/federation/onboarding?step=privacy');
    const privacyPost = await web('/federation/onboarding', {
      method: 'POST',
      form: {
        _csrf: extractCsrfToken(privacy.text),
        step: 'privacy',
        appear_in_federated_search: 'on',
        show_location_federated: 'on'
      }
    });
    if (privacyPost.response.headers.get('location') !== '/federation/onboarding?step=communication') {
      throw new Error('Privacy step did not advance to communication.');
    }
    checks.push('privacy-session-retention');

    const communication = await web('/federation/onboarding?step=communication');
    const communicationPost = await web('/federation/onboarding', {
      method: 'POST',
      form: {
        _csrf: extractCsrfToken(communication.text),
        step: 'communication',
        transactions_enabled_federated: 'on',
        service_reach: 'travel_ok',
        travel_radius_km: '77'
      }
    });
    if (communicationPost.response.headers.get('location') !== '/federation/onboarding?step=confirm') {
      throw new Error('Communication step did not advance to confirm.');
    }
    checks.push('communication-session-retention');

    const confirm = await web('/federation/onboarding?step=confirm');
    if (!confirm.text.includes('Happy to travel up to 77 km')) {
      throw new Error('Confirm page did not retain the submitted travel choice.');
    }

    const confirmPost = await web('/federation/onboarding', {
      method: 'POST',
      form: {
        _csrf: extractCsrfToken(confirm.text),
        step: 'confirm'
      }
    });
    if (confirmPost.response.headers.get('location') !== '/federation?status=opted-in') {
      throw new Error('Confirm-only submit did not finish onboarding.');
    }
    checks.push('confirm-only-submit');

    const persisted = settingsFrom(await api.callFederationApi(token, 'GET', '/settings'));
    assertSettingValues(persisted, EXPECTED_SELECTION, 'Laravel read-back');
    checks.push('laravel-settings-read-back');
  } catch (error) {
    primaryError = error;
  }

  let restorationError;
  try {
    await restoreSettings(token, original);
    checks.push('fixture-settings-restored');
  } catch (error) {
    restorationError = error;
  }

  await close(server);

  if (restorationError) {
    const prefix = primaryError ? `${primaryError.message}; ` : '';
    throw new Error(`${prefix}fixture restoration failed: ${restorationError.message}`);
  }
  if (primaryError) throw primaryError;

  return {
    ok: true,
    webBaseUrl,
    laravelBaseUrl: config.laravelBaseUrl,
    tenant: config.tenant,
    checks
  };
}

async function main() {
  const result = await runFederationOnboardingRuntimeSmoke();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  runFederationOnboardingRuntimeSmoke
};
