import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Spinner, Input, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Switch } from '@/components/ui';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';

import { Separator } from '@/components/ui';
import Building2 from 'lucide-react/icons/building-2';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Edit from 'lucide-react/icons/square-pen';
import Globe from 'lucide-react/icons/globe';
import Languages from 'lucide-react/icons/languages';
import MapPin from 'lucide-react/icons/map-pin';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import ExternalLink from 'lucide-react/icons/external-link';
import Network from 'lucide-react/icons/network';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import XCircle from 'lucide-react/icons/circle-x';
import Facebook from 'lucide-react/icons/facebook';
import Twitter from 'lucide-react/icons/twitter';
import Instagram from 'lucide-react/icons/instagram';
import Linkedin from 'lucide-react/icons/linkedin';
import Youtube from 'lucide-react/icons/youtube';
import UserPlus from 'lucide-react/icons/user-plus';
import UserMinus from 'lucide-react/icons/user-minus';
import Plus from 'lucide-react/icons/plus';
import MoveRight from 'lucide-react/icons/move-right';
import Power from 'lucide-react/icons/power';
import Trash2 from 'lucide-react/icons/trash-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast, useAuth } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SuperAdminTenantDetail, TenantPurgePreview } from '../../api/types';
import { languageDisplayName } from '@/lib/languageDisplayName';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tenant Detail (Read-Only) Page
 * Displays full tenant information matching the PHP tenants/show.php view.
 */


const FEATURE_OPTIONS = [
  'events', 'groups', 'gamification', 'goals', 'blog', 'resources',
  'volunteering', 'exchange_workflow', 'federation', 'organisations',
  'listings', 'wallet', 'messages', 'dashboard', 'feed',
];

const FEATURE_LABEL_KEYS: Record<string, string> = {
  events: 'super.feature_events',
  groups: 'super.feature_groups',
  gamification: 'super.feature_gamification',
  goals: 'super.feature_goals',
  blog: 'super.feature_blog',
  resources: 'super.feature_resources',
  volunteering: 'super.feature_volunteering',
  exchange_workflow: 'super.feature_exchange_workflow',
  federation: 'super.feature_federation',
  organisations: 'super.feature_organisations',
  listings: 'super.feature_listings',
  wallet: 'super.feature_wallet',
  messages: 'super.feature_messages',
  dashboard: 'super.feature_dashboard',
  feed: 'super.feature_feed',
};

export function TenantShow() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Permanent purge is god-only — mirrors requireGod() (is_god flag) on the server.
  const userRecord = user as { is_god?: boolean; role?: string; tenant_id?: number } | null;
  const isGod = userRecord?.is_god === true || userRecord?.role === 'god';
  const viewerTenantId = userRecord?.tenant_id ?? null;

  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<SuperAdminTenantDetail | null>(null);

  // Add Administrator form
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminForm, setAdminForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    role: 'admin',
  });
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [removingAdminId, setRemovingAdminId] = useState<number | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<{ id: number; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Guard ref to prevent Switch onValueChange re-entry (HeroUI fires on programmatic isSelected changes)
  const togglingHub = useRef(false);
  const [hubDisablePending, setHubDisablePending] = useState(false);

  // Move Tenant modal
  const moveModal = useDisclosure();
  const [moveParentId, setMoveParentId] = useState('');
  const [hubTenants, setHubTenants] = useState<{ id: number; name: string }[]>([]);

  // Permanent purge modal (god-only, irreversible)
  const purgeModal = useDisclosure();
  const [purgePreview, setPurgePreview] = useState<TenantPurgePreview | null>(null);
  const [purgePreviewLoading, setPurgePreviewLoading] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purging, setPurging] = useState(false);

  // Load hub tenants for move dropdown
  const loadHubTenants = useCallback(async () => {
    try {
      const res = await adminSuper.listTenants({ hub: true });
      if (res.success && res.data) {
        setHubTenants(Array.isArray(res.data) ? res.data : []);
      }
    } catch { /* non-critical */ }
  }, []);

  const handleMove = async () => {
    if (!tenant || !moveParentId) return;
    setActionLoading(true);
    try {
      const res = await adminSuper.moveTenant(tenant.id, Number(moveParentId));
      if (res.success) {
        toast.success(t('super.tenant_moved_successfully'));
        moveModal.onClose();
        loadTenant();
      } else {
        toast.error(t('super.failed_to_move_tenant'));
      }
    } catch { toast.error(t('super.an_error_occurred')); }
    setActionLoading(false);
  };

  const handleToggleActive = async () => {
    if (!tenant) return;
    setActionLoading(true);
    try {
      let res;
      if (tenant.is_active) {
        res = await adminSuper.deleteTenant(tenant.id);
      } else {
        res = await adminSuper.reactivateTenant(tenant.id);
      }
      if (res.success) {
        const newActive = !tenant.is_active;
        toast.success(newActive ? t('super.tenant_reactivated') : t('super.tenant_deactivated'));
        setTenant((prev) => prev ? { ...prev, is_active: newActive } : prev);
      } else {
        toast.error(t('super.operation_failed'));
      }
    } catch { toast.error(t('super.an_error_occurred')); }
    setActionLoading(false);
  };

  const openPurgeModal = async () => {
    if (!tenant) return;
    setPurgePreview(null);
    setPurgeConfirmText('');
    purgeModal.onOpen();
    setPurgePreviewLoading(true);
    try {
      const res = await adminSuper.purgeTenantPreview(tenant.id);
      if (res.success && res.data) {
        setPurgePreview(res.data);
      } else {
        toast.error(t('super.purge_preview_failed'));
      }
    } catch { toast.error(t('super.an_error_occurred')); }
    setPurgePreviewLoading(false);
  };

  const handlePurge = async () => {
    if (!tenant || purgeConfirmText !== tenant.slug) return;
    setPurging(true);
    try {
      const res = await adminSuper.purgeTenant(tenant.id);
      if (res.success) {
        toast.success(t('super.purge_started'));
        purgeModal.onClose();
        navigate(tenantPath('/super-admin/tenants'));
      } else {
        toast.error(t('super.purge_failed'));
      }
    } catch { toast.error(t('super.an_error_occurred')); }
    setPurging(false);
  };

  const updateHubCapability = async (enable: boolean) => {
    if (!tenant || togglingHub.current || tenant.allows_subtenants === enable) return;
    togglingHub.current = true;
    setActionLoading(true);
    try {
      const res = await adminSuper.toggleHub(tenant.id, enable);
      if (res.success) {
        toast.success(enable ? t('super.hub_enabled') : t('super.hub_disabled'));
        // Optimistic update — avoids refetch which re-triggers Switch onValueChange
        setTenant((prev) => prev ? {
          ...prev,
          allows_subtenants: enable,
          max_depth: enable ? Math.max(prev.max_depth, 2) : 0,
        } : prev);
        setHubDisablePending(false);
      } else {
        toast.error(t('super.failed_to_toggle_hub'));
      }
    } catch { toast.error(t('super.an_error_occurred')); }
    setActionLoading(false);
    // Release guard after a tick so the Switch settles
    requestAnimationFrame(() => { togglingHub.current = false; });
  };

  const handleHubToggleRequest = (enable: boolean) => {
    if (!tenant || actionLoading || enable === tenant.allows_subtenants) return;
    if (!enable && tenant.children.length > 0) {
      toast.warning(t('super.disable_hub_blocked_children'));
      return;
    }
    if (!enable) {
      setHubDisablePending(true);
      return;
    }
    void updateHubCapability(true);
  };

  const loadTenant = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await adminSuper.getTenant(Number(id));
      if (res.success && res.data) {
        setTenant(res.data as SuperAdminTenantDetail);
      } else {
        toast.error(t('super.failed_to_load_tenant'));
      }
    } catch {
      toast.error(t('super.an_error_occurred'));
    }
    setLoading(false);
  }, [id, toast, t])


  const handleAddAdmin = async () => {
    if (!tenant) return;
    if (!adminForm.first_name.trim() || !adminForm.email.trim() || !adminForm.password.trim()) {
      toast.error(t('super.first_name_email_and_password_are_requ'));
      return;
    }
    setAddingAdmin(true);
    try {
      const res = await adminSuper.createUser({
        tenant_id: tenant.id,
        first_name: adminForm.first_name.trim(),
        last_name: adminForm.last_name.trim(),
        email: adminForm.email.trim(),
        password: adminForm.password,
        role: adminForm.role,
      });
      if (res.success) {
        toast.success(t('super.administrator_added_successfully'));
        setShowAddAdmin(false);
        setAdminForm({ first_name: '', last_name: '', email: '', password: '', role: 'admin' });
        loadTenant(); // Refresh to show new admin
      } else {
        toast.error(t('super.failed_to_add_administrator'));
      }
    } catch {
      toast.error(t('super.failed_to_add_administrator'));
    }
    setAddingAdmin(false);
  };

  const handleRemoveAdmin = async (admin: { id: number; name: string }) => {
    setRemovingAdminId(admin.id);
    try {
      const res = await adminSuper.updateUser(admin.id, { role: 'member' });
      if (res.success) {
        toast.success(t('super.admin_demoted'));
        loadTenant();
      } else {
        toast.error(t('super.failed_to_remove_admin'));
      }
    } catch {
      toast.error(t('super.an_error_occurred'));
    }
    setRemovingAdminId(null);
  };

  useEffect(() => {
    loadTenant();
  }, [loadTenant]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted">{t('super.tenant_not_found')}</p>
        <Button
          variant="secondary"
          className="mt-4"
          startContent={<ArrowLeft aria-hidden="true" size={16} />}
          onPress={() => navigate(tenantPath('/super-admin/tenants'))}
        >
          {t('super.back_to_tenants')}
        </Button>
      </div>
    );
  }

  const socialLinks = [
    { key: 'facebook', label: t('super.social_facebook'), url: tenant.social_facebook, icon: Facebook },
    { key: 'twitter', label: t('super.social_twitter'), url: tenant.social_twitter, icon: Twitter },
    { key: 'instagram', label: t('super.social_instagram'), url: tenant.social_instagram, icon: Instagram },
    { key: 'linkedin', label: t('super.social_linkedin'), url: tenant.social_linkedin, icon: Linkedin },
    { key: 'youtube', label: t('super.social_youtube'), url: tenant.social_youtube, icon: Youtube },
  ];

  const hasSocialLinks = socialLinks.some((s) => s.url);

  return (
    <div>
      <PageHeader
        title={tenant.name}
        description={tenant.tagline || t('super.tenant_id_value', { id: tenant.id })}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              startContent={<ArrowLeft aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/super-admin/tenants'))}
            >
              {t('super.back')}
            </Button>
            <Button
              startContent={<Edit aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath(`/super-admin/tenants/${tenant.id}/edit`))}
            >
              {t('super.edit')}
            </Button>
          </div>
        }
      />

      {/* Breadcrumb trail */}
      {tenant.breadcrumb && tenant.breadcrumb.length > 0 && (
        <div className="mb-4 flex items-center gap-1 text-sm text-muted">
          {tenant.breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1">/</span>}
              {crumb.id === tenant.id ? (
                <span className="font-medium text-foreground">{crumb.name}</span>
              ) : (
                <Link
                  to={tenantPath(`/super-admin/tenants/${crumb.id}`)}
                  className="text-accent hover:underline"
                >
                  {crumb.name}
                </Link>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left Column (2/3) ── */}
        <div className="space-y-6 lg:col-span-2">
          {/* Tenant Information */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Building2 aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_tenant_information')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label={t('super.label_name')} value={tenant.name} />
                <DetailField label={t('super.label_slug')} value={tenant.slug} />
                <DetailField label={t('super.label_domain')} value={tenant.domain} />
                <DetailField
                  label={t('super.label_parent_tenant')}
                  value={
                    tenant.parent_id ? (
                      <Link
                        to={tenantPath(`/super-admin/tenants/${tenant.parent_id}`)}
                        className="text-accent hover:underline"
                      >
                        {tenant.parent_name || t('super.tenant_with_id', { id: tenant.parent_id })}
                      </Link>
                    ) : (
                      <span className="text-muted">{t('super.none_top_level')}</span>
                    )
                  }
                />
                <DetailField label={t('super.label_depth_in_hierarchy')} value={String(tenant.depth ?? 0)} />
                <DetailField label={t('super.label_max_subtenant_depth')} value={String(tenant.max_depth)} />
                <DetailField
                  label={t('super.label_allows_subtenants')}
                  value={
                    tenant.allows_subtenants ? (
                      <Chip color="success" variant="soft" size="sm">{t('super.yes_hub')}</Chip>
                    ) : (
                      <Chip color="default" variant="soft" size="sm">{t('super.no')}</Chip>
                    )
                  }
                />
              </dl>
              {tenant.description && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <p className="text-xs font-medium uppercase text-muted mb-1">{t('super.label_description')}</p>
                    <p className="text-sm text-foreground whitespace-pre-line">{tenant.description}</p>
                  </div>
                </>
              )}
              {tenant.tagline && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase text-muted mb-1">{t('super.label_tagline')}</p>
                  <p className="text-sm text-foreground">{tenant.tagline}</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Contact Information */}
          {(tenant.contact_email || tenant.contact_phone || tenant.address) && (
            <Card>
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2">
                  <Users aria-hidden="true" size={18} className="text-accent" />
                  <h3 className="text-lg font-semibold">{t('super.section_contact_information')}</h3>
                </div>
              </CardHeader>
              <CardBody className="pt-3">
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label={t('super.label_email')} value={tenant.contact_email} />
                  <DetailField label={t('super.label_phone')} value={tenant.contact_phone} />
                  <DetailField label={t('super.label_address')} value={tenant.address} />
                </dl>
              </CardBody>
            </Card>
          )}

          {/* SEO Settings */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Search aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_seo_settings')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              <dl className="grid grid-cols-1 gap-4">
                <DetailField label={t('super.label_meta_title')} value={tenant.meta_title} />
                <DetailField label={t('super.label_meta_description')} value={tenant.meta_description} />
                <DetailField label={t('super.label_h1_headline')} value={tenant.h1_headline} />
                <DetailField label={t('super.label_hero_introduction')} value={tenant.hero_intro} />
                <DetailField label={t('super.label_o_g_image_u_r_l')} value={tenant.og_image_url} />
                <DetailField label={t('super.label_robots_directive')} value={tenant.robots_directive} />
                <DetailField label={t('super.label_organisation_type')} value={tenant.seo_organization_type} />
              </dl>
            </CardBody>
          </Card>

          {/* Location Info */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <MapPin aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_location')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label={t('super.label_location_name')} value={tenant.location_name} />
                <DetailField label={t('super.label_country_code')} value={tenant.country_code} />
                <DetailField label={t('super.label_service_area')} value={tenant.service_area} />
                <DetailField label={t('super.label_latitude')} value={tenant.latitude} />
                <DetailField label={t('super.label_longitude')} value={tenant.longitude} />
              </dl>
            </CardBody>
          </Card>

          {/* Social Media Links */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Globe aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_social_media')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              {hasSocialLinks ? (
                <div className="space-y-3">
                  {socialLinks.map((social) => {
                    if (!social.url) return null;
                    const SocialIcon = social.icon;
                    return (
                      <div key={social.key} className="flex items-center gap-3">
                        <SocialIcon aria-hidden="true" size={18} className="text-muted shrink-0" />
                        <span className="text-sm font-medium text-muted w-24 shrink-0">
                          {social.label}
                        </span>
                        <a
                          href={social.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm text-accent hover:underline truncate"
                        >
                          {social.url}
                          <ExternalLink aria-hidden="true" size={12} className="shrink-0" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted">{t('super.no_social_links')}</p>
              )}
            </CardBody>
          </Card>

          {/* Languages */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Languages aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_languages')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField
                  label={t('super.label_default_language')}
                  value={
                    (() => {
                      const code = (tenant.configuration as Record<string, unknown>)?.default_language as string | undefined;
                      const languageCode = code ?? 'en';
                      return `${languageDisplayName(languageCode, getFormattingLocale())} (${languageCode.toUpperCase()})`;
                    })()
                  }
                />
                <div>
                  <dt className="text-xs font-medium uppercase text-muted">{t('super.label_supported_languages')}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {(() => {
                      const langs = (tenant.configuration as Record<string, unknown>)?.supported_languages as string[] | undefined;
                      const codes = langs ?? ['en'];
                      return codes.map((code) => (
                        <Chip key={code} size="sm" variant="soft" color="accent">
                          {languageDisplayName(code, getFormattingLocale())}
                        </Chip>
                      ));
                    })()}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {/* Module Features */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Network aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_features_modules')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              <div className="flex flex-wrap gap-2">
                {FEATURE_OPTIONS.map((feature) => {
                  const enabled = tenant.features?.[feature] === true;
                  return (
                    <Chip
                      key={feature}
                      color={enabled ? 'success' : 'default'}
                      variant={enabled ? 'soft' : 'secondary'}
                      size="sm"
                      startContent={
                        enabled
                          ? <CheckCircle2 aria-hidden="true" size={12} />
                          : <XCircle aria-hidden="true" size={12} />
                      }
                    >
                      {t(FEATURE_LABEL_KEYS[feature] ?? feature)}
                    </Chip>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Right Column (1/3) ── */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader className="pb-0">
              <h3 className="text-lg font-semibold">{t('super.section_status')}</h3>
            </CardHeader>
            <CardBody className="pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{t('super.label_active')}</span>
                <Chip
                  color={tenant.is_active ? 'success' : 'danger'}
                  variant="soft"
                  size="sm"
                >
                  {tenant.is_active ? t('super.status_active_label') : t('super.status_inactive_label')}
                </Chip>
              </div>
              {tenant.allows_subtenants && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{t('super.label_type')}</span>
                  <Chip color="default" variant="soft" size="sm">{t('super.hub')}</Chip>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">{t('super.label_max_depth')}</span>
                <span className="text-sm font-medium">{tenant.max_depth}</span>
              </div>
              {tenant.user_count !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{t('super.label_users')}</span>
                  <span className="text-sm font-medium">{tenant.user_count}</span>
                </div>
              )}
              {tenant.listing_count !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{t('super.label_listings')}</span>
                  <span className="text-sm font-medium">{tenant.listing_count}</span>
                </div>
              )}
              <Separator />
              <div className="text-xs text-muted">
                <p>{t('super.created')}: {new Date(tenant.created_at).toLocaleDateString(getFormattingLocale())}</p>
                {tenant.updated_at && (
                  <p>{t('super.updated')}: {new Date(tenant.updated_at).toLocaleDateString(getFormattingLocale())}</p>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Direct Children */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Building2 aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">
                  {t('super.section_children')}
                  {tenant.children.length > 0 && (
                    <span className="ml-1 text-sm font-normal text-muted">
                      ({tenant.children.length})
                    </span>
                  )}
                </h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              {tenant.children.length === 0 ? (
                <p className="text-sm text-muted">{t('super.no_child_tenants')}</p>
              ) : (
                <ul className="space-y-2">
                  {tenant.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        to={tenantPath(`/super-admin/tenants/${child.id}`)}
                        className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-hover transition-colors"
                      >
                        <Avatar
                          name={child.name}
                          size="sm"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{child.name}</p>
                          <p className="text-xs text-muted truncate">{child.slug}</p>
                        </div>
                        <Chip
                          color={child.is_active ? 'success' : 'danger'}
                          variant="soft"
                          size="sm"
                        >
                          {child.is_active ? t('super.status_active_label') : t('super.status_inactive_label')}
                        </Chip>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Tenant Admins */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Users aria-hidden="true" size={18} className="text-accent" />
                  <h3 className="text-lg font-semibold">
                    {t('super.section_admins')}
                    {tenant.admins.length > 0 && (
                      <span className="ml-1 text-sm font-normal text-muted">
                        ({tenant.admins.length})
                      </span>
                    )}
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={<UserPlus aria-hidden="true" size={14} />}
                  onPress={() => setShowAddAdmin(!showAddAdmin)}
                >
                  {showAddAdmin ? t('super.cancel') : t('super.add')}
                </Button>
              </div>
            </CardHeader>
            <CardBody className="pt-3">
              {/* Add Administrator Form */}
              {showAddAdmin && (
                <div className="mb-4 space-y-3 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{t('super.add_administrator')}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      size="sm"
                      variant="secondary"
                      label={t('super.label_first_name')}
                      isRequired
                      value={adminForm.first_name}
                      onValueChange={(v) => setAdminForm({ ...adminForm, first_name: v })}
                    />
                    <Input
                      size="sm"
                      variant="secondary"
                      label={t('super.label_last_name')}
                      value={adminForm.last_name}
                      onValueChange={(v) => setAdminForm({ ...adminForm, last_name: v })}
                    />
                  </div>
                  <Input
                    size="sm"
                    variant="secondary"
                    label={t('super.label_email')}
                    type="email"
                    isRequired
                    value={adminForm.email}
                    onValueChange={(v) => setAdminForm({ ...adminForm, email: v })}
                  />
                  <Input
                    size="sm"
                    variant="secondary"
                    label={t('super.label_password')}
                    type="password"
                    isRequired
                    value={adminForm.password}
                    onValueChange={(v) => setAdminForm({ ...adminForm, password: v })}
                  />
                  <Select
                    size="sm"
                    variant="secondary"
                    label={t('super.label_role')}
                    selectedKeys={[adminForm.role]}
                    onSelectionChange={(keys) => {
                      const val = Array.from(keys)[0] as string;
                      if (val) setAdminForm({ ...adminForm, role: val });
                    }}
                  >
                    <SelectItem key="admin" id="admin">{t('super.role_admin')}</SelectItem>
                    <SelectItem key="member" id="member">{t('super.role_member')}</SelectItem>
                  </Select>
                  <Button
                    size="sm"
                    variant="primary"
                    isLoading={addingAdmin}
                    onPress={handleAddAdmin}
                    fullWidth
                  >
                    {t('super.create_administrator')}
                  </Button>
                </div>
              )}

              {tenant.admins.length === 0 && !showAddAdmin ? (
                <p className="text-sm text-muted">{t('super.no_admins_found')}</p>
              ) : (
                <ul className="space-y-2">
                  {tenant.admins.map((admin) => (
                    <li key={admin.id}>
                      <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-hover transition-colors">
                        <Link
                          to={tenantPath(`/super-admin/users/${admin.id}`)}
                          className="flex items-center gap-3 min-w-0 flex-1"
                        >
                          <Avatar
                            name={admin.name}
                            size="sm"
                            className="shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{admin.name}</p>
                            <p className="text-xs text-muted truncate">{admin.email}</p>
                          </div>
                          <Chip variant="soft" size="sm" className="capitalize">
                            {t(`super.role_${admin.role}`, { defaultValue: t('super.role_unknown') })}
                          </Chip>
                        </Link>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="danger-soft"
                          isLoading={removingAdminId === admin.id}
                          onPress={() => setDemoteTarget(admin)}
                          aria-label={t('super.aria_remove_admin', { name: admin.name })}
                        >
                          <UserMinus size={14} />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-0">
              <h3 className="text-lg font-semibold">{t('super.section_actions')}</h3>
            </CardHeader>
            <CardBody className="pt-3 space-y-2">
              <Button
                variant="primary"
                fullWidth
                startContent={<Edit aria-hidden="true" size={16} />}
                onPress={() => navigate(tenantPath(`/super-admin/tenants/${tenant.id}/edit`))}
              >
                {t('super.edit_tenant')}
              </Button>
              {tenant.allows_subtenants && (
                <Button
                  variant="secondary"
                  fullWidth
                  startContent={<Plus aria-hidden="true" size={16} />}
                  onPress={() => navigate(tenantPath(`/super-admin/tenants/create?parent_id=${tenant.id}`))}
                >
                  {t('super.create_sub_tenant')}
                </Button>
              )}
              <Button
                variant="secondary"
                fullWidth
                startContent={<ArrowLeft aria-hidden="true" size={16} />}
                onPress={() => navigate(tenantPath('/super-admin/tenants'))}
              >
                {t('super.back_to_tenants')}
              </Button>
            </CardBody>
          </Card>

          {/* Hub Settings */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center gap-2">
                <Network aria-hidden="true" size={18} className="text-accent" />
                <h3 className="text-lg font-semibold">{t('super.section_hub_settings')}</h3>
              </div>
            </CardHeader>
            <CardBody className="pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t('super.subtenant_capability')}</p>
                  <p className="text-xs text-muted">
                    {tenant.allows_subtenants ? t('super.can_create_subtenants') : t('super.standard_tenant')}
                  </p>
                </div>
                <Switch
                  isSelected={tenant.allows_subtenants}
                  isDisabled={actionLoading || (tenant.allows_subtenants && tenant.children.length > 0)}
                  onValueChange={handleHubToggleRequest}
                  aria-label={t('super.label_toggle_hub_capability')}
                  aria-describedby={tenant.allows_subtenants && tenant.children.length > 0
                    ? 'hub-disable-blocked-description'
                    : undefined}
                />
              </div>
              {tenant.allows_subtenants && tenant.children.length > 0 && (
                <p id="hub-disable-blocked-description" className="text-xs text-warning">
                  {t('super.disable_hub_blocked_children')}
                </p>
              )}
            </CardBody>
          </Card>

          {/* Move Tenant */}
          {tenant.id !== 1 && (
            <Card>
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2">
                  <MoveRight aria-hidden="true" size={18} className="text-warning" />
                  <h3 className="text-lg font-semibold">{t('super.section_move_tenant')}</h3>
                </div>
              </CardHeader>
              <CardBody className="pt-3">
                <p className="text-xs text-muted mb-3">
                  {t('super.move_tenant_desc')}
                </p>
                <Button
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    loadHubTenants();
                    moveModal.onOpen();
                  }}
                >
                  {t('super.move_to_different_parent')}
                </Button>
              </CardBody>
            </Card>
          )}

          {/* Danger Zone */}
          {tenant.id !== 1 && (
            <Card className="border-danger/30">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-2 text-danger">
                  <AlertTriangle aria-hidden="true" size={18} />
                  <h3 className="text-lg font-semibold">{t('super.section_danger_zone')}</h3>
                </div>
              </CardHeader>
              <CardBody className="pt-3">
                {/*
                  * 🔴 Mirrors `SuperPanelAccess::canManageTenant()`: nobody below
                  * god may deactivate the community they operate from. Doing so
                  * would lock the person pressing the button — and everyone else
                  * in that community — out of the platform, so the server refuses
                  * it with a 403, and a button that can only produce a refusal is
                  * worse than no button. Reactivation is unaffected, since a
                  * community you are signed in to is by definition already active.
                  */}
                {(isGod || tenant.id !== viewerTenantId) ? (
                  <>
                    <Button
                      variant={tenant.is_active ? 'danger-soft' : 'secondary'}
                      className={tenant.is_active ? undefined : 'text-success'}
                      fullWidth
                      isDisabled={actionLoading}
                      startContent={<Power aria-hidden="true" size={16} />}
                      onPress={handleToggleActive}
                    >
                      {tenant.is_active ? t('super.deactivate_tenant') : t('super.reactivate_tenant')}
                    </Button>
                    {tenant.is_active && (
                      <p className="text-xs text-muted mt-2">
                        {t('super.deactivate_warning')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted" data-testid="own-tenant-deactivate-notice">
                    {t('super.cannot_deactivate_own_tenant')}
                  </p>
                )}

                {/* Permanent purge — god-only, and only once the tenant is deactivated. */}
                {isGod && (
                  <>
                    <Button
                      variant="danger"
                      fullWidth
                      className="mt-3"
                      isDisabled={tenant.is_active || actionLoading}
                      startContent={<Trash2 aria-hidden="true" size={16} />}
                      onPress={openPurgeModal}
                    >
                      {t('super.purge_tenant')}
                    </Button>
                    <p className="text-xs text-muted mt-2">
                      {tenant.is_active ? t('super.purge_requires_deactivation') : t('super.purge_warning')}
                    </p>
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* Move Tenant Modal */}
      <Modal isOpen={moveModal.isOpen} onClose={moveModal.onClose}>
        <ModalContent>
          <ModalHeader>{t('super.section_move_tenant')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted mb-3">
              {t('super.select_new_parent_for_tenant', { name: tenant.name })}
            </p>
            <Select
              variant="secondary"
              label={t('super.label_new_parent_tenant')}
              placeholder={t('super.placeholder_select_parent')}
              selectedKeys={moveParentId ? [moveParentId] : []}
              onSelectionChange={(keys) => {
                const arr = Array.from(keys);
                setMoveParentId(arr.length > 0 ? String(arr[0]) : '');
              }}
            >
              {hubTenants
                .filter((t) => t.id !== tenant.id && t.id !== tenant.parent_id)
                .map((t) => (
                  <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>
                ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={moveModal.onClose}>{t('super.cancel')}</Button>
            <Button
              variant="secondary"
              isDisabled={!moveParentId}
              isLoading={actionLoading}
              onPress={handleMove}
            >
              {t('super.move')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={hubDisablePending}
        onClose={() => {
          if (!actionLoading) setHubDisablePending(false);
        }}
        onConfirm={() => { void updateHubCapability(false); }}
        title={t('super.disable_hub_title')}
        message={t('super.disable_hub_confirm')}
        confirmLabel={t('super.disable_hub_confirm_action')}
        confirmColor="danger"
        isLoading={actionLoading}
      />

      {/* Permanent Purge Modal (god-only, irreversible) */}
      <Modal
        isOpen={purgeModal.isOpen}
        onClose={() => { if (!purging) purgeModal.onClose(); }}
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2 text-danger">
            <AlertTriangle aria-hidden="true" size={20} />
            {t('super.purge_tenant_title', { name: tenant.name })}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm font-medium text-danger">{t('super.purge_irreversible_warning')}</p>

            {purgePreviewLoading ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : purgePreview ? (
              <div className="mt-2 space-y-2 text-sm">
                <p className="text-muted">{t('super.purge_summary')}</p>
                <ul className="list-disc pl-5 text-muted space-y-1">
                  <li>{t('super.purge_rows', { rows: purgePreview.totals.rows, tables: purgePreview.totals.tables_touched })}</li>
                  <li>{t('super.purge_members', { n: purgePreview.members_to_delete })}</li>
                  {purgePreview.superadmins_reassigned > 0 && (
                    <li>{t('super.purge_superadmins', { n: purgePreview.superadmins_reassigned })}</li>
                  )}
                </ul>
                {purgePreview.manual_followups.length > 0 && (
                  <div className="rounded-md bg-warning/10 p-2 text-xs text-warning">
                    <p className="font-medium">{t('super.purge_manual_followups')}</p>
                    <ul className="list-disc pl-4 mt-1 space-y-1">
                      {purgePreview.manual_followups.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-4">
              <Input
                label={t('super.purge_confirm_label', { slug: tenant.slug })}
                placeholder={tenant.slug}
                value={purgeConfirmText}
                onValueChange={setPurgeConfirmText}
                autoComplete="off"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={purgeModal.onClose} isDisabled={purging}>{t('super.cancel')}</Button>
            <Button
              variant="danger"
              isLoading={purging}
              isDisabled={purging || purgeConfirmText !== tenant.slug}
              onPress={handlePurge}
            >
              {t('super.purge_confirm_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Demote Admin Confirmation */}
      <ConfirmModal
        isOpen={!!demoteTarget}
        onClose={() => setDemoteTarget(null)}
        onConfirm={() => {
          if (demoteTarget) {
            handleRemoveAdmin(demoteTarget);
            setDemoteTarget(null);
          }
        }}
        title={t('super.demote_admin_title')}
        message={t('super.demote_confirm')}
        confirmLabel={t('super.demote')}
        confirmColor="danger"
        isLoading={removingAdminId !== null}
      />
    </div>
  );
}

// Reusable detail field component
function DetailField({ label, value }: { label: string; value?: string | React.ReactNode }) {
  const isEmpty = !value || (typeof value === 'string' && !value.trim());
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">
        {isEmpty ? <span className="text-muted/70">--</span> : value}
      </dd>
    </div>
  );
}

export default TenantShow;
