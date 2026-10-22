import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Input, Button, Spinner, Chip, Switch } from '@/components/ui';
import { SharingImageField } from '@/admin/components/SharingImageField';
import { useState, useEffect, useCallback } from 'react';

import { Separator } from '@/components/ui';
import Save from 'lucide-react/icons/save';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ExternalLink from 'lucide-react/icons/external-link';
import FileText from 'lucide-react/icons/file-text';
import Globe from 'lucide-react/icons/globe';
import Image from 'lucide-react/icons/image';
import Search from 'lucide-react/icons/search';
import Share2 from 'lucide-react/icons/share-2';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import XCircle from 'lucide-react/icons/circle-x';
import BarChart3 from 'lucide-react/icons/chart-column';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { adminSettings, adminTools } from '../../api/adminApi';
import type { SeoAuditResult } from '../../api/types';
import {
  getSeoAuditCheckDescriptionKey,
  getSeoAuditCheckNameKey,
  getSeoAuditIssueKey,
} from './seoAuditTranslations';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SEO Overview — Admin dashboard for search engine optimization.
 *
 * Sections:
 * 1. Tenant Meta (stored on tenants table: title, description, H1, hero intro)
 * 2. OG Image (default social sharing image for all pages)
 * 3. Meta Tags (title suffix, global description, keywords)
 * 4. SEO Features (sitemap, canonical URLs, Open Graph, Twitter Cards toggles)
 * 5. Verification & Robots (Google/Bing verification, custom robots.txt)
 * 6. Sitemap Stats (live stats from SitemapService, cache clear button)
 * 7. SEO Health Check (quick audit of common issues)
 */

// Keys that map to the backend's seo_* tenant_settings rows
const SEO_KEYS = [
  'seo_title_suffix', 'seo_meta_description', 'seo_meta_keywords',
  'seo_og_image_url',
  'seo_auto_sitemap', 'seo_canonical_urls', 'seo_open_graph',
  'seo_twitter_cards', 'seo_google_verification', 'seo_bing_verification',
] as const;

// Keys stored directly on the tenants table
const TENANT_KEYS = [
  'tenant_meta_title', 'tenant_meta_description', 'tenant_h1_headline', 'tenant_hero_intro',
] as const;

interface SitemapStats {
  sitemap_url: string;
  total_urls: number;
  content_types: Record<string, number>;
}

interface SeoCheckResult {
  name: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
}

export function SeoOverview() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  const { t: tAdmin } = useTranslation('admin_advanced');
  useAdminPageMeta({ title: tNav('advanced') });
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sitemapStats, setSitemapStats] = useState<SitemapStats | null>(null);
  const [sitemapLoading, setSitemapLoading] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [serverAudit, setServerAudit] = useState<SeoAuditResult | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    seo_title_suffix: '',
    seo_meta_description: '',
    seo_meta_keywords: '',
    seo_og_image_url: '',
    seo_auto_sitemap: true,
    seo_canonical_urls: true,
    seo_open_graph: true,
    seo_twitter_cards: true,
    seo_google_verification: '',
    seo_bing_verification: '',
    tenant_meta_title: '',
    tenant_meta_description: '',
    tenant_h1_headline: '',
    tenant_hero_intro: '',
  });

  useEffect(() => {
    adminSettings.getSeoSettings()
      .then(res => {
        if (res.data) {
          const raw = res.data as Record<string, unknown>;
          const seo = (raw.seo ?? raw) as Record<string, unknown>;
          setFormData(prev => ({ ...prev, ...seo }));
        }
      })
      .catch(() => toast.error(t('failed_to_load_s_e_o_settings')))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadSitemapStats = useCallback(() => {
    setSitemapLoading(true);
    adminSettings.getSitemapStats()
      .then(res => {
        if (res.data) {
          setSitemapStats(res.data as unknown as SitemapStats);
        }
      })
      .catch(() => toast.error(t('failed_to_load_sitemap_stats')))
      .finally(() => setSitemapLoading(false));
  }, [t, toast])


  useEffect(() => {
    loadSitemapStats();
  }, [loadSitemapStats]);

  // Load last server-side SEO audit on mount
  useEffect(() => {
    adminTools.getSeoAudit()
      .then(res => {
        if (res.data) {
          setServerAudit(res.data);
        }
      })
      .catch(() => { /* silently fail — audit is optional */ });
  }, []);

  const handleRunAudit = async () => {
    setAuditRunning(true);
    try {
      const res = await adminTools.runSeoAudit();
      if (res.data) {
        setServerAudit(res.data);
        toast.success(t('seo_audit_completed'));
      }
    } catch {
      toast.error(t('failed_to_run_seo_audit'));
    } finally {
      setAuditRunning(false);
    }
  };

  const handleClearSitemapCache = async () => {
    setClearingCache(true);
    try {
      await adminSettings.clearSitemapCache();
      toast.success(t('sitemap_cache_cleared'));
      loadSitemapStats();
    } catch {
      toast.error(t('failed_to_clear_sitemap_cache'));
    } finally {
      setClearingCache(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const key of [...SEO_KEYS, ...TENANT_KEYS]) {
        if (key in formData) payload[key] = formData[key];
      }

      const res = await adminSettings.updateSeoSettings(payload);

      if (res.success) {
        toast.success(t('s_e_o_settings_saved_successfully'));
      } else {
        const error = t('save_failed');
        toast.error(error);
      }
    } catch {
      toast.error(t('failed_to_save_s_e_o_settings'));
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  // Run a client-side SEO health check based on current settings
  const runHealthCheck = (): SeoCheckResult[] => {
    const checks: SeoCheckResult[] = [];

    // Title suffix
    const suffix = String(formData.seo_title_suffix || '');
    checks.push({
      name: t('health_title_suffix'),
      status: suffix.length > 0 ? 'pass' : 'warning',
      detail: suffix.length > 0
        ? t('health_title_suffix_configured', { suffix })
        : t('health_title_suffix_missing'),
    });

    // Meta description
    const desc = String(formData.seo_meta_description || formData.tenant_meta_description || '');
    checks.push({
      name: t('health_meta_description'),
      status: desc.length >= 120 ? 'pass' : desc.length >= 50 ? 'warning' : 'fail',
      detail: desc.length > 0
        ? t('health_meta_description_length', { count: desc.length })
        : t('health_meta_description_missing'),
    });

    // OG Image
    const ogImage = String(formData.seo_og_image_url || '');
    checks.push({
      name: t('health_default_og_image'),
      status: ogImage.length > 0 ? 'pass' : 'warning',
      detail: ogImage.length > 0
        ? t('health_og_image_configured')
        : t('health_og_image_missing'),
    });

    // Open Graph
    checks.push({
      name: t('open_graph_tags'),
      status: formData.seo_open_graph ? 'pass' : 'fail',
      detail: formData.seo_open_graph ? t('enabled') : t('health_open_graph_disabled'),
    });

    // Twitter Cards
    checks.push({
      name: t('twitter_cards'),
      status: formData.seo_twitter_cards ? 'pass' : 'fail',
      detail: formData.seo_twitter_cards ? t('enabled') : t('health_twitter_cards_disabled'),
    });

    // Canonical URLs
    checks.push({
      name: t('canonical_urls'),
      status: formData.seo_canonical_urls ? 'pass' : 'warning',
      detail: formData.seo_canonical_urls
        ? t('health_canonical_enabled')
        : t('health_canonical_disabled'),
    });

    // Sitemap
    checks.push({
      name: t('label_auto_sitemap'),
      status: formData.seo_auto_sitemap ? 'pass' : 'fail',
      detail: formData.seo_auto_sitemap
        ? sitemapStats ? t('health_auto_sitemap_active_count', { count: sitemapStats.total_urls }) : t('chip_active')
        : t('health_auto_sitemap_disabled'),
    });

    // Google verification
    const gv = String(formData.seo_google_verification || '');
    checks.push({
      name: t('label_google_search_console_verification'),
      status: gv.length > 0 ? 'pass' : 'warning',
      detail: gv.length > 0 ? t('health_google_verification_configured') : t('health_google_verification_missing'),
    });

    // Tenant meta title
    const mt = String(formData.tenant_meta_title || '');
    checks.push({
      name: t('health_tenant_title'),
      status: mt.length > 0 ? 'pass' : 'warning',
      detail: mt.length > 0 ? t('health_tenant_title_set', { title: mt }) : t('health_tenant_title_missing'),
    });

    // H1 headline
    const h1 = String(formData.tenant_h1_headline || '');
    checks.push({
      name: t('health_homepage_h1'),
      status: h1.length > 0 ? 'pass' : 'warning',
      detail: h1.length > 0 ? t('health_homepage_h1_set', { headline: h1 }) : t('health_homepage_h1_missing'),
    });

    return checks;
  };

  const healthChecks = loading ? [] : runHealthCheck();
  const passCount = healthChecks.filter(c => c.status === 'pass').length;
  const warnCount = healthChecks.filter(c => c.status === 'warning').length;
  const failCount = healthChecks.filter(c => c.status === 'fail').length;

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('seo_overview_title')} description={t('seo_overview_desc')} />

      <div className="space-y-4">
        {/* SEO Health Score */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 size={20} />
              {t('seo_health_check_heading')}
            </h3>
            <div className="flex items-center gap-2">
              <Chip color="success" variant="soft" size="sm">{t('pass_count', { count: passCount })}</Chip>
              {warnCount > 0 && <Chip color="warning" variant="soft" size="sm">{t('warning_count', { count: warnCount })}</Chip>}
              {failCount > 0 && <Chip color="danger" variant="soft" size="sm">{t('fail_count', { count: failCount })}</Chip>}
            </div>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              {healthChecks.map((check) => (
                <div key={check.name} className="flex items-start gap-3 py-1">
                  {check.status === 'pass' && <CheckCircle size={18} className="text-success mt-0.5 shrink-0" />}
                  {check.status === 'warning' && <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />}
                  {check.status === 'fail' && <XCircle size={18} className="text-danger mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{check.name}</p>
                    <p className="text-xs text-muted">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Tenant-level meta (stored directly on tenants table) */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Globe size={20} />
              {t('tenant_meta_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('label_meta_title')}
              placeholder={t('placeholder_your_timebank_name')}
              variant="secondary"
              value={String(formData.tenant_meta_title || '')}
              onValueChange={(v) => updateField('tenant_meta_title', v)}
              description={t('desc_meta_title')}
            />
            <Input
              label={t('label_meta_description')}
              placeholder={t('placeholder_a_short_description_of_your_timebank')}
              variant="secondary"
              value={String(formData.tenant_meta_description || '')}
              onValueChange={(v) => updateField('tenant_meta_description', v)}
              description={t('meta_description_count', { count: String(formData.tenant_meta_description || '').length })}
            />
            <Input
              label={t('label_h1_headline')}
              placeholder={t('placeholder_welcome_to_our_community')}
              variant="secondary"
              value={String(formData.tenant_h1_headline || '')}
              onValueChange={(v) => updateField('tenant_h1_headline', v)}
              description={t('desc_h1_headline')}
            />
            <Input
              label={t('label_hero_intro_text')}
              placeholder={t('placeholder_exchange_skills_and_time_with_your_community')}
              variant="secondary"
              value={String(formData.tenant_hero_intro || '')}
              onValueChange={(v) => updateField('tenant_hero_intro', v)}
              description={t('desc_hero_intro')}
            />
          </CardBody>
        </Card>

        {/* Default OG Image */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Image size={20} />
              {t('social_sharing_image_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <SharingImageField
              value={String(formData.seo_og_image_url || '')}
              onChange={(v) => updateField('seo_og_image_url', v)}
            />
          </CardBody>
        </Card>

        {/* Global SEO settings (stored in tenant_settings) */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Search size={20} />
              {t('meta_tags_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('label_default_title_suffix')}
              placeholder={t('placeholder_default_title_suffix')}
              variant="secondary"
              value={String(formData.seo_title_suffix || '')}
              onValueChange={(v) => updateField('seo_title_suffix', v)}
              description={t('desc_title_suffix')}
            />
            <Input
              label={t('label_global_meta_description')}
              placeholder={t('placeholder_community_timebanking_platform')}
              variant="secondary"
              value={String(formData.seo_meta_description || '')}
              onValueChange={(v) => updateField('seo_meta_description', v)}
              description={t('global_meta_description_count', { count: String(formData.seo_meta_description || '').length })}
            />
            <Input
              label={t('label_meta_keywords')}
              placeholder={t('placeholder_meta_keywords')}
              variant="secondary"
              value={String(formData.seo_meta_keywords || '')}
              onValueChange={(v) => updateField('seo_meta_keywords', v)}
              description={t('desc_meta_keywords')}
            />
          </CardBody>
        </Card>

        {/* SEO Feature Toggles */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Share2 size={20} />
              {t('seo_features_heading')}
            </h3>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('auto_generate_sitemap')}</p>
                <p className="text-sm text-muted">{t('auto_generate_sitemap_desc')}</p>
              </div>
              <Switch isSelected={!!formData.seo_auto_sitemap} onValueChange={(v) => updateField('seo_auto_sitemap', v)} aria-label={t('label_auto_sitemap')} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('canonical_urls')}</p>
                <p className="text-sm text-muted">{t('canonical_urls_desc')}</p>
              </div>
              <Switch isSelected={!!formData.seo_canonical_urls} onValueChange={(v) => updateField('seo_canonical_urls', v)} aria-label={t('canonical_urls')} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('open_graph_tags')}</p>
                <p className="text-sm text-muted">{t('open_graph_tags_desc')}</p>
              </div>
              <Switch isSelected={!!formData.seo_open_graph} onValueChange={(v) => updateField('seo_open_graph', v)} aria-label={t('label_open_graph')} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('twitter_cards')}</p>
                <p className="text-sm text-muted">{t('twitter_cards_desc')}</p>
              </div>
              <Switch isSelected={!!formData.seo_twitter_cards} onValueChange={(v) => updateField('seo_twitter_cards', v)} aria-label={t('twitter_cards')} />
            </div>
          </CardBody>
        </Card>

        {/* Verification & Robots */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={20} />
              {t('verification_robots_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('label_google_search_console_verification')}
              placeholder="google-site-verification=..."
              variant="secondary"
              value={String(formData.seo_google_verification || '')}
              onValueChange={(v) => updateField('seo_google_verification', v)}
            />
            <Input
              label={t('label_bing_webmaster_verification')}
              placeholder="msvalidate.01=..."
              variant="secondary"
              value={String(formData.seo_bing_verification || '')}
              onValueChange={(v) => updateField('seo_bing_verification', v)}
            />
            {/* The "Custom robots.txt" box lived here until 2026-10-22. It saved
                `seo_robots_txt` and nothing read it: robots.txt is a static file
                served by the frontend container's nginx (see nginx.bluegreen.conf),
                so the box promised a per-community robots.txt that never existed. */}
          </CardBody>
        </Card>

        {/* Sitemap Stats */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={20} />
              {t('sitemap_heading')}
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                startContent={<RefreshCw size={14} />}
                onPress={loadSitemapStats}
                isLoading={sitemapLoading}
              >
                {t('btn_refresh')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={handleClearSitemapCache}
                isLoading={clearingCache}
              >
                {t('btn_clear_cache')}
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {sitemapLoading && !sitemapStats ? (
              <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : sitemapStats ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t('sitemap_url_label')}</span>
                  <a
                    href={sitemapStats.sitemap_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent flex items-center gap-1 hover:underline"
                  >
                    {sitemapStats.sitemap_url}
                    <ExternalLink size={12} />
                  </a>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t('sitemap_total_urls')}</span>
                  <Chip color="accent" variant="soft">{sitemapStats.total_urls}</Chip>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">{t('sitemap_urls_by_type')}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {Object.entries(sitemapStats.content_types).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-2">
                        <span className="text-xs">{t(`sitemap_content_type_${type}`, { defaultValue: t('sitemap_content_type_unknown') })}</span>
                        <Chip size="sm" variant="soft">{count}</Chip>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('unable_to_load_sitemap_stats')}</p>
            )}
          </CardBody>
        </Card>

        {/* Server-Side SEO Audit */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Search size={20} />
              {t('server_seo_audit_heading')}
            </h3>
            <div className="flex items-center gap-2">
              {serverAudit?.run_at && (
                <span className="text-xs text-muted">
                  {t('last_run')}: {new Date(serverAudit.run_at).toLocaleDateString(getFormattingLocale())}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                onPress={handleRunAudit}
                isLoading={auditRunning}
              >
                {t('run_audit')}
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {serverAudit?.checks && serverAudit.checks.length > 0 ? (
              <div className="space-y-2">
                {serverAudit.checks.map((check) => (
                  <div key={check.code} className="flex items-start gap-3 py-1">
                    {check.status === 'pass' && <CheckCircle size={18} className="text-success mt-0.5 shrink-0" />}
                    {check.status === 'warning' && <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />}
                    {check.status === 'fail' && <XCircle size={18} className="text-danger mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{t(getSeoAuditCheckNameKey(check.code), check.params)}</p>
                      <p className="text-xs text-muted">
                        {t(getSeoAuditCheckDescriptionKey(check.code), check.params)}
                      </p>
                      {check.issues.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                          {check.issues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              {t(getSeoAuditIssueKey(issue.code), issue.params)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                {auditRunning ? t('running_audit') : t('no_audit_results_prompt')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            size="lg"
            startContent={<Save size={18} />}
            onPress={handleSave}
            isLoading={saving}
            isDisabled={saving}
          >
            {t('save_seo_settings')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SeoOverview;
