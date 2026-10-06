// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Lock from 'lucide-react/icons/lock';
import { Chip, Input, Separator } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState, UploadSlot } from '../useAdminSettingsForm';
import type { SettingsFormKey } from '../settingsForm';

export const POWERED_BY_SECTION_ID = 'powered-by';

interface BadgeFieldNames {
  label: SettingsFormKey;
  url: SettingsFormKey;
  imageLight: SettingsFormKey;
  imageDark: SettingsFormKey;
  slotLight: UploadSlot;
  slotDark: UploadSlot;
  idPrefix: string;
}

const OWN_BADGE: BadgeFieldNames = {
  label: 'powered_by_label',
  url: 'powered_by_url',
  imageLight: 'powered_by_image_light',
  imageDark: 'powered_by_image_dark',
  slotLight: 'powered_light',
  slotDark: 'powered_dark',
  idPrefix: 'powered',
};

const NETWORK_BADGE: BadgeFieldNames = {
  label: 'network_powered_by_label',
  url: 'network_powered_by_url',
  imageLight: 'network_powered_by_image_light',
  imageDark: 'network_powered_by_image_dark',
  slotLight: 'network_powered_light',
  slotDark: 'network_powered_dark',
  idPrefix: 'network-powered',
};

/** Label, link and light/dark images for one badge. */
function BadgeFields({ state, names }: { state: AdminSettingsFormState; names: BadgeFieldNames }) {
  const { t } = useTranslation('admin_system');
  const { form, originalForm, setField, uploading, upload, remove } = state;
  const text = (key: SettingsFormKey) => String(form[key] ?? '');
  const pendingRemoval = (key: SettingsFormKey) => form[key] === '' && originalForm[key] !== '';

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Input
          label={t('system.label_powered_by_label')}
          placeholder={t('system.placeholder_powered_by_label')}
          description={t('system.desc_powered_by_label')}
          variant="secondary"
          value={text(names.label)}
          onValueChange={(val) => setField(names.label, val)}
        />
        <Input
          label={t('system.label_powered_by_url')}
          placeholder={t('system.placeholder_powered_by_url')}
          description={t('system.desc_powered_by_url')}
          variant="secondary"
          type="url"
          value={text(names.url)}
          onValueChange={(val) => setField(names.url, val)}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogoUploadField
          id={`${names.idPrefix}-light`}
          label={t('system.label_powered_by_image_light')}
          value={text(names.imageLight) || null}
          persistence="deferred"
          pendingRemoval={pendingRemoval(names.imageLight)}
          uploading={uploading[names.slotLight]}
          onUpload={(file) => upload(names.slotLight, file)}
          onRemove={() => remove(names.slotLight)}
        />
        <LogoUploadField
          id={`${names.idPrefix}-dark`}
          label={t('system.label_powered_by_image_dark')}
          value={text(names.imageDark) || null}
          persistence="deferred"
          pendingRemoval={pendingRemoval(names.imageDark)}
          uploading={uploading[names.slotDark]}
          onUpload={(file) => upload(names.slotDark, file)}
          onRemove={() => remove(names.slotDark)}
        />
      </div>
    </>
  );
}

/**
 * Platform-god only: the footer's right-hand "Powered by" slot.
 *
 * Two badges. This community's OWN badge, and the NETWORK badge it hands down to
 * every community under it (at any depth, including communities created later)
 * that has not set its own. Resolution lives in PoweredByBadgeService on the
 * server; both frontends just read the result.
 */
export function PoweredBySection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');

  return (
    <SettingsSection
      id={POWERED_BY_SECTION_ID}
      icon={<Lock size={20} aria-hidden="true" />}
      tone="warning"
      title={t('system.powered_by_branding_section')}
      description={t('system.powered_by_branding_desc')}
      badge={<Chip size="sm" color="warning" variant="soft">{t('system.god_only_chip')}</Chip>}
      className="border-warning/40"
    >
      <section aria-labelledby="powered-by-own-heading" className="flex flex-col gap-5">
        <div>
          <h3 id="powered-by-own-heading" className="text-sm font-semibold text-foreground">
            {t('system.powered_by_own_heading')}
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-muted">{t('system.powered_by_own_desc')}</p>
        </div>
        <BadgeFields state={state} names={OWN_BADGE} />
      </section>
      <Separator />
      <section aria-labelledby="powered-by-network-heading" className="flex flex-col gap-5">
        <div>
          <h3 id="powered-by-network-heading" className="text-sm font-semibold text-foreground">
            {t('system.powered_by_network_heading')}
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-muted">{t('system.powered_by_network_desc')}</p>
        </div>
        <BadgeFields state={state} names={NETWORK_BADGE} />
      </section>
    </SettingsSection>
  );
}

export default PoweredBySection;
