import { getFormattingLocale } from '@/lib/helpers';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Select, SelectItem } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';

import Save from 'lucide-react/icons/save';
import Eye from 'lucide-react/icons/eye';
import Search from 'lucide-react/icons/search';
import FileText from 'lucide-react/icons/file-text';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trash2 from 'lucide-react/icons/trash-2';
import PenLine from 'lucide-react/icons/pen-line';
import Ban from 'lucide-react/icons/ban';
import Scale from 'lucide-react/icons/scale';
import Info from 'lucide-react/icons/info';
import FileCheck from 'lucide-react/icons/file-check';
import Globe from 'lucide-react/icons/globe';
import ChevronRight from 'lucide-react/icons/chevron-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';

const INSURANCE_TYPE_KEYS = [
  'public_liability',
  'professional_indemnity',
  'employers_liability',
  'product_liability',
  'personal_accident',
  'other',
] as const;

const INSURANCE_STATUS_KEYS = ['verified', 'pending', 'submitted', 'rejected'] as const;

const selectClassNames = {
  trigger: 'bg-theme-elevated border-theme-default',
  value: 'text-theme-primary',
  label: 'text-theme-muted',
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrivacySettings {
  profile_visibility: 'public' | 'members' | 'connections';
  search_indexing: boolean;
}

export interface UserInsuranceCert {
  id: number;
  insurance_type: string;
  provider_name: string | null;
  status: string;
  expiry_date: string | null;
  created_at: string;
}

interface PrivacyTabProps {
  privacy: PrivacySettings;
  isSavingPrivacy: boolean;
  privacyLoading: boolean;
  privacyError: string | null;
  insuranceCerts: UserInsuranceCert[];
  insuranceLoading: boolean;
  insuranceUploading: boolean;
  insuranceType: string;
  insuranceProvider: string;
  insuranceExpiry: string;
  insuranceEnabled: boolean;
  federationEnabled: boolean;
  onPrivacyChange: (updater: (prev: PrivacySettings) => PrivacySettings) => void;
  onSavePrivacy: () => void;
  onRetryPrivacy: () => void;
  onInsuranceSave: () => void;
  onInsuranceTypeChange: (value: string) => void;
  onInsuranceProviderChange: (value: string) => void;
  onInsuranceExpiryChange: (value: string) => void;
  onOpenGdprModal: (type: string) => void;
  onOpenDeleteModal: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingToggle helper
// ─────────────────────────────────────────────────────────────────────────────

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SettingToggle({ label, description, checked, onChange }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-theme-elevated">
      <div className="min-w-0">
        <p className="font-medium text-theme-primary">{label}</p>
        <p className="text-sm text-theme-subtle">{description}</p>
      </div>
      <Switch
        aria-label={label}
        isSelected={checked}
        onValueChange={onChange}
        className="shrink-0"
        classNames={{
          wrapper: 'group-data-[selected=true]:bg-accent',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PrivacyTab({
  privacy,
  isSavingPrivacy,
  privacyLoading,
  privacyError,
  insuranceCerts,
  insuranceLoading,
  insuranceUploading,
  insuranceType,
  insuranceProvider,
  insuranceExpiry,
  insuranceEnabled,
  federationEnabled,
  onPrivacyChange,
  onSavePrivacy,
  onRetryPrivacy,
  onInsuranceSave,
  onInsuranceTypeChange,
  onInsuranceProviderChange,
  onInsuranceExpiryChange,
  onOpenGdprModal,
  onOpenDeleteModal,
}: PrivacyTabProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const actionRowClass = 'w-full justify-start text-theme-primary min-h-14 px-4 py-3';
  const navigationRowClass = 'w-full justify-between text-theme-primary min-h-14 px-4 py-3';
  const rowContentClass = 'min-w-0 text-left leading-tight';
  const rowDescriptionClass = 'text-sm text-theme-subtle font-normal leading-snug';

  const getInsuranceTypeLabel = (type: string) => (
    INSURANCE_TYPE_KEYS.includes(type as (typeof INSURANCE_TYPE_KEYS)[number])
      ? t(`insurance.${type}`)
      : t('insurance.other')
  );

  const getInsuranceStatusLabel = (status: string) => (
    INSURANCE_STATUS_KEYS.includes(status as (typeof INSURANCE_STATUS_KEYS)[number])
      ? t(`insurance.status_${status}`)
      : t('insurance.status_unknown')
  );

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-6">{t('privacy_sections.title')}</h2>

        {privacyLoading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-8 text-theme-muted">
            <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span>{t('privacy_loading')}</span>
          </div>
        ) : privacyError ? (
          <div role="alert" className="py-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[var(--color-warning)]" aria-hidden="true" />
            <p className="mb-4 text-theme-muted">{privacyError}</p>
            <Button variant="primary" onPress={onRetryPrivacy}>
              {t('try_again')}
            </Button>
          </div>
        ) : (
        <div className="space-y-6">
          {/* Profile Visibility */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Eye className="w-4 h-4" aria-hidden="true" />
              {t('privacy_sections.profile_visibility')}
            </h3>

            <Select
              label={t('privacy_prefs.profile_visibility')}
              selectedKeys={[privacy.profile_visibility]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string;
                if (value) {
                  onPrivacyChange((prev) => ({
                    ...prev,
                    profile_visibility: value as 'public' | 'members' | 'connections',
                  }));
                }
              }}
              classNames={selectClassNames}
            >
              <SelectItem key="public" id="public">{t('visibility_options.public')}</SelectItem>
              <SelectItem key="members" id="members">{t('visibility_options.members')}</SelectItem>
              <SelectItem key="connections" id="connections">{t('visibility_options.connections')}</SelectItem>
            </Select>
          </div>

          {/* Search & Discovery */}
          <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Search className="w-4 h-4" aria-hidden="true" />
              {t('privacy_sections.search_discovery')}
            </h3>

            <SettingToggle
              label={t('privacy_prefs.search_indexing')}
              description={t('privacy_descriptions.search_indexing')}
              checked={privacy.search_indexing}
              onChange={(checked) => onPrivacyChange((prev) => ({ ...prev, search_indexing: checked }))}
            />
          </div>

          <Button
            onPress={onSavePrivacy}
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<Save className="w-4 h-4" aria-hidden="true" />}
            isLoading={isSavingPrivacy}
          >
            {t('save_privacy')}
          </Button>
        </div>
        )}
      </GlassCard>

      {/* Federation Settings Link */}
      {federationEnabled && (
        <GlassCard className="p-6">
          <Button
            variant="secondary"
            className="w-full justify-between text-theme-primary min-h-16 px-4 py-4"
            startContent={
              <div className="flex min-w-0 items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/20">
                  <Globe className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div className={rowContentClass}>
                  <p className="font-medium">{t('federation.title')}</p>
                  <p className={rowDescriptionClass}>{t('federation.description')}</p>
                </div>
              </div>
            }
            endContent={<ChevronRight className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
            onPress={() => navigate(tenantPath('/federation/settings'))}
          />
        </GlassCard>
      )}

      {/* Blocked Users */}
      <GlassCard className="p-6">
        <Button
          variant="secondary"
          className={navigationRowClass}
          startContent={
            <div className="flex min-w-0 items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/20">
                <Ban className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <div className={rowContentClass}>
                <p className="font-medium">{t('blocked_users.title')}</p>
                <p className={rowDescriptionClass}>{t('blocked_users.description')}</p>
              </div>
            </div>
          }
          endContent={<ChevronRight className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
          onPress={() => navigate(tenantPath('/settings/blocked'))}
        />
      </GlassCard>

      {/* GDPR Section */}
      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
          <FileText className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
          {t('gdpr.title')}
        </h2>
        <p className="text-theme-subtle text-sm mb-6">
          {t('gdpr.description')}
        </p>

        <div className="space-y-3">
          <Button
            variant="secondary"
            className={actionRowClass}
            startContent={
              <div className="p-2 rounded-lg bg-accent/20">
                <Download className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
              </div>
            }
            endContent={<ChevronRight className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
            onPress={() => navigate(tenantPath('/settings/data-export'))}
          >
            <div className={rowContentClass}>
              <p className="font-medium">{t('data_export.title', { ns: 'common' })}</p>
              <p className={rowDescriptionClass}>{t('data_export.subtitle', { ns: 'common' })}</p>
            </div>
          </Button>

          <Button
            variant="danger-soft"
            className={actionRowClass}
            startContent={
              <div className="p-2 rounded-lg bg-red-500/20">
                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
            }
            onPress={onOpenDeleteModal}
          >
            <div className={rowContentClass}>
              <p className="font-medium text-red-700 dark:text-red-400">{t('gdpr.deletion_title')}</p>
              <p className={rowDescriptionClass}>{t('gdpr.deletion_desc')}</p>
            </div>
          </Button>

          <Button
            variant="secondary"
            className={actionRowClass}
            startContent={
              <div className="p-2 rounded-lg bg-amber-500/20">
                <PenLine className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>
            }
            onPress={() => onOpenGdprModal('rectification')}
          >
            <div className={rowContentClass}>
              <p className="font-medium">{t('gdpr.rectification_title')}</p>
              <p className={rowDescriptionClass}>{t('gdpr.rectification_desc')}</p>
            </div>
          </Button>

          <Button
            variant="secondary"
            className={actionRowClass}
            startContent={
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Ban className="w-4 h-4 text-orange-600 dark:text-orange-400" aria-hidden="true" />
              </div>
            }
            onPress={() => onOpenGdprModal('restriction')}
          >
            <div className={rowContentClass}>
              <p className="font-medium">{t('gdpr.restriction_title')}</p>
              <p className={rowDescriptionClass}>{t('gdpr.restriction_desc')}</p>
            </div>
          </Button>

          <Button
            variant="secondary"
            className={actionRowClass}
            startContent={
              <div className="p-2 rounded-lg bg-violet-500/20">
                <Scale className="w-4 h-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
              </div>
            }
            onPress={() => onOpenGdprModal('objection')}
          >
            <div className={rowContentClass}>
              <p className="font-medium">{t('gdpr.objection_title')}</p>
              <p className={rowDescriptionClass}>{t('gdpr.objection_desc')}</p>
            </div>
          </Button>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-theme-muted flex items-start gap-2">
            <Info className="w-4 h-4 text-[var(--color-info)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            {t('gdpr.info')}
          </p>
        </div>
      </GlassCard>

      {/* Insurance records — raw documents and sensitive data are prohibited. */}
      {insuranceEnabled && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {t('insurance.title')}
          </h2>
          <p className="text-theme-subtle text-sm mb-4">
            {t('insurance.description')}
          </p>

          {insuranceLoading ? (
            <div className="flex items-center gap-2 text-sm text-theme-muted">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {t('insurance.loading')}
            </div>
          ) : (
            <>
              {insuranceCerts.length > 0 && (
                <div className="space-y-2 mb-4">
                  {insuranceCerts.map((cert) => (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-theme-elevated p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-theme-primary">
                          {getInsuranceTypeLabel(cert.insurance_type)}
                        </p>
                        <p className="text-xs text-theme-muted">
                          {cert.provider_name || t('insurance.unknown_provider')}
                          {cert.expiry_date ? ` ${t('insurance.expires', { date: new Date(cert.expiry_date).toLocaleDateString(getFormattingLocale()) })}` : ''}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        cert.status === 'verified' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : cert.status === 'pending' || cert.status === 'submitted' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : cert.status === 'rejected' ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                          : 'bg-surface-secondary text-muted'
                      }`}>
                        {getInsuranceStatusLabel(cert.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={t('insurance.type_label')}
                  selectedKeys={[insuranceType]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) onInsuranceTypeChange(val);
                  }}
                  variant="secondary"
                  size="sm"
                  className="max-w-xs"
                >
                  <SelectItem key="public_liability" id="public_liability">{t('insurance.public_liability')}</SelectItem>
                  <SelectItem key="professional_indemnity" id="professional_indemnity">{t('insurance.professional_indemnity')}</SelectItem>
                  <SelectItem key="employers_liability" id="employers_liability">{t('insurance.employers_liability')}</SelectItem>
                  <SelectItem key="product_liability" id="product_liability">{t('insurance.product_liability')}</SelectItem>
                  <SelectItem key="personal_accident" id="personal_accident">{t('insurance.personal_accident')}</SelectItem>
                  <SelectItem key="other" id="other">{t('insurance.other')}</SelectItem>
                </Select>
                <Input
                  label={t('insurance.provider_label')}
                  value={insuranceProvider}
                  maxLength={255}
                  onValueChange={onInsuranceProviderChange}
                  variant="secondary"
                />
                <Input
                  label={t('insurance.expiry_label')}
                  type="date"
                  value={insuranceExpiry}
                  onValueChange={onInsuranceExpiryChange}
                  isRequired
                  variant="secondary"
                />
                <Button
                  onPress={onInsuranceSave}
                  isLoading={insuranceUploading}
                  isDisabled={!insuranceExpiry}
                  className="self-end"
                >
                  {t('insurance.save_record')}
                </Button>
              </div>
            </>
          )}
        </GlassCard>
      )}
    </div>
  );
}
