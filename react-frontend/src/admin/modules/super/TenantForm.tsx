import { CardBody, Card, Select, SelectItem, Button, Spinner, Input, Textarea, Switch, Tabs, Tab, Checkbox } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tenant Create/Edit Form
 * Multi-tab form for tenant management: Details, Contact, SEO, Location, Social, Languages.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';

import Building2 from 'lucide-react/icons/building-2';
import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Eye from 'lucide-react/icons/eye';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { languageDisplayName } from '@/lib/languageDisplayName';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { SuperAdminTenant, SuperAdminTenantDetail, CreateTenantPayload } from '../../api/types';

const COUNTRY_CODES = [
  'IE', 'GB', 'US', 'CA', 'AU', 'NZ', 'DE', 'FR', 'ES', 'IT',
  'NL', 'BE', 'PT', 'SE', 'NO', 'DK', 'FI', 'PL', 'AT', 'CH',
];

const SERVICE_AREAS = ['local', 'regional', 'national', 'international'];

const PLATFORM_LANGUAGES = [
  { code: 'en', short: 'EN' },
  { code: 'ga', short: 'GA' },
  { code: 'de', short: 'DE' },
  { code: 'fr', short: 'FR' },
  { code: 'it', short: 'IT' },
  { code: 'pt', short: 'PT' },
  { code: 'es', short: 'ES' },
];

/**
 * Whether a hub still has room below it for one more community.
 *
 * `max_depth` is an ABSOLUTE level cap, not a relative allowance — the server
 * rejects a child whose own depth would exceed the parent's max_depth (see
 * TenantHierarchyService::createTenant). So a hub sitting at or past its own
 * cap can never hold anything, and offering it as a parent only produces a 422.
 * `max_depth` of 0 means unlimited.
 */
function parentHasRoom(parent: Pick<SuperAdminTenant, 'depth' | 'max_depth'>): boolean {
  const maxDepth = Number(parent.max_depth ?? 0);
  if (maxDepth <= 0) return true;
  return Number(parent.depth ?? 0) + 1 <= maxDepth;
}

export function TenantForm() {
  const { t, i18n } = useTranslation('admin_super');
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;
  usePageTitle(isEdit ? t('tenant_form.page_title_edit') : t('tenant_form.page_title_create'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [parentTenants, setParentTenants] = useState<SuperAdminTenant[]>([]);
  // Preserve the full original configuration JSON so save doesn't wipe unmanaged keys
  const [originalConfiguration, setOriginalConfiguration] = useState<Record<string, unknown>>({});

  // Form state
  const [form, setForm] = useState({
    name: '',
    slug: '',
    domain: '',
    accessible_domain: '',
    tagline: '',
    description: '',
    is_active: true,
    allows_subtenants: false,
    max_depth: 3,
    parent_id: '' as string, // Set from ?parent_id query param below
    // Contact
    contact_email: '',
    contact_phone: '',
    address: '',
    // SEO
    meta_title: '',
    meta_description: '',
    h1_headline: '',
    hero_intro: '',
    og_image_url: '',
    robots_directive: '',
    seo_organization_type: '',
    // Location
    location_name: '',
    country_code: '',
    service_area: '',
    latitude: '',
    longitude: '',
    // Social
    social_facebook: '',
    social_twitter: '',
    social_instagram: '',
    social_linkedin: '',
    social_youtube: '',
    // Languages
    default_language: 'en',
    supported_languages: ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as string[],
  });
  const [initialForm, setInitialForm] = useState<typeof form | null>(null);

  const [slugAutoGen, setSlugAutoGen] = useState(!isEdit);

  const updateField = (field: string, value: unknown) => {
    setForm((prev) => {
      const updated = { ...prev, [field]: value };
      // Auto-generate slug from name on create
      if (field === 'name' && slugAutoGen && !isEdit) {
        updated.slug = (value as string)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }
      return updated;
    });
  };

  const loadTenant = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await adminSuper.getTenant(Number(id));
      if (res.success && res.data) {
        const tenant = res.data as SuperAdminTenantDetail;
        // Preserve the full configuration so save merges rather than overwrites
        const fullConfig = (tenant.configuration ?? {}) as Record<string, unknown>;
        setOriginalConfiguration(fullConfig);
        const loadedForm = {
          name: tenant.name || '',
          slug: tenant.slug || '',
          domain: tenant.domain || '',
          accessible_domain: tenant.accessible_domain || '',
          tagline: tenant.tagline || '',
          description: tenant.description || '',
          is_active: tenant.is_active ?? true,
          allows_subtenants: tenant.allows_subtenants ?? false,
          max_depth: tenant.max_depth ?? 3,
          parent_id: tenant.parent_id ? String(tenant.parent_id) : '',
          contact_email: tenant.contact_email || '',
          contact_phone: tenant.contact_phone || '',
          address: tenant.address || '',
          meta_title: tenant.meta_title || '',
          meta_description: tenant.meta_description || '',
          h1_headline: tenant.h1_headline || '',
          hero_intro: tenant.hero_intro || '',
          og_image_url: tenant.og_image_url || '',
          robots_directive: tenant.robots_directive || '',
          seo_organization_type: tenant.seo_organization_type || '',
          location_name: tenant.location_name || '',
          country_code: tenant.country_code || '',
          service_area: tenant.service_area || '',
          latitude: tenant.latitude || '',
          longitude: tenant.longitude || '',
          social_facebook: tenant.social_facebook || '',
          social_twitter: tenant.social_twitter || '',
          social_instagram: tenant.social_instagram || '',
          social_linkedin: tenant.social_linkedin || '',
          social_youtube: tenant.social_youtube || '',
          default_language: (tenant.configuration as Record<string, unknown>)?.default_language as string || 'en',
          supported_languages: (tenant.configuration as Record<string, unknown>)?.supported_languages as string[] || ['en'],
        };
        setForm(loadedForm);
        setInitialForm(loadedForm);
      }
    } catch {
      toast.error(t('tenant_form.failed_to_load_tenant'));
    }
    setLoading(false);
  }, [id, toast, t])


  const loadParentTenants = useCallback(async () => {
    try {
      const res = await adminSuper.listTenants({ hub: true });
      if (res.success && res.data) {
        setParentTenants(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  // Pre-fill parent_id from query param (e.g. ?parent_id=5 from "Create Sub-Tenant")
  useEffect(() => {
    if (!isEdit) {
      const qParent = searchParams.get('parent_id');
      if (qParent) {
        setForm((prev) => ({ ...prev, parent_id: qParent }));
      }
    }
  }, [isEdit, searchParams]);

  useEffect(() => {
    loadParentTenants();
    if (isEdit) loadTenant();
  }, [isEdit, loadTenant, loadParentTenants]);

  // Hubs offered as a parent. The list endpoint already filters to hubs
  // (allows_subtenants = 1); a tenant can never be its own parent.
  const selectableParents = parentTenants.filter((parent) => String(parent.id) !== id);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('tenant_form.name_required'));
      return;
    }
    if (!isEdit && !form.slug.trim()) {
      toast.error(t('tenant_form.slug_required'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      const configurationFields = new Set([
        'default_language',
        'supported_languages',
      ]);
      for (const [field, value] of Object.entries(form)) {
        if (
          configurationFields.has(field)
          || field === 'parent_id'
          || (isEdit && field === 'allows_subtenants')
        ) {
          continue;
        }
        const originalValue = initialForm?.[field as keyof typeof form];
        if (!isEdit || initialForm === null || JSON.stringify(value) !== JSON.stringify(originalValue)) {
          payload[field] = value;
        }
      }
      if (!isEdit && form.parent_id) {
        payload.parent_id = Number(form.parent_id);
      }

      // Merge language settings into configuration JSON, preserving all existing keys
      // (modules, federation, broker_controls, footer_text, etc.)
      const mergedConfig: Record<string, unknown> = {
        ...originalConfiguration,
        default_language: form.default_language,
        supported_languages: form.supported_languages,
      };
      if (!isEdit || JSON.stringify(mergedConfig) !== JSON.stringify(originalConfiguration)) {
        payload.configuration = mergedConfig;
      }

      // The update endpoint accepts partial payloads. Keep an unchanged save a
      // valid operation without resubmitting legacy contact/routing values that
      // may now be governed by stricter validation.
      if (isEdit && Object.keys(payload).length === 0) {
        payload.name = form.name;
      }

      let res;
      if (isEdit) {
        res = await adminSuper.updateTenant(Number(id), payload);
      } else {
        res = await adminSuper.createTenant(payload as unknown as CreateTenantPayload);
      }

      if (res.success) {
        toast.success(isEdit ? t('tenant_form.tenant_updated') : t('tenant_form.tenant_created'));
        if (isEdit) {
          navigate(tenantPath(`/super-admin/tenants/${id}`));
        } else {
          // Navigate to the new tenant's show page if ID is returned, otherwise go to list
          const newId = (res as { data?: { tenant_id?: number } }).data?.tenant_id;
          navigate(tenantPath(newId ? `/super-admin/tenants/${newId}` : '/super-admin/tenants'));
        }
      } else {
        // Show the server's own reason (e.g. "Maximum hierarchy depth exceeded",
        // "Slug 'x' is already in use"). The API returns it as errors[0].message
        // and the client maps that to res.error; showing only the generic string
        // left the operator with a 422 and nothing to act on.
        const generic = isEdit
          ? t('tenant_form.failed_to_update_tenant')
          : t('tenant_form.failed_to_create_tenant');
        toast.error(res.error || generic);
      }
    } catch {
      toast.error(t('tenant_form.an_error_occurred'));
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('tenant_form.breadcrumb_super_admin')}</Link>
        <span>/</span>
        <Link to={tenantPath('/super-admin/tenants')} className="hover:text-accent">{t('tenant_form.breadcrumb_tenants')}</Link>
        <span>/</span>
        <span className="text-foreground">{isEdit ? t('tenant_form.breadcrumb_edit') : t('tenant_form.breadcrumb_create')}</span>
      </nav>
      <PageHeader
        title={isEdit ? t('tenant_form.title_edit') : t('tenant_form.title_create')}
        description={isEdit ? t('tenant_form.desc_edit') : t('tenant_form.desc_create')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              onPress={() => navigate(tenantPath(isEdit ? `/super-admin/tenants/${id}` : '/super-admin/tenants'))}
            >
              {t('tenant_form.back')}
            </Button>
            <Button
              startContent={<Save size={16} />}
              onPress={handleSubmit}
              isLoading={saving}
            >
              {isEdit ? t('tenant_form.save_changes') : t('tenant_form.create_tenant')}
            </Button>
          </div>
        }
      />

      <Tabs aria-label={t('tenant_form.tabs_aria')} variant="underlined" className="mb-4">
        <Tab key="details" title={t('tenant_form.tab_details')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              <Input
                label={t('tenant_form.name_label')}
                placeholder={t('tenant_form.name_placeholder')}
                value={form.name}
                onValueChange={(v) => updateField('name', v)}
                isRequired
                startContent={<Building2 size={16} className="text-muted" />}
              />
              <Input
                label={t('tenant_form.slug_label')}
                placeholder={t('tenant_form.slug_placeholder')}
                value={form.slug}
                onValueChange={(v) => {
                  setSlugAutoGen(false);
                  updateField('slug', v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
                isRequired
                description={slugAutoGen ? t('tenant_form.slug_auto_desc') : t('tenant_form.slug_manual_desc')}
              />
              <Input
                label={t('tenant_form.domain_label')}
                placeholder={t('tenant_form.domain_placeholder')}
                description={t('tenant_form.domain_desc')}
                value={form.domain}
                onValueChange={(v) => updateField('domain', v)}
              />
              <Input
                label={t('tenant_form.accessible_domain_label')}
                placeholder={t('tenant_form.accessible_domain_placeholder')}
                description={t('tenant_form.accessible_domain_desc')}
                value={form.accessible_domain}
                onValueChange={(v) => updateField('accessible_domain', v)}
              />
              <Input
                label={t('tenant_form.tagline_label')}
                placeholder={t('tenant_form.tagline_placeholder')}
                value={form.tagline}
                onValueChange={(v) => updateField('tagline', v)}
              />
              <Textarea
                label={t('tenant_form.description_label')}
                placeholder={t('tenant_form.description_placeholder')}
                value={form.description}
                onValueChange={(v) => updateField('description', v)}
                minRows={3}
              />
              <Select
                label={t('tenant_form.parent_tenant_label')}
                placeholder={t('tenant_form.parent_tenant_placeholder')}
                selectedKeys={form.parent_id ? [form.parent_id] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  updateField('parent_id', arr.length > 0 ? String(arr[0]) : '');
                }}
                isDisabled={isEdit}
                description={isEdit ? t('tenant_form.parent_edit_desc') : undefined}
                disabledKeys={selectableParents
                  .filter((parent) => !parentHasRoom(parent))
                  .map((parent) => String(parent.id))}
              >
                {selectableParents.map((parent) => (
                  <SelectItem
                    key={String(parent.id)}
                    id={String(parent.id)}
                    description={parentHasRoom(parent)
                      ? undefined
                      : t('tenant_form.parent_depth_limit_reached')}
                  >
                    {parent.name}
                  </SelectItem>
                ))}
              </Select>
              <div className="flex items-center gap-8">
                <Switch
                  isSelected={form.is_active}
                  onValueChange={(v) => updateField('is_active', v)}
                >
                  {t('tenant_form.active')}
                </Switch>
                {!isEdit && (
                  <Switch
                    isSelected={form.allows_subtenants}
                    onValueChange={(v) => updateField('allows_subtenants', v)}
                  >
                    {t('tenant_form.allows_subtenants')}
                  </Switch>
                )}
              </div>
              {isEdit && (
                <p className="text-sm text-muted">
                  {t('tenant_form.hub_capability_managed_desc')}{' '}
                  <Link
                    to={tenantPath(`/super-admin/tenants/${id}`)}
                    className="font-medium text-accent hover:underline"
                  >
                    {t('tenant_form.open_hub_settings')}
                  </Link>
                </p>
              )}
              {form.allows_subtenants && (
                <Input
                  type="number"
                  label={t('tenant_form.max_depth_label')}
                  description={t('tenant_form.max_depth_desc')}
                  value={String(form.max_depth)}
                  onValueChange={(v) => updateField('max_depth', Number(v) || 3)}
                  className="max-w-xs"
                />
              )}
            </CardBody>
          </Card>
        </Tab>

        <Tab key="contact" title={t('tenant_form.tab_contact')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              <Input
                label={t('tenant_form.contact_email_label')}
                type="email"
                placeholder="admin@example.com"
                value={form.contact_email}
                onValueChange={(v) => updateField('contact_email', v)}
              />
              <Input
                label={t('tenant_form.contact_phone_label')}
                placeholder="+1 555 123 4567"
                value={form.contact_phone}
                onValueChange={(v) => updateField('contact_phone', v)}
              />
              <Textarea
                label={t('tenant_form.address_label')}
                placeholder={t('tenant_form.address_placeholder')}
                value={form.address}
                onValueChange={(v) => updateField('address', v)}
                minRows={2}
              />
            </CardBody>
          </Card>
        </Tab>

        <Tab key="seo" title={t('tenant_form.tab_seo')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              {/* Live SERP Preview */}
              <div className="rounded-lg border border-border p-4 bg-surface">
                <p className="text-xs font-medium uppercase text-muted mb-2 flex items-center gap-1">
                  <Eye size={12} /> {t('tenant_form.google_search_preview')}
                </p>
                <p className="text-lg text-blue-700 dark:text-accent truncate">
                  {form.meta_title || form.name || t('tenant_form.page_title_fallback')}
                </p>
                <p className="text-sm text-green-700 dark:text-success truncate">
                  {form.domain ? `https://${form.domain}` : `https://${form.slug || 'tenant'}.project-nexus.ie`}
                </p>
                <p className="text-sm text-muted line-clamp-2">
                  {form.meta_description || t('tenant_form.no_description_set')}
                </p>
              </div>
              <Input
                label={t('tenant_form.meta_title_label')}
                placeholder={t('tenant_form.meta_title_placeholder')}
                value={form.meta_title}
                onValueChange={(v) => updateField('meta_title', v)}
                description={t('tenant_form.characters_count')}
                maxLength={70}
              />
              <Textarea
                label={t('tenant_form.meta_description_label')}
                placeholder={t('tenant_form.meta_description_placeholder')}
                value={form.meta_description}
                onValueChange={(v) => updateField('meta_description', v)}
                description={t('tenant_form.characters_count')}
                maxLength={180}
                minRows={2}
              />
              <Input
                label={t('tenant_form.h1_headline_label')}
                placeholder={t('tenant_form.h1_headline_placeholder')}
                value={form.h1_headline}
                onValueChange={(v) => updateField('h1_headline', v)}
                maxLength={100}
              />
              <Textarea
                label={t('tenant_form.hero_intro_label')}
                placeholder={t('tenant_form.hero_intro_placeholder')}
                value={form.hero_intro}
                onValueChange={(v) => updateField('hero_intro', v)}
                minRows={2}
              />
              <Input
                label={t('tenant_form.og_image_url_label')}
                placeholder="https://example.com/image.jpg"
                value={form.og_image_url}
                onValueChange={(v) => updateField('og_image_url', v)}
                description={t('tenant_form.og_image_url_description')}
              />
              <Select
                label={t('tenant_form.robots_directive_label')}
                placeholder={t('tenant_form.robots_directive_placeholder')}
                selectedKeys={form.robots_directive ? [form.robots_directive] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  updateField('robots_directive', arr.length > 0 ? String(arr[0]) : '');
                }}
                className="max-w-xs"
                description={t('tenant_form.robots_description')}
              >
                <SelectItem key="index, follow" id="index, follow">{t('tenant_form.robots_index_follow')}</SelectItem>
                <SelectItem key="noindex, follow" id="noindex, follow">{t('tenant_form.robots.noindex_follow')}</SelectItem>
                <SelectItem key="index, nofollow" id="index, nofollow">{t('tenant_form.robots.index_nofollow')}</SelectItem>
                <SelectItem key="noindex, nofollow" id="noindex, nofollow">{t('tenant_form.robots.noindex_nofollow')}</SelectItem>
              </Select>
              <Select
                label={t('tenant_form.organisation_type_label')}
                placeholder={t('tenant_form.organisation_type_placeholder')}
                selectedKeys={form.seo_organization_type ? [form.seo_organization_type] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  updateField('seo_organization_type', arr.length > 0 ? String(arr[0]) : '');
                }}
                className="max-w-xs"
                description={t('tenant_form.organisation_type_description')}
              >
                <SelectItem key="NonprofitOrganization" id="NonprofitOrganization">{t('tenant_form.schema_nonprofit')}</SelectItem>
                <SelectItem key="LocalBusiness" id="LocalBusiness">{t('tenant_form.schema_local_business')}</SelectItem>
                <SelectItem key="CommunityOrganization" id="CommunityOrganization">{t('tenant_form.schema_community')}</SelectItem>
                <SelectItem key="VolunteerOrganization" id="VolunteerOrganization">{t('tenant_form.schema_volunteer')}</SelectItem>
                <SelectItem key="GovernmentOrganization" id="GovernmentOrganization">{t('tenant_form.schema_government')}</SelectItem>
              </Select>
            </CardBody>
          </Card>
        </Tab>

        <Tab key="location" title={t('tenant_form.tab_location')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              <Input
                label={t('tenant_form.location_name_label')}
                placeholder={t('tenant_form.location_name_placeholder')}
                value={form.location_name}
                onValueChange={(v) => updateField('location_name', v)}
              />
              <Select
                label={t('tenant_form.country_label')}
                placeholder={t('tenant_form.country_placeholder')}
                selectedKeys={form.country_code ? [form.country_code] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  updateField('country_code', arr.length > 0 ? String(arr[0]) : '');
                }}
                className="max-w-xs"
              >
                {COUNTRY_CODES.map((code) => (
                  <SelectItem key={code} id={code}>{t(`tenant_form.countries.${code}`)} ({code})</SelectItem>
                ))}
              </Select>
              <Select
                label={t('tenant_form.service_area_label')}
                placeholder={t('tenant_form.service_area_placeholder')}
                selectedKeys={form.service_area ? [form.service_area] : []}
                onSelectionChange={(keys) => {
                  const arr = Array.from(keys);
                  updateField('service_area', arr.length > 0 ? String(arr[0]) : '');
                }}
                className="max-w-xs"
              >
                {SERVICE_AREAS.map((key) => (
                  <SelectItem key={key} id={key}>{t(`tenant_form.service_areas.${key}`)}</SelectItem>
                ))}
              </Select>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('tenant_form.latitude_label')}
                  placeholder="40.7128"
                  value={form.latitude}
                  onValueChange={(v) => updateField('latitude', v)}
                />
                <Input
                  label={t('tenant_form.longitude_label')}
                  placeholder="-74.0060"
                  value={form.longitude}
                  onValueChange={(v) => updateField('longitude', v)}
                />
              </div>
            </CardBody>
          </Card>
        </Tab>

        <Tab key="social" title={t('tenant_form.tab_social')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              <Input
                label={t('tenant_form.facebook_label')}
                placeholder="https://facebook.com/..."
                value={form.social_facebook}
                onValueChange={(v) => updateField('social_facebook', v)}
              />
              <Input
                label={t('tenant_form.twitter_label')}
                placeholder="https://twitter.com/..."
                value={form.social_twitter}
                onValueChange={(v) => updateField('social_twitter', v)}
              />
              <Input
                label={t('tenant_form.instagram_label')}
                placeholder="https://instagram.com/..."
                value={form.social_instagram}
                onValueChange={(v) => updateField('social_instagram', v)}
              />
              <Input
                label={t('tenant_form.linkedin_label')}
                placeholder="https://linkedin.com/..."
                value={form.social_linkedin}
                onValueChange={(v) => updateField('social_linkedin', v)}
              />
              <Input
                label={t('tenant_form.youtube_label')}
                placeholder="https://youtube.com/..."
                value={form.social_youtube}
                onValueChange={(v) => updateField('social_youtube', v)}
              />
            </CardBody>
          </Card>
        </Tab>

        <Tab key="languages" title={t('tenant_form.tab_languages')}>
          <Card>
            <CardBody className="space-y-4 p-6">
              <Select
                label={t('tenant_form.default_language_label')}
                description={t('tenant_form.default_language_description')}
                selectedKeys={[form.default_language]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) updateField('default_language', val);
                }}
                className="max-w-xs"
              >
                {PLATFORM_LANGUAGES.filter((l) =>
                  form.supported_languages.includes(l.code)
                ).map((lang) => (
                  <SelectItem key={lang.code} id={lang.code}>
                    {languageDisplayName(lang.code, i18n.resolvedLanguage)} ({lang.short})
                  </SelectItem>
                ))}
              </Select>
              <div>
                <p className="text-sm font-medium mb-1">{t('tenant_form.available_languages')}</p>
                <p className="text-xs text-muted mb-3">
                  {t('tenant_form.available_languages_desc')}
                </p>
                <div className="space-y-2">
                  {PLATFORM_LANGUAGES.map((lang) => (
                    <Checkbox
                      key={lang.code}
                      isSelected={form.supported_languages.includes(lang.code)}
                      isDisabled={lang.code === 'en'}
                      onValueChange={(checked) => {
                        const updated = checked
                          ? [...form.supported_languages, lang.code]
                          : form.supported_languages.filter((c) => c !== lang.code);
                        updateField('supported_languages', updated);
                        // Reset default to English if it was unchecked
                        if (!checked && form.default_language === lang.code) {
                          updateField('default_language', 'en');
                        }
                      }}
                    >
                      <span className="text-sm">
                        {languageDisplayName(lang.code, i18n.resolvedLanguage)} ({lang.short})
                        {lang.code === 'en' && (
                          <span className="ml-2 text-xs text-muted">{t('tenant_form.always_enabled')}</span>
                        )}
                      </span>
                    </Checkbox>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        </Tab>
      </Tabs>
    </div>
  );
}

export default TenantForm;
