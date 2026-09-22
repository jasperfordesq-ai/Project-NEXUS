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
  for (const key of ['queue.readOnlyRevoked', 'scan.alreadyQueued', 'scan.expired', 'scan.wrongEvent', 'scan.revoked', 'scan.signingKeyUnknown', 'scan.queueFull']) {
    expect(i18n.exists(key)).toBe(true);
    expect(i18n.t(key)).not.toBe(key);
  }
  expect(i18n.t('errors.revoked')).toBe(i18n.t('queue.readOnlyRevoked'));
  expect(i18n.t('device.revoked')).not.toBe(i18n.t('errors.revoked'));
  for (const state of ['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']) {
    const label = i18n.t(`events:attendance.states.${state}`);
    expect(label).not.toContain(state);
    expect(i18n.t('conflicts.current', { state: label, version: 3 })).toContain(label);
  }
});
