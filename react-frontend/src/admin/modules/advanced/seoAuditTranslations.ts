// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { SeoAuditCheckCode, SeoAuditIssueCode } from '../../api/types';

const CHECK_TRANSLATION_KEYS = {
  tenant_metadata: {
    name: 'seo_audit_check_tenant_metadata_name',
    description: 'seo_audit_check_tenant_metadata_description',
  },
  seo_settings: {
    name: 'seo_audit_check_seo_settings_name',
    description: 'seo_audit_check_seo_settings_description',
  },
  blog_meta: {
    name: 'seo_audit_check_blog_meta_name',
    description: 'seo_audit_check_blog_meta_description',
  },
  page_meta: {
    name: 'seo_audit_check_page_meta_name',
    description: 'seo_audit_check_page_meta_description',
  },
  kb_meta: {
    name: 'seo_audit_check_kb_meta_name',
    description: 'seo_audit_check_kb_meta_description',
  },
  redirect_health: {
    name: 'seo_audit_check_redirect_health_name',
    description: 'seo_audit_check_redirect_health_description',
  },
  duplicate_titles: {
    name: 'seo_audit_check_duplicate_titles_name',
    description: 'seo_audit_check_duplicate_titles_description',
  },
  sitemap_coverage: {
    name: 'seo_audit_check_sitemap_coverage_name',
    description: 'seo_audit_check_sitemap_coverage_description',
  },
  canonical_urls: {
    name: 'seo_audit_check_canonical_urls_name',
    description: 'seo_audit_check_canonical_urls_description',
  },
  open_graph: {
    name: 'seo_audit_check_open_graph_name',
    description: 'seo_audit_check_open_graph_description',
  },
  content_quality: {
    name: 'seo_audit_check_content_quality_name',
    description: 'seo_audit_check_content_quality_description',
  },
  unknown: {
    name: 'seo_audit_check_unknown_name',
    description: 'seo_audit_check_unknown_description',
  },
} satisfies Record<SeoAuditCheckCode, { name: string; description: string }>;

const ISSUE_TRANSLATION_KEYS = {
  missing_homepage_meta_title: 'seo_audit_issue_missing_homepage_meta_title',
  homepage_meta_title_too_long: 'seo_audit_issue_homepage_meta_title_too_long',
  missing_meta_description: 'seo_audit_issue_missing_meta_description',
  meta_description_too_long: 'seo_audit_issue_meta_description_too_long',
  meta_description_too_short: 'seo_audit_issue_meta_description_too_short',
  missing_homepage_h1: 'seo_audit_issue_missing_homepage_h1',
  search_engines_blocked: 'seo_audit_issue_search_engines_blocked',
  canonical_urls_not_enabled: 'seo_audit_issue_canonical_urls_not_enabled',
  open_graph_not_enabled: 'seo_audit_issue_open_graph_not_enabled',
  twitter_cards_not_enabled: 'seo_audit_issue_twitter_cards_not_enabled',
  title_suffix_missing: 'seo_audit_issue_title_suffix_missing',
  blog_post_meta_missing: 'seo_audit_issue_blog_post_meta_missing',
  additional_results_truncated: 'seo_audit_issue_additional_results_truncated',
  cms_page_meta_title_missing: 'seo_audit_issue_cms_page_meta_title_missing',
  kb_article_titles_missing: 'seo_audit_issue_kb_article_titles_missing',
  redirect_chain: 'seo_audit_issue_redirect_chain',
  redirect_loop: 'seo_audit_issue_redirect_loop',
  self_redirect: 'seo_audit_issue_self_redirect',
  duplicate_meta_title: 'seo_audit_issue_duplicate_meta_title',
  sitemap_empty: 'seo_audit_issue_sitemap_empty',
  sitemap_low_coverage: 'seo_audit_issue_sitemap_low_coverage',
  sitemap_static_pages_missing: 'seo_audit_issue_sitemap_static_pages_missing',
  sitemap_profiles_missing: 'seo_audit_issue_sitemap_profiles_missing',
  canonical_generation_disabled: 'seo_audit_issue_canonical_generation_disabled',
  custom_canonical_urls_high: 'seo_audit_issue_custom_canonical_urls_high',
  open_graph_sharing_disabled: 'seo_audit_issue_open_graph_sharing_disabled',
  twitter_cards_disabled: 'seo_audit_issue_twitter_cards_disabled',
  open_graph_default_image_missing: 'seo_audit_issue_open_graph_default_image_missing',
  thin_blog_content: 'seo_audit_issue_thin_blog_content',
  untitled_published_pages: 'seo_audit_issue_untitled_published_pages',
  legacy_result_requires_rerun: 'seo_audit_issue_legacy_result_requires_rerun',
  unknown: 'seo_audit_issue_unknown',
} satisfies Record<SeoAuditIssueCode, string>;

function hasOwnKey<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function getSeoAuditCheckNameKey(code: string): string {
  return hasOwnKey(CHECK_TRANSLATION_KEYS, code)
    ? CHECK_TRANSLATION_KEYS[code].name
    : CHECK_TRANSLATION_KEYS.unknown.name;
}

export function getSeoAuditCheckDescriptionKey(code: string): string {
  return hasOwnKey(CHECK_TRANSLATION_KEYS, code)
    ? CHECK_TRANSLATION_KEYS[code].description
    : CHECK_TRANSLATION_KEYS.unknown.description;
}

export function getSeoAuditIssueKey(code: string): string {
  return hasOwnKey(ISSUE_TRANSLATION_KEYS, code)
    ? ISSUE_TRANSLATION_KEYS[code]
    : ISSUE_TRANSLATION_KEYS.unknown;
}
