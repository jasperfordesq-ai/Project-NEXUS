// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { getFormattingLocale } from './helpers';
import { resetRegion, setRegion } from './regionStore';

/**
 * A number inside a translated sentence (`{{count, number}}`) is formatted
 * with the same locale as every stand-alone number on screen:
 * getFormattingLocale(), the member's language plus the community's region.
 * Before, i18next used the bare language, so `en` grouped the American way
 * whatever the community's region.
 */
describe('numbers inside translated sentences follow the community region', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    resetRegion();
  });

  const say = (count: number, key: string, text: string): string => {
    i18n.addResource('en', 'regional_numbers_test', key, text);
    return i18n.t(`regional_numbers_test:${key}`, { count });
  };

  it('groups an English count the Indian way for a community in India', async () => {
    await i18n.changeLanguage('en');
    setRegion('IN');

    expect(getFormattingLocale()).toBe('en-IN');
    expect(say(123456, 'grouped', 'Seen {{count, number}} times')).toBe('Seen 1,23,456 times');
  });

  it('uses the region at the moment of formatting, not the one at start-up', async () => {
    await i18n.changeLanguage('en');
    setRegion('IN');
    expect(say(123456, 'late', '{{count, number}}')).toBe('1,23,456');

    setRegion('IE');
    expect(say(123456, 'late', '{{count, number}}')).toBe('123,456');
  });

  it('gives exactly what getFormattingLocale() gives a stand-alone number', async () => {
    await i18n.changeLanguage('de');
    setRegion('CH');

    expect(say(1234567.5, 'same', '{{count, number}}')).toBe(
      new Intl.NumberFormat(getFormattingLocale()).format(1234567.5),
    );
  });

  it('leaves a plain {{count}} and plural choice alone', async () => {
    await i18n.changeLanguage('en');
    setRegion('IN');
    i18n.addResource('en', 'regional_numbers_test', 'item_one', '{{count}} item');
    i18n.addResource('en', 'regional_numbers_test', 'item_other', '{{count}} items');

    expect(i18n.t('regional_numbers_test:item', { count: 1 })).toBe('1 item');
    expect(i18n.t('regional_numbers_test:item', { count: 123456 })).toBe('123456 items');
  });
});
