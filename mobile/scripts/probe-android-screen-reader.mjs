// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Report whether an attached Android device can provide honest TalkBack evidence.
 * UIAutomator can inspect labels but cannot prove spoken order or speech output.
 * This probe changes no accessibility settings.
 */

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const serialIndex = args.indexOf('--serial');
const serial = serialIndex >= 0 ? args[serialIndex + 1] : process.env.ANDROID_SERIAL;
const adb = process.env.ADB_PATH ?? 'adb';
const scoped = serial ? ['-s', serial] : [];

function shell(...command) {
  return execFileSync(adb, [...scoped, 'shell', ...command], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  }).trim();
}

try {
  const accessibilityEnabled = shell('settings', 'get', 'secure', 'accessibility_enabled') === '1';
  const enabledServices = shell('settings', 'get', 'secure', 'enabled_accessibility_services');
  const serviceDump = shell('dumpsys', 'accessibility');
  const talkBackInstalled = /talkback|screenreader/i.test(serviceDump);
  const talkBackEnabled = accessibilityEnabled && /talkback|screenreader/i.test(enabledServices);

  console.log(`screen-reader: accessibility enabled: ${accessibilityEnabled ? 'yes' : 'no'}`);
  console.log(`screen-reader: TalkBack service installed: ${talkBackInstalled ? 'yes' : 'no'}`);
  console.log(`screen-reader: TalkBack service enabled: ${talkBackEnabled ? 'yes' : 'no'}`);

  if (!talkBackInstalled) {
    console.error('screen-reader: BLOCKED — this emulator image has no TalkBack service.');
    console.error('screen-reader: label and touch-target audits remain useful, but they are not spoken-output proof.');
    process.exit(2);
  }
  if (!talkBackEnabled) {
    console.error('screen-reader: READY BUT DISABLED — enable TalkBack manually, then rerun the spoken journey.');
    process.exit(1);
  }

  console.log('screen-reader: READY — TalkBack is present and enabled; a human must still hear and verify spoken order.');
} catch (error) {
  console.error(`screen-reader: could not inspect the device: ${error.message}`);
  process.exit(2);
}
