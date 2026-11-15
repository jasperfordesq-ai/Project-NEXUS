// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it } from 'vitest';
import { applyCommunityHead, safeCommunityIconUrl } from './communityHead';

// The head index.html ships, trimmed to the tags this module touches.
const SHELL_HEAD = [
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
  '<meta name="theme-color" content="#fafaf9">',
  '<meta name="apple-mobile-web-app-title" content="NEXUS">',
  '<link rel="apple-touch-icon" href="/icons/icon-192.png">',
].join('');

function makeDoc(): Document {
  const doc = document.implementation.createHTMLDocument('t');
  doc.head.innerHTML = SHELL_HEAD;
  return doc;
}

const ORIGIN = 'https://app.example.test';

describe('safeCommunityIconUrl', () => {
  it('keeps an uploaded image path', () => {
    expect(safeCommunityIconUrl('/uploads/tenants/7/favicon.png', ORIGIN)).toBe('/uploads/tenants/7/favicon.png');
  });

  it('turns an absolute address of an uploaded file into the same-site path', () => {
    expect(safeCommunityIconUrl('https://hour-timebank.example/uploads/t/2/fav.ico', ORIGIN)).toBe('/uploads/t/2/fav.ico');
    expect(safeCommunityIconUrl('http://127.0.0.1:8090/uploads/t/2/fav.webp', ORIGIN)).toBe('/uploads/t/2/fav.webp');
  });

  it('accepts an https image elsewhere', () => {
    expect(safeCommunityIconUrl('https://cdn.example.org/brand/icon.png', ORIGIN)).toBe('https://cdn.example.org/brand/icon.png');
  });

  it.each([
    [null],
    [undefined],
    [''],
    [42],
    ['javascript:alert(1)'],
    ['data:image/png;base64,AAAA'],
    ['http://evil.example/icon.png'],
    ['https://cdn.example.org/brand/icon.svg'],
    ['https://cdn.example.org/brand/page.html'],
    ['/uploads/../etc/passwd.png'],
    ['/uploads/a b.png'],
    ['/elsewhere/icon.png'],
    ['//evil.example/uploads/icon.png'],
    ['https://user:pw@cdn.example.org/icon.png'],
  ])('refuses %s', (raw) => {
    expect(safeCommunityIconUrl(raw, ORIGIN)).toBeNull();
  });
});

describe('applyCommunityHead', () => {
  let doc: Document;

  beforeEach(() => {
    doc = makeDoc();
  });

  const attr = (selector: string, name: string) => doc.querySelector(selector)?.getAttribute(name) ?? null;

  it('names the home-screen app after the community', () => {
    applyCommunityHead({ name: 'Riverside Timebank', favicon: null }, doc);

    expect(attr('meta[name="apple-mobile-web-app-title"]', 'content')).toBe('Riverside Timebank');
    expect(attr('meta[name="application-name"]', 'content')).toBe('Riverside Timebank');
  });

  it('uses the stored favicon and drops the SVG type', () => {
    applyCommunityHead({ name: 'Riverside', favicon: '/uploads/t/106/fav.png' }, doc);

    expect(attr('link[rel="icon"]', 'href')).toBe('/uploads/t/106/fav.png');
    expect(doc.querySelector('link[rel="icon"]')?.hasAttribute('type')).toBe(false);
  });

  it('keeps today\'s icon when the community has no favicon, or an unsafe one', () => {
    applyCommunityHead({ name: 'Riverside', favicon: null }, doc);
    expect(attr('link[rel="icon"]', 'href')).toBe('/favicon.svg');
    expect(attr('link[rel="icon"]', 'type')).toBe('image/svg+xml');

    applyCommunityHead({ name: 'Riverside', favicon: 'javascript:alert(1)' }, doc);
    expect(attr('link[rel="icon"]', 'href')).toBe('/favicon.svg');
  });

  it('never touches the theme colour (ThemeContext owns it)', () => {
    applyCommunityHead({ name: 'Riverside', favicon: '/uploads/f.png' }, doc);
    expect(attr('meta[name="theme-color"]', 'content')).toBe('#fafaf9');
  });

  it('uses the app icon for the iPhone home-screen icon only when one is set', () => {
    applyCommunityHead({ name: 'Riverside', favicon: null }, doc);
    expect(attr('link[rel="apple-touch-icon"]', 'href')).toBe('/icons/icon-192.png');

    applyCommunityHead({ name: 'Riverside', favicon: null, appIcon: '/uploads/t/106/app-icon.png' }, doc);
    expect(attr('link[rel="apple-touch-icon"]', 'href')).toBe('/uploads/t/106/app-icon.png');

    applyCommunityHead({ name: 'Riverside', favicon: null, appIcon: 'https://cdn.example.org/x.png' }, doc);
    expect(attr('link[rel="apple-touch-icon"]', 'href')).toBe('/icons/icon-192.png');
  });

  it('restores every default when the page leaves the community', () => {
    applyCommunityHead({ name: 'Riverside', favicon: '/uploads/f.png', appIcon: '/uploads/a.png' }, doc);
    applyCommunityHead(null, doc);

    expect(attr('meta[name="apple-mobile-web-app-title"]', 'content')).toBe('NEXUS');
    expect(doc.querySelector('meta[name="application-name"]')).toBeNull();
    expect(attr('link[rel="icon"]', 'href')).toBe('/favicon.svg');
    expect(attr('link[rel="icon"]', 'type')).toBe('image/svg+xml');
    expect(attr('link[rel="apple-touch-icon"]', 'href')).toBe('/icons/icon-192.png');
  });

  it('switching straight from one community to another leaves nothing behind', () => {
    applyCommunityHead({ name: 'Riverside', favicon: '/uploads/f.png' }, doc);
    applyCommunityHead({ name: 'Hilltop', favicon: null }, doc);

    expect(attr('meta[name="apple-mobile-web-app-title"]', 'content')).toBe('Hilltop');
    expect(attr('link[rel="icon"]', 'href')).toBe('/favicon.svg');
  });

  it('a blank name keeps today\'s title', () => {
    applyCommunityHead({ name: '   ', favicon: null }, doc);
    expect(attr('meta[name="apple-mobile-web-app-title"]', 'content')).toBe('NEXUS');
    expect(doc.querySelector('meta[name="application-name"]')).toBeNull();
  });
});
