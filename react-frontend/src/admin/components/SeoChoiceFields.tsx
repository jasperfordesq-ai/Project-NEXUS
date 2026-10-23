// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SeoChoiceFields — a community's tagline, search engine visibility
 * (`tenants.robots_directive`) and organisation type
 * (`tenants.seo_organization_type`).
 *
 * Shared by the community admin's /admin/seo and the super-admin tenant form
 * so both screens offer the same fields, wording and limits (owner, 23 Oct
 * 2026: community admins get every field the super-admin SEO tab has). The
 * server applies the same rules to both (App\Support\TenantSeoFields).
 */

import { useTranslation } from 'react-i18next';
import { Input, Select, SelectItem } from '@/components/ui';

export const TAGLINE_MAX = 255;

export const ROBOTS_CHOICES = [
  ['index, follow', 'robots_index_follow'],
  ['noindex, follow', 'robots_noindex_follow'],
  ['index, nofollow', 'robots_index_nofollow'],
  ['noindex, nofollow', 'robots_noindex_nofollow'],
] as const;

export const ORGANISATION_CHOICES = [
  ['NonprofitOrganization', 'org_nonprofit'],
  ['CommunityOrganization', 'org_community'],
  ['VolunteerOrganization', 'org_volunteer'],
  ['LocalBusiness', 'org_local_business'],
  ['GovernmentOrganization', 'org_government'],
] as const;

export interface SeoChoiceFieldsProps {
  tagline: string;
  robots: string;
  organisationType: string;
  onTaglineChange: (value: string) => void;
  onRobotsChange: (value: string) => void;
  onOrganisationTypeChange: (value: string) => void;
  /** Hide the tagline when the host screen already shows it (super-admin Details tab). */
  showTagline?: boolean;
}

export function SeoChoiceFields({
  tagline,
  robots,
  organisationType,
  onTaglineChange,
  onRobotsChange,
  onOrganisationTypeChange,
  showTagline = true,
}: SeoChoiceFieldsProps) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const firstKey = (keys: unknown): string => {
    const arr = Array.from(keys as Iterable<unknown>);
    return arr.length > 0 ? String(arr[0]) : '';
  };

  return (
    <>
      {showTagline && (
        <Input
          label={t('label_tagline')}
          placeholder={t('placeholder_tagline')}
          variant="secondary"
          value={tagline}
          maxLength={TAGLINE_MAX}
          onValueChange={onTaglineChange}
          description={t('desc_tagline', { count: tagline.length, max: TAGLINE_MAX })}
        />
      )}
      <Select
        label={t('label_search_visibility')}
        selectedKeys={[robots || 'index, follow']}
        onSelectionChange={(keys) => onRobotsChange(firstKey(keys))}
        description={t('desc_search_visibility')}
      >
        {ROBOTS_CHOICES.map(([value, key]) => (
          <SelectItem key={value} id={value}>{t(key)}</SelectItem>
        ))}
      </Select>
      <Select
        label={t('label_organisation_type')}
        placeholder={t('placeholder_organisation_type')}
        selectedKeys={organisationType ? [organisationType] : []}
        onSelectionChange={(keys) => onOrganisationTypeChange(firstKey(keys))}
        description={t('desc_organisation_type')}
      >
        {ORGANISATION_CHOICES.map(([value, key]) => (
          <SelectItem key={value} id={value}>{t(key)}</SelectItem>
        ))}
      </Select>
    </>
  );
}

export default SeoChoiceFields;
