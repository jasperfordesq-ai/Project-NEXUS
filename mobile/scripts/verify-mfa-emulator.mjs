// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Run with the debug app's Metro bundle pointed at http://10.0.2.2:8091.
// Reads setup/recovery values in memory only; no screenshots of credentials.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../..');
const adb = (...args) => execFileSync(process.env.MFA_ADB || 'adb', ['-s', 'emulator-5554', ...args], { encoding: 'utf8' });
assert.match(adb('shell', 'dumpsys', 'package', 'ie.project.nexus'), /DEBUGGABLE/);
const fixture = JSON.parse(execFileSync(process.env.MFA_DOCKER || 'docker', ['exec', 'nexus-webuk-e2e-app', 'php', 'scripts/mfa-e2e-fixture.php'], { cwd: root, encoding: 'utf8' }));
const actor = fixture.actors.native;
function nodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/mfa-journey.xml');
  return [...adb('shell', 'cat', '/sdcard/mfa-journey.xml').matchAll(/<node\b[^>]*>/g)].map(m => m[0]);
}
function text(node) { return (node.match(/text="([^"]*)"/)?.[1] || '').replace(/&#10;/g, '\n').replace(/&amp;/g, '&'); }
async function find(predicate) {
  for (let i = 0; i < 30; i++) {
    const match = nodes().find(predicate);
    if (match) return match;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Expected native MFA control did not appear');
}
function tap(node) {
  const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((b[0] + b[2]) / 2)), String(Math.round((b[1] + b[3]) / 2)));
}
const id = name => node => node.includes(`resource-id="${name}"`);
const label = name => node => node.includes(`content-desc="${name}"`) || node.includes(`text="${name}"`);
async function input(name, value) { tap(await find(id(name))); adb('shell', 'input', 'text', value); }
const checks = [];
async function cleanLogin() {
  adb('shell', 'pm', 'clear', 'ie.project.nexus');
  adb('shell', 'am', 'start', '-n', 'ie.project.nexus/.MainActivity');
  tap(await find(id('tenant-option-e2e-community')));
  await input('email-input', actor.email);
  await input('password-input', actor.password);
  adb('shell', 'input', 'keyevent', '4');
  tap(await find(id('login-submit')));
}
try {
  await cleanLogin();
  const secret = text(await find(id('mfa-setup-secret'))).replace(/\s/g, '');
  assert.match(secret, /^[A-Z2-7]+$/);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  const code = String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
  await input('mfa-code', code);
  adb('shell', 'input', 'keyevent', '4');
  tap(await find(label('Verify')));
  await find(node => /saved.*recovery|saved.*codes/i.test(node));
  const recoveryNode = nodes().map(text).find(value => value.split('\n').length === 10);
  assert.ok(recoveryNode, 'Ten recovery codes must be visible');
  tap(await find(node => /content-desc="[^"]*saved.*(?:recovery|codes)/i.test(node)));
  await find(label('Community Feed'));
  checks.push({ check: 'Android UI password -> mandatory setup -> recovery acknowledgment -> real feed', passed: true });
  adb('shell', 'am', 'force-stop', 'ie.project.nexus');
  adb('shell', 'am', 'start', '-n', 'ie.project.nexus/.MainActivity');
  await find(label('Community Feed'));
  checks.push({ check: 'Process restart restores the completed MFA session', passed: true });
  await cleanLogin();
  await find(id('mfa-code'));
  tap(await find(node => /content-desc="[^"]*(?:backup|recovery) code/i.test(node)));
  await input('mfa-code', recoveryNode.split('\n')[0]);
  adb('shell', 'input', 'keyevent', '4');
  tap(await find(label('Verify')));
  await find(label('Community Feed'));
  checks.push({ check: 'Fresh Android app state completes password and recovery-code sign-in', passed: true });
  console.log('Android real-backend MFA enrollment reached Community Feed; credentials not logged.');
} catch (error) {
  checks.push({ passed: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const output = path.join(root, '.local-docs-archive/mfa-client-journeys');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'android-results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), accountId: actor.id, checks }, null, 2));
}
