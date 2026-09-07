// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Owner's report, 2026-09-06: the web header "+" should offer at least what
 * the native app's Create screen offers. It offered four things; the app offered
 * fourteen, because the two lists were written and edited independently.
 *
 * These tests pin the parity contract and the two things that made the old list
 * quietly wrong: an href that is not a builder, and a gate that is looser than
 * the gate on the route it links to.
 */

import { describe, expect, it } from 'vitest';
import {
  CREATE_SECTION_LABEL_KEYS,
  getVisibleCreateOptions,
  groupCreateOptions,
} from './createOptions';
import type { TenantFeatures, TenantModules } from '@/types/api';

const all = () => true;
const none = () => false;

/**
 * Every option `mobile/app/(modals)/quick-create.tsx` lists, by what it creates.
 * Group exchanges and Care in Community are deliberately absent from the native
 * screen (a group exchange needs a group; Care is outside native store scope) —
 * the web menu may be a superset, never a subset.
 */
const NATIVE_QUICK_CREATE = [
  'quick_create.new_post',
  'quick_create.new_listing',
  'quick_create.new_marketplace_listing',
  'quick_create.new_message',
  'quick_create.new_event',
  'quick_create.new_poll',
  'quick_create.new_challenge',
  'quick_create.new_group',
  'quick_create.new_goal',
  'quick_create.new_job',
  'quick_create.new_volunteering',
  'quick_create.new_organisation',
  'quick_create.new_course',
  'quick_create.new_podcast',
];

describe('createOptions', () => {
  it('offers everything the native Create screen offers', () => {
    const labels = getVisibleCreateOptions(all, all).map((option) => option.labelKey);

    for (const nativeLabel of NATIVE_QUICK_CREATE) {
      expect(labels, `${nativeLabel} is on the native Create screen but not on the web one`)
        .toContain(nativeLabel);
    }
  });

  it('sends every option somewhere that can actually start something', () => {
    // A bare index page is the failure this menu exists to prevent: the member
    // lands on other people's content with no visible way to begin. Two options
    // are allowed exceptions, and both are checked exceptions rather than
    // oversights: `/goals` puts a "New Goal" button at the top of the page, and
    // "Offer Time" is explicitly a link to the care hub (its own description
    // says so), not a builder. The native app routes both the same way.
    const checkedExceptions = new Set(['/goals', '/caring-community']);

    for (const option of getVisibleCreateOptions(all, all)) {
      if (checkedExceptions.has(option.href)) continue;

      const pathOnly = option.href.split('?')[0] ?? option.href;
      const isBuilderRoute = /\/(create|new|register|sell|studio)(\/|$)/.test(pathOnly);
      const carriesACreateFlag = /[?&](create|compose)=/.test(option.href);

      expect(
        isBuilderRoute || carriesACreateFlag,
        `${option.labelKey} points at ${option.href}, which neither is a builder nor opens one`,
      ).toBe(true);
    }
  });

  it('gates New Message on BOTH the messages module and direct_messaging', () => {
    // The route is module-gated, but the page's "New message" button is disabled
    // when the feature is off — so the module gate alone offers a dead end.
    const moduleOnly = getVisibleCreateOptions(none, all);
    expect(moduleOnly.map((o) => o.labelKey)).not.toContain('quick_create.new_message');

    const bothOn = getVisibleCreateOptions(all, all);
    expect(bothOn.map((o) => o.labelKey)).toContain('quick_create.new_message');
  });

  it('gates Register an Organisation on volunteering, which is what the route checks', () => {
    // 🔴 There is an `organisations` feature flag and it is NOT what guards
    // `organisations/register`. Gating on it would offer a link to a
    // "coming soon" page.
    const org = getVisibleCreateOptions(all, all)
      .find((option) => option.labelKey === 'quick_create.new_organisation');

    expect(org?.feature).toBe('volunteering');
  });

  it('hides Event when the server says this member may not create one', () => {
    const withPermission = getVisibleCreateOptions(all, all, true).map((o) => o.labelKey);
    const withoutPermission = getVisibleCreateOptions(all, all, false).map((o) => o.labelKey);

    expect(withPermission).toContain('quick_create.new_event');
    expect(withoutPermission).not.toContain('quick_create.new_event');
    // Only Event is affected — the permission is specific to event creation.
    expect(withoutPermission).toHaveLength(withPermission.length - 1);
  });

  it('every option carries a section that has a heading', () => {
    for (const option of getVisibleCreateOptions(all, all)) {
      expect(CREATE_SECTION_LABEL_KEYS[option.section]).toBeTruthy();
    }
  });

  it('places Marketplace in Community independently of Timebanking', () => {
    const groups = groupCreateOptions(getVisibleCreateOptions(all, none));
    expect(groups.find(g => g.section === 'community')?.options.map(o => o.href)).toContain('/marketplace/sell');
    expect(groups.find(g => g.section === 'timebank')?.options.map(o => o.href) ?? []).not.toContain('/marketplace/sell');
    expect(getVisibleCreateOptions(f => f !== 'marketplace', all).map(o => o.href)).not.toContain('/marketplace/sell');
  });

  it('drops sections with nothing left in them', () => {
    // Courses and Podcasts are the whole "learning" section. With them off, the
    // heading must not render above an empty gap.
    const featureGate = (feature: keyof TenantFeatures) => feature !== 'courses' && feature !== 'podcasts';
    const groups = groupCreateOptions(getVisibleCreateOptions(featureGate, all));

    expect(groups.map((group) => group.section)).not.toContain('learning');
    expect(groups.every((group) => group.options.length > 0)).toBe(true);
  });

  it('returns nothing at all when a community has switched everything off', () => {
    const moduleGate = (_module: keyof TenantModules) => false;

    expect(getVisibleCreateOptions(none, moduleGate)).toHaveLength(0);
    expect(groupCreateOptions(getVisibleCreateOptions(none, moduleGate))).toHaveLength(0);
  });
});
