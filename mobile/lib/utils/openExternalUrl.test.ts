// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 `Linking.openURL` appeared in twenty-two files and every site decided for itself what
 * to check. Six were bare `void Linking.openURL(x)` with no catch — and `openURL` REJECTS
 * when the device has nothing that can handle the URL, so those produced an unhandled
 * rejection and, to the member, a button that did nothing. One opened
 * `item.tracking_url ?? ''`. Two opened a member-typed `website` with no scheme check at
 * all. Audit 2026-09-09, item 9.
 *
 * The refusal tests are the security half: a `website` field is member-supplied content
 * echoed back by the API, and the OS will hand a custom scheme to whatever app claims it.
 */

import { Linking } from 'react-native';

import { isOpenableExternalUrl, openExternalUrl } from './openExternalUrl';

describe('isOpenableExternalUrl', () => {
  it.each([
    'https://example.org',
    'https://example.org/path?q=1',
    // Plain HTTP is allowed on purpose: a small community organisation's site may still be
    // HTTP, and refusing it leaves the member with a dead button and no explanation.
    'http://community.example',
  ])('accepts %s', (url) => {
    expect(isOpenableExternalUrl(url)).toBe(true);
  });

  it.each([
    ['an empty string, which one call site passed via `tracking_url ?? ""`', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['something that is not a URL at all', 'example.org'],
    ['a scheme that can execute', 'javascript:alert(1)'],
    ['an inline payload', 'data:text/html,<script>alert(1)</script>'],
    ['a local file', 'file:///etc/passwd'],
    ['an unrecognised custom scheme', 'someapp://do-something'],
    ['a scheme with nothing after it', 'https://'],
  ])('refuses %s', (_why, url) => {
    expect(isOpenableExternalUrl(url)).toBe(false);
  });

  it('treats a repaired hostless URL as the host the parser found', () => {
    /*
      Worth pinning because it surprised this test first. `https:///nowhere` looks hostless
      but WHATWG parsing normalises it to `https://nowhere/`, so it is a real destination
      and is accepted. The hostname check in the helper is not dead code — it catches the
      cases the parser cannot repair — but it is not what stops this one.
    */
    expect(isOpenableExternalUrl('https:///nowhere')).toBe(true);
  });

  it('accepts a scheme the caller explicitly opts into', () => {
    expect(isOpenableExternalUrl('mailto:hello@example.org')).toBe(false);
    expect(isOpenableExternalUrl('mailto:hello@example.org', { allowSchemes: ['mailto:'] })).toBe(true);
  });
});

describe('openExternalUrl', () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    openURL.mockRestore();
  });

  it('opens a web address', async () => {
    await expect(openExternalUrl('https://example.org')).resolves.toBe('opened');
    expect(openURL).toHaveBeenCalledWith('https://example.org');
  });

  it('trims before opening', async () => {
    await openExternalUrl('  https://example.org  ');
    expect(openURL).toHaveBeenCalledWith('https://example.org');
  });

  it('never reaches the OS with something it refused', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).resolves.toBe('invalid');
    await expect(openExternalUrl('')).resolves.toBe('invalid');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('reports, rather than throws, when nothing can open the link', async () => {
    // The original defect: this rejection was unhandled at six call sites.
    openURL.mockRejectedValue(new Error('no activity found to handle intent'));

    await expect(openExternalUrl('https://example.org')).resolves.toBe('unopenable');
  });
});
