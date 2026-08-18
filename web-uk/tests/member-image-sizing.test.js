// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Two faults reported together on 2026-08-18, once member images started loading at all:
 *
 *  1. **No avatar on the member profile page**, while the members directory showed one.
 *     `partials/avatar.njk` contained NO `<img>` at all — it only ever rendered initials —
 *     and the profile page was the only member-facing page using it. The directory writes
 *     its own `<img>` inline, which is why one worked and the other did not.
 *
 *  2. **No mechanism for displaying images at a sensible size.** Every member upload was
 *     served at full size whatever box it was drawn in (a real avatar measured 160,561
 *     bytes into a 64px circle), and five image classes used by the templates —
 *     `nexus-alpha-feed-image`, `nexus-alpha-feed-media`, `nexus-alpha-card-image`,
 *     `nexus-alpha-org-logo`, `nexus-alpha-avatar--xl` — had no CSS definition at all,
 *     so those images had no display size and pushed the page sideways.
 *
 * The mechanism copies the React frontend, which routes local uploads through
 * `GET /api/v2/media/thumbnail` at the size they are displayed: `resolveBackendThumbnailUrl`
 * plus the `thumb` template filter.
 */

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { resolveBackendThumbnailUrl } = require('../src/lib/accessible-shell');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { getApiBaseUrl } = require('../src/lib/backend-contract');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildEnvironment() {
  const env = nunjucks.configure([viewsDirectory, govukViewsDirectory], { autoescape: true, noCache: true });
  registerTemplateFilters(env);
  env.addFilter('string', String);
  return env;
}

const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'scss', 'main.scss'), 'utf8');

describe('member image sizing', () => {
  describe('resolveBackendThumbnailUrl', () => {
    it('asks the API for a local upload at the requested size', () => {
      const url = resolveBackendThumbnailUrl('/uploads/avatars/ada.png', { width: 96, height: 96 });

      expect(url).toBe(`${getApiBaseUrl()}/api/v2/media/thumbnail?src=%2Fuploads%2Favatars%2Fada.png&w=96&h=96&fit=cover`);
    });

    it('accepts a URL already resolved to the API origin', () => {
      const url = resolveBackendThumbnailUrl(`${getApiBaseUrl()}/uploads/avatars/ada.png`, { width: 64 });

      expect(url).toBe(`${getApiBaseUrl()}/api/v2/media/thumbnail?src=%2Fuploads%2Favatars%2Fada.png&w=64&h=64&fit=cover`);
    });

    it('squares the box when only a width is given', () => {
      expect(resolveBackendThumbnailUrl('/uploads/a.png', { width: 48 })).toContain('w=48&h=48');
    });

    it('serves /storage paths too, because the thumbnail endpoint does', () => {
      expect(resolveBackendThumbnailUrl('/storage/images/g.webp', { width: 96 }))
        .toContain('src=%2Fstorage%2Fimages%2Fg.webp');
    });

    it('passes fit=contain through for images that must not be cropped', () => {
      expect(resolveBackendThumbnailUrl('/uploads/logo.png', { width: 96, fit: 'contain' })).toContain('fit=contain');
    });

    // 🔴 The rules below are the reason this is not a one-line helper. Each one, if
    // dropped, replaces a working image with a broken one.
    it("leaves a federation partner's own URL alone", () => {
      const partner = 'https://partner.example.org/avatars/ada.png';

      expect(resolveBackendThumbnailUrl(partner, { width: 96 })).toBe(partner);
    });

    it('leaves a path the thumbnail endpoint cannot serve alone', () => {
      // MediaThumbnailService::resolveSourcePath() serves /uploads and /storage only;
      // the platform default avatar lives elsewhere and would 404.
      expect(resolveBackendThumbnailUrl('/assets/img/defaults/default_avatar.png', { width: 96 }))
        .toBe(`${getApiBaseUrl()}/assets/img/defaults/default_avatar.png`);
    });

    it('returns the resolved original when no size is asked for', () => {
      expect(resolveBackendThumbnailUrl('/uploads/a.png', {})).toBe(`${getApiBaseUrl()}/uploads/a.png`);
    });

    it('returns an empty string for no image, so a caller can fall back to initials', () => {
      expect(resolveBackendThumbnailUrl('', { width: 96 })).toBe('');
      expect(resolveBackendThumbnailUrl(null, { width: 96 })).toBe('');
      expect(resolveBackendThumbnailUrl(undefined, { width: 96 })).toBe('');
    });
  });

  describe('the thumb filter', () => {
    // Registered in template-filters.js on purpose: a filter registered only in
    // server.js breaks every hand-built test environment that renders the template.
    it('is available to any environment built from registerTemplateFilters', () => {
      const env = buildEnvironment();

      expect(env.renderString('{{ p | thumb(96, 96) }}', { p: '/uploads/avatars/ada.png' }))
        .toContain('/api/v2/media/thumbnail?src=%2Fuploads%2Favatars%2Fada.png');
    });
  });

  describe('the shared avatar partial', () => {
    const user = { first_name: 'Ada', last_name: 'Byron' };

    it('renders the photo when the member has one', () => {
      const html = buildEnvironment().render('partials/avatar.njk', {
        user: { ...user, avatar_url: '/uploads/avatars/ada.png' }
      });

      expect(html).toContain('<img');
      expect(html).toContain('src="http');
      expect(html).toContain('/api/v2/media/thumbnail?src=%2Fuploads%2Favatars%2Fada.png');
    });

    it('asks for twice the displayed size so the photo stays sharp', () => {
      const html = buildEnvironment().render('partials/avatar.njk', {
        user: { ...user, avatar_url: '/uploads/avatars/ada.png' },
        size: 'large'
      });

      expect(html).toContain('w=128&amp;h=128');
      expect(html).toContain('width="64" height="64"');
    });

    it('reserves the space before the stylesheet arrives, so the page does not jump', () => {
      const html = buildEnvironment().render('partials/avatar.njk', {
        user: { ...user, avatar_url: '/uploads/avatars/ada.png' }
      });

      expect(html).toMatch(/width="40|48"/);
      expect(html).toContain('height=');
    });

    it('falls back to initials when the member has no photo', () => {
      const html = buildEnvironment().render('partials/avatar.njk', { user });

      expect(html).not.toContain('<img');
      expect(html).toContain('AB');
    });

    it('reads every avatar field name the API uses', () => {
      for (const field of ['avatarUrl', 'avatar_url', 'avatar', 'profile_image']) {
        const html = buildEnvironment().render('partials/avatar.njk', {
          user: { ...user, [field]: '/uploads/avatars/ada.png' }
        });

        expect(html).toContain('<img');
      }
    });

    it('leaves alt empty, because the member name is always beside it in text', () => {
      const html = buildEnvironment().render('partials/avatar.njk', {
        user: { ...user, avatar_url: '/uploads/avatars/ada.png' }
      });

      expect(html).toContain('alt=""');
    });
  });

  describe('the member profile page', () => {
    // The reported bug: this page showed no avatar while the directory did.
    it('renders the member photo', () => {
      const html = buildEnvironment().render('partials/avatar.njk', {
        user: { first_name: 'Ada', last_name: 'Byron', avatar: '/uploads/avatars/ada.png' },
        size: 'large'
      });

      expect(html).toContain('/api/v2/media/thumbnail?src=%2Fuploads%2Favatars%2Fada.png');
    });

    it('still uses the shared partial, so a fix here reaches every page using it', () => {
      const template = fs.readFileSync(path.join(viewsDirectory, 'members', 'profile.njk'), 'utf8');

      expect(template).toContain('partials/avatar.njk');
    });
  });

  describe('every image class the templates use has a display size', () => {
    // 🔴 These five were used in markup with NO definition anywhere in the stylesheet.
    // An <img> with no display size renders at its intrinsic size, which for a member
    // upload can be thousands of pixels wide — a WCAG 2.2 reflow failure (1.4.10),
    // not a cosmetic one.
    it.each([
      'nexus-alpha-feed-image',
      'nexus-alpha-feed-media',
      'nexus-alpha-card-image',
      'nexus-alpha-org-logo',
      'nexus-alpha-avatar--xl',
      'nexus-alpha-qr'
    ])('%s is defined', (className) => {
      expect(stylesheet).toContain(`.${className} {`);
    });

    it('gives the base avatar class a size and a crop rule', () => {
      const base = stylesheet.slice(stylesheet.indexOf('.nexus-alpha-avatar {'));
      const block = base.slice(0, base.indexOf('}'));

      expect(block).toContain('width: 48px');
      expect(block).toContain('height: 48px');
      // Without object-fit a round frame squashes any photo that is not square.
      expect(block).toContain('object-fit: cover');
    });
  });
});
