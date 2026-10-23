// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { accessibleFrontendPathFor, buildAccessibleFrontendUrl } from './accessible-frontend';

describe('buildAccessibleFrontendUrl', () => {
  it('builds the public tenant accessible home URL', () => {
    expect(buildAccessibleFrontendUrl('hour-timebank')).toBe(
      'https://accessible.project-nexus.ie/hour-timebank/accessible',
    );
  });

  it('trims a configured base URL before adding the tenant path', () => {
    expect(buildAccessibleFrontendUrl('hour-timebank', '/', 'https://example.test/')).toBe(
      'https://example.test/hour-timebank/accessible',
    );
  });

  it('appends accessible frontend subpaths under the tenant accessible namespace', () => {
    expect(buildAccessibleFrontendUrl('hour-timebank', '/listings', 'https://example.test')).toBe(
      'https://example.test/hour-timebank/accessible/listings',
    );
  });

  it('returns null when no tenant slug is available', () => {
    expect(buildAccessibleFrontendUrl(null)).toBeNull();
    expect(buildAccessibleFrontendUrl('   ')).toBeNull();
  });

  it('uses the bare custom domain as the entry link (host resolves the tenant server-side)', () => {
    expect(
      buildAccessibleFrontendUrl('hour-timebank', '/', undefined, 'accessible.example.org'),
    ).toBe('https://accessible.example.org');
  });

  it('appends subpaths on the accessible custom domain as bare slug-less paths', () => {
    expect(
      buildAccessibleFrontendUrl('hour-timebank', '/listings', undefined, 'accessible.example.org'),
    ).toBe('https://accessible.example.org/listings');
  });

  it('strips scheme and trailing slash from a configured accessible domain', () => {
    expect(
      buildAccessibleFrontendUrl('hour-timebank', '/', undefined, 'https://accessible.example.org/'),
    ).toBe('https://accessible.example.org');
  });

  it('returns the bare accessible custom domain even without a slug', () => {
    expect(buildAccessibleFrontendUrl(null, '/', undefined, 'accessible.example.org')).toBe(
      'https://accessible.example.org',
    );
  });
});

describe('accessibleFrontendPathFor', () => {
  it.each([
    ['/', '/'],
    ['/about', '/about'],
    ['/faq', '/faq'],
    ['/contact', '/contact'],
    ['/help', '/help'],
    ['/trust-and-safety', '/trust-and-safety'],
    ['/accessibility', '/accessibility'],
    ['/terms', '/terms'],
    ['/privacy', '/privacy'],
    ['/cookies', '/cookies'],
    ['/legal', '/legal'],
    ['/community-guidelines', '/legal/community-guidelines'],
    ['/acceptable-use', '/legal/acceptable-use'],
    ['/blog', '/blog'],
    ['/blog/spring-fair_2026', '/blog/spring-fair_2026'],
    ['/page/our-story', '/page/our-story'],
    ['/whats-on', '/whats-on'],
    ['/whats-on/42', '/whats-on/42'],
    ['/timebanking-guide', '/guide'],
  ])('maps %s to %s', (from, to) => {
    expect(accessibleFrontendPathFor(from)).toBe(to);
  });

  it.each([
    '/dashboard',
    '/listings/12',
    '/messages',
    '/help/members',
    '/whats-on/not-a-number',
    '/blog/a/b',
    '/events/12',
    '/admin',
  ])('sends %s, which the accessible site lacks at that address, to its home page', (from) => {
    expect(accessibleFrontendPathFor(from)).toBe('/');
  });

  it('strips the community prefix, query and trailing slash first', () => {
    expect(accessibleFrontendPathFor('/hour-timebank/blog/spring-fair/?utm=x', '/hour-timebank')).toBe('/blog/spring-fair');
    expect(accessibleFrontendPathFor('/hour-timebank', '/hour-timebank/')).toBe('/');
    expect(accessibleFrontendPathFor('/Hour-Timebank/about', '/hour-timebank')).toBe('/about');
  });

  it('does not strip a prefix that only starts with the same letters', () => {
    expect(accessibleFrontendPathFor('/hour-timebankers/about', '/hour-timebank')).toBe('/');
  });

  it('builds a full link with the slug or the custom domain', () => {
    const path = accessibleFrontendPathFor('/hour-timebank/whats-on/7', '/hour-timebank');
    expect(buildAccessibleFrontendUrl('hour-timebank', path, 'https://example.test')).toBe(
      'https://example.test/hour-timebank/accessible/whats-on/7',
    );
    expect(buildAccessibleFrontendUrl('x', path, undefined, 'accessible.example.org')).toBe(
      'https://accessible.example.org/whats-on/7',
    );
  });
});
