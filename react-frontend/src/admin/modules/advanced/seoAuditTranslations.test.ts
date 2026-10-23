// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import i18n from 'i18next';
import { getSeoAuditIssueKey } from './seoAuditTranslations';

const text = (code: string, params: Record<string, string> = {}) =>
  i18n.t(`advanced.${getSeoAuditIssueKey(code, params)}`, { ns: 'admin_advanced', ...params });

describe('seoAuditTranslations', () => {
  it('chooses the sitemap_not_published message by its reason', () => {
    expect(text('sitemap_not_published', { reason: 'noindex' })).toMatch(/hidden from search results/);
    expect(text('sitemap_not_published', { reason: 'switched_off' })).toMatch(/Automatic sitemap switch is off/);
    // A reason this panel does not know still gets a sensible message.
    expect(text('sitemap_not_published', { reason: 'something_new' })).toBe(
      'The sitemap answers “not found” (404), so search engines get no sitemap.',
    );
  });

  it('shows the new CMS page description issue, and keeps the old title issue for stored audits', () => {
    expect(text('cms_page_meta_description_missing', { title: 'About', path: '/about' })).toBe(
      'Page “About” (/about) has no meta description.',
    );
    expect(getSeoAuditIssueKey('cms_page_meta_title_missing')).toBe('seo_audit_issue_cms_page_meta_title_missing');
  });

  it('no longer claims shares get no image when no sharing image is set', () => {
    const message = text('open_graph_default_image_missing');
    expect(message).toMatch(/logo/);
    expect(message).not.toMatch(/will not include an image/);
  });

  it('renders a removed code (sitemap_profiles_missing) from an old stored audit as unsupported', () => {
    expect(getSeoAuditIssueKey('sitemap_profiles_missing')).toBe('seo_audit_issue_unknown');
    expect(text('sitemap_profiles_missing')).toBe('This audit issue is not supported by this version of the admin panel.');
  });
});
