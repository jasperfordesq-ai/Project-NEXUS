// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18next from 'i18next';

const locales = ['en', 'de', 'es', 'fr', 'ga', 'it', 'pt'];
it.each(locales)('%s renders check-in refusal messages from the screen namespace', async locale => {
  const resource = require(`./${locale}/eventOfflineCheckin.json`);
  const events = require(`./${locale}/events.json`);
  const i18n = i18next.createInstance();
  await i18n.init({ lng: locale, fallbackLng: false, defaultNS: 'eventOfflineCheckin',
    resources: { [locale]: { eventOfflineCheckin: resource, events } }, interpolation: { escapeValue: false } });
  for (const key of ['queue.readOnlyRevoked', 'scan.alreadyQueued', 'scan.expired', 'scan.wrongEvent', 'scan.revoked', 'scan.signingKeyUnknown', 'scan.queueFull', 'scan.historyRequired', 'scan.reconciliationRequired',
    // E-105 plain-English guidance (2026-10-13): the four offline steps, the attendee's three steps, and the inline hints.
    'workspace.steps.setup', 'workspace.steps.download', 'workspace.steps.record', 'workspace.steps.sync', 'workspace.stepsLabel',
    'device.description', 'device.labelHelper', 'device.registerHint', 'device.reasonWhy', 'scan.operationHint', 'scan.queueHint', 'queue.syncHint', 'conflicts.howTo',
    'credential.steps.create', 'credential.steps.save', 'credential.steps.show', 'credential.stepsLabel', 'credential.optional', 'credential.manage_hint']) {
    expect(i18n.exists(key)).toBe(true);
    expect(i18n.t(key)).not.toBe(key);
  }
  expect(i18n.t('errors.revoked')).toBe(i18n.t('queue.readOnlyRevoked'));
  // Dates are interpolated into the expiry hints; a locale that drops the placeholder would hide the date.
  expect(i18n.t('device.worksUntil', { date: 'D1' })).toContain('D1');
  expect(i18n.t('queue.listValidUntil', { date: 'D2' })).toContain('D2');
  // The false "never changes balances" wording is gone: the reward sentence must not say never.
  expect(i18n.t('workspace.noWallet')).not.toMatch(/never/i);
  expect(i18n.t('device.revoked')).not.toBe(i18n.t('errors.revoked'));
  for (const state of ['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']) {
    const label = i18n.t(`events:attendance.states.${state}`);
    expect(label).not.toContain(state);
    expect(i18n.t('conflicts.current', { state: label, version: 3 })).toContain(label);
  }
});
