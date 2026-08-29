// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Run the Maestro end-to-end flows against the LOCAL API.
 *
 * This exists because getting these device flows to run at all took an afternoon of
 * dead ends, and every one of them is a precondition that fails silently. The
 * script checks each precondition up front and says which one is wrong, instead of
 * letting Maestro report a missing button eight times.
 *
 * 🔴 IT MUST BE A DEBUG BUILD. `lib/constants.ts` refuses a loopback API URL when
 * `__DEV__` is false and falls back to production — so a RELEASE build silently
 * talks to api.project-nexus.ie, where the seeded test accounts do not exist, and
 * every flow fails on "Invalid credentials". That is the guard working correctly
 * (it was added after a stale .env.local poisoned a production bundle in
 * 2026-06-12); it just makes release builds useless for local E2E.
 *
 * 🔴 CLEARTEXT MUST BE PERMITTED. A network security config overrides
 * `android:usesCleartextTraffic` on API 24+, so the debug manifest's exemption did
 * nothing on its own and the app could reach neither the API on :8090 nor Metro on
 * :8081. `android-network-security-config.debug.xml` fixes that per-variant;
 * `npm run verify:network-security` proves production is still pinned.
 *
 * 🔴 ANIMATIONS MUST BE ON. With animation scales at 0 (which the screenshot
 * tooling sets for determinism) Android reports reduced motion, Reanimated logs a
 * dev warning, and LogBox draws a banner across the BOTTOM of the screen — over
 * the tab bar. Taps on the "More" tab then hit the banner, and five flows failed
 * on a "View wallet" they never navigated to. This script restores the scales
 * before running.
 *
 * Usage (from mobile/):
 *   npm run e2e
 *   node scripts/e2e.mjs --flow .maestro/01-auth-login.yaml
 *   node scripts/e2e.mjs --serial emulator-5554
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const APP_ID = 'ie.project.nexus';

const args = process.argv.slice(2);
const flowTarget = argValue('--flow', '.maestro/');
const requestedSerial = argValue('--serial', process.env.ANDROID_SERIAL || '');
const email = argValue('--email', process.env.E2E_TEST_EMAIL || 'e2e.user.a@project-nexus.local');
const password = argValue('--password', process.env.E2E_TEST_PASSWORD || 'TestPassword123!');

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function sdkTool(dir, names) {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    for (const n of names) {
      const p = path.join(home, dir, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return names[0].replace(/\.exe$/, '');
}

const ADB = sdkTool('platform-tools', ['adb.exe', 'adb']);
const MAESTRO = process.platform === 'win32'
  ? path.join(os.homedir(), '.maestro', 'bin', 'maestro.bat')
  : path.join(os.homedir(), '.maestro', 'bin', 'maestro');

function adb(a, { host = false } = {}) {
  const serialArgs = !host && selectedSerial ? ['-s', selectedSerial] : [];
  return execFileSync(ADB, [...serialArgs, ...a], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const attachedDevices = adb(['devices'], { host: true })
  .split('\n')
  .slice(1)
  .filter((line) => line.trim().endsWith('device'))
  .map((line) => line.trim().split(/\s+/)[0]);

let selectedSerial = requestedSerial;
if (!selectedSerial && attachedDevices.length === 1) selectedSerial = attachedDevices[0];

const problems = [];

function check(label, fn) {
  try {
    const detail = fn();
    console.log(`e2e: ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    console.log(`e2e: FAIL ${label}`);
    problems.push(`${label}: ${err.message}`);
  }
}

console.log('e2e: checking preconditions\n');

check('a device is attached', () => {
  if (attachedDevices.length === 0) throw new Error('none. Run `npm run emulator:start`.');
  if (!selectedSerial) {
    throw new Error(
      `${attachedDevices.length} devices are attached (${attachedDevices.join(', ')}). ` +
        'Choose one with `--serial <id>` or ANDROID_SERIAL.',
    );
  }
  if (!attachedDevices.includes(selectedSerial)) {
    throw new Error(`${selectedSerial} is not attached. Available: ${attachedDevices.join(', ')}`);
  }
  return selectedSerial;
});

check('the app is installed', () => {
  if (!adb(['shell', 'pm', 'list', 'packages', APP_ID]).includes(APP_ID)) {
    throw new Error(`${APP_ID} is not installed. Run \`npx expo run:android\` (needs JDK 17).`);
  }
  return APP_ID;
});

check('it is a DEBUG build (a release build talks to production)', () => {
  // `pm dump` reports the debuggable flag. A release build here means every flow
  // will fail on "Invalid credentials" against the live API.
  const dump = adb(['shell', 'dumpsys', 'package', APP_ID]);
  if (!/DEBUGGABLE/.test(dump) && !/flags=\[[^\]]*DEBUGGABLE/.test(dump)) {
    throw new Error(
      'the installed app is not debuggable, so it is a release build. It will refuse the ' +
        'loopback API URL and use production instead, where the seeded accounts do not exist.'
    );
  }
  return 'debuggable';
});

check('animations are enabled (LogBox banner would cover the tab bar)', () => {
  const scale = adb(['shell', 'settings', 'get', 'global', 'animator_duration_scale']).trim();
  if (scale === '0' || scale === '0.0') {
    // Fix rather than fail: the screenshot tooling sets this and it is safe to undo.
    for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
      adb(['shell', 'settings', 'put', 'global', k, '1']);
    }
    return 'restored from 0 to 1';
  }
  return `scale ${scale || '1'}`;
});

check('the device is awake and the keyguard is disabled', () => {
  // Emulator snapshots can restore a locked device, and long screenshot/test runs can
  // let it lock again. Maestro then tests Android's PIN screen and reports every app
  // assertion as false. Keep the local runner aligned with the CI emulator setup.
  adb(['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '7']);
  adb(['shell', 'locksettings', 'set-disabled', 'true']);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  adb(['shell', 'wm', 'dismiss-keyguard']);
  adb(['shell', 'input', 'keyevent', '82']);
  return 'awake; stay-awake enabled; keyguard disabled';
});

check('the local queue has a worker (bells, emails and push are queued)', () => {
  /*
    🔴 Nothing queued happens locally unless someone runs a worker, and the silence looks
    exactly like a bug. Measured on 2026-08-24 while chasing "a message produces no
    notification": 33 jobs were sitting in `queues:default` with no worker, so no bell, no
    email and no push had fired for any of them. Running
    `docker exec nexus-php-app php artisan queue:work --stop-when-empty` produced the bell
    immediately — the product was fine, the environment was not.

    Reported rather than enforced: a flow that never triggers a queued listener does not
    need a worker, and starting one from here would hide the very thing worth knowing.
  */
  try {
    const depth = execFileSync('docker', ['exec', 'nexus-php-redis', 'redis-cli', 'LLEN', 'queues:default'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const waiting = Number.parseInt(depth, 10);
    if (!Number.isFinite(waiting)) return 'queue depth unknown (redis not reachable)';
    if (waiting === 0) return 'nothing waiting';
    return `${waiting} job(s) WAITING — no bell, email or push will fire until a worker `
      + 'runs: docker exec nexus-php-app php artisan queue:work --stop-when-empty';
  } catch {
    return 'could not read the queue (docker or redis not available)';
  }
});

check('LogBox is suppressed for this build (a banner covers the tab bar)', () => {
  /*
    🔴 Not cosmetic. The LogBox banner sits over the bottom of the screen, on top of the
    tab bar, and swallows the tap — which broke four of these flows on 2026-08-24
    (`02-auth-logout`, `03-browse-listings`, `04-browse-groups`, `08-search-flow`) while
    every unit test passed. Measured on a device: dismiss the banner and the same tap
    navigates immediately.

    Reported rather than enforced: the flag is inlined into the bundle, so setting it now
    would need Metro restarted before it took effect, and a developer running one flow by
    hand can simply dismiss the banner. CI sets it in the workflow.
  */
  const flag = readEnvLocal('EXPO_PUBLIC_E2E');
  if (flag === '1') return 'EXPO_PUBLIC_E2E=1';
  return 'NOT set — a warning banner can swallow a tab tap. Add EXPO_PUBLIC_E2E=1 to '
    + 'mobile/.env.local and restart Metro, or dismiss the banner by hand.';
});

check('the local API is reachable and accepts the test account', () => {
  const apiUrl = readEnvLocal('EXPO_PUBLIC_API_URL') || 'http://10.0.2.2:8090';
  const tenant = readEnvLocal('EXPO_PUBLIC_DEFAULT_TENANT') || 'hour-timebank';
  // The emulator reaches the host on 10.0.2.2; from here that same server is
  // 127.0.0.1, so rewrite before testing from the host side.
  const hostUrl = apiUrl.replace(/\/\/10\.0\.[23]\.2\b/, '//127.0.0.1');

  const probe = spawnSync(
    'curl',
    ['-s', '--max-time', '15', '-X', 'POST', `${hostUrl}/api/auth/login`,
      '-H', 'Content-Type: application/json', '-H', `X-Tenant-Slug: ${tenant}`,
      '-d', JSON.stringify({ email, password })],
    { encoding: 'utf8' }
  );
  if (probe.status !== 0) throw new Error(`curl failed against ${hostUrl}`);
  if (!/"success"\s*:\s*true/.test(probe.stdout)) {
    throw new Error(
      `${hostUrl} did not accept ${email}. Is the stack up (\`npm run dev:docker\`) and seeded ` +
        `(\`php artisan db:seed --class=E2ETestDataSeeder\`)?`
    );
  }
  return `${apiUrl} (tenant ${tenant})`;
});

check('Metro is serving (a debug build fetches its JS at runtime)', () => {
  const probe = spawnSync('curl', ['-s', '--max-time', '8', 'http://127.0.0.1:8081/status'], { encoding: 'utf8' });
  if (!/packager-status:running/.test(probe.stdout || '')) {
    throw new Error('nothing on :8081. Run `npx expo start` in another terminal.');
  }
  // `adb reverse` is device state and disappears after an emulator reboot. Expo
  // normally creates it, but a restarted device can otherwise show a blank native
  // root while this host-side probe still says Metro is healthy.
  adb(['reverse', 'tcp:8081', 'tcp:8081']);
  return 'packager-status:running';
});

check('Maestro is installed', () => {
  if (!fs.existsSync(MAESTRO)) throw new Error(`not found at ${MAESTRO} — see docs/TESTING.md.`);
  return MAESTRO;
});

if (problems.length > 0) {
  console.error('');
  console.error('e2e: preconditions not met, so the flows were NOT run:');
  for (const p of problems) console.error(`e2e:   ${p}`);
  console.error('');
  console.error('e2e: this is NOT a test failure — nothing was tested.');
  process.exit(2);
}

console.log('\ne2e: all preconditions met — running flows\n');

const result = spawnSync(
  MAESTRO,
  ['--device', selectedSerial, 'test', '--env', `TEST_EMAIL=${email}`, '--env', `TEST_PASSWORD=${password}`, flowTarget],
  {
    cwd: MOBILE_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    },
    // 🔴 `shell: true` is REQUIRED on Windows. Maestro ships `maestro.bat`, and
    // Node refuses to spawn a .bat directly since the CVE-2024-27980 fix — it
    // fails with EINVAL and `status: null`, which reads as "the tool ran and
    // returned nothing" rather than "the tool never started".
    shell: process.platform === 'win32',
  }
);

process.exit(result.status ?? 1);

function readEnvLocal(key) {
  const file = path.join(MOBILE_ROOT, '.env.local');
  if (!fs.existsSync(file)) return null;
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.split('=').slice(1).join('=').trim() : null;
}
