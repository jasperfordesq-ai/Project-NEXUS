// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { isOnPanelPath } from './panelPath';

/** Shared host: tenantPath() adds the community slug. */
const withSlug = (p: string) => `/hour-timebank${p}`;
/** A community's own domain: no slug anywhere. */
const noSlug = (p: string) => p;

describe('isOnPanelPath', () => {
  it('matches the slug-stripped pathname the router reports on a shared host', () => {
    expect(isOnPanelPath('/partner-timebanks/webhooks', '/partner-timebanks/webhooks', withSlug)).toBe(true);
  });

  it('matches the full pathname with the slug too', () => {
    expect(isOnPanelPath('/hour-timebank/partner-timebanks/webhooks', '/partner-timebanks/webhooks', withSlug)).toBe(true);
  });

  it('matches on a community\'s own domain', () => {
    expect(isOnPanelPath('/partner-timebanks/webhooks', '/partner-timebanks/webhooks', noSlug)).toBe(true);
  });

  it('matches a sub-page, and tolerates a trailing slash', () => {
    expect(isOnPanelPath('/partner-timebanks/api-keys/create', '/partner-timebanks/api-keys', withSlug)).toBe(true);
    expect(isOnPanelPath('/partner-timebanks/api-keys/', '/partner-timebanks/api-keys', withSlug)).toBe(true);
  });

  it('does not match a sibling that merely starts with the same characters', () => {
    expect(isOnPanelPath('/partner-timebanks/api-keys-old', '/partner-timebanks/api-keys', withSlug)).toBe(false);
    expect(isOnPanelPath('/partner-timebanks/data', '/partner-timebanks/directory', withSlug)).toBe(false);
  });

  it('exact: the panel home does not match its sub-pages', () => {
    expect(isOnPanelPath('/partner-timebanks', '/partner-timebanks', withSlug, { exact: true })).toBe(true);
    expect(isOnPanelPath('/hour-timebank/partner-timebanks/', '/partner-timebanks', withSlug, { exact: true })).toBe(true);
    expect(isOnPanelPath('/partner-timebanks/partnerships', '/partner-timebanks', withSlug, { exact: true })).toBe(false);
  });
});
