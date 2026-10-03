// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Risk tags tab: risk tags on listings the member owns.
 *
 * The risk-tag rows carry the owner's NAME but no owner id (the table has
 * `listing_id` only and the controller selects `u.name AS owner_name`). Rows
 * are matched on `owner_id` / `user_id` when a future backend adds one, and
 * on the owner's name until then — the tab says so, because two members with
 * the same name would be shown together.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Tag from 'lucide-react/icons/tag';
import { Chip } from '@/components/ui';
import { adminBroker } from '@/admin/api/adminApi';
import type { RiskTag } from '@/admin/api/types';
import { formatServerDate } from '@/lib/serverTime';
import { MemberTabSection, MemberTabRow } from './MemberTabSection';
import { asArray, useMemberTabData } from './memberWindowData';

type RiskTagRow = RiskTag & { owner_id?: number | string | null; user_id?: number | string | null };

const LEVEL_COLOR: Record<RiskTag['risk_level'], 'default' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

/** True when the tag belongs to the member — by id when the row has one, else by owner name. */
export function riskTagBelongsTo(tag: RiskTagRow, userId: number, memberName?: string | null): boolean {
  const ownerId = tag.owner_id ?? tag.user_id;
  if (ownerId != null && ownerId !== '') return Number(ownerId) === userId;
  const name = memberName?.trim();
  return !!name && (tag.owner_name?.trim() ?? '') === name;
}

export function MemberRiskTagsTab({ userId, memberName }: { userId: number; memberName?: string | null }) {
  const { t } = useTranslation('broker');

  const load = useCallback(async (id: number) => {
    const res = await adminBroker.getRiskTags({});
    if (!res.success) throw new Error('risk-tags');
    const rows = asArray<RiskTagRow>(res.data).filter((tag) => riskTagBelongsTo(tag, id, memberName));
    return { rows, truncated: false };
  }, [memberName]);

  const data = useMemberTabData<RiskTagRow>(userId, load);

  return (
    <MemberTabSection
      loading={data.loading}
      error={data.error}
      onRetry={data.reload}
      isEmpty={data.rows.length === 0}
      empty={{ icon: Tag, title: t('member_detail.risk_tags_empty_title'), hint: t('member_detail.risk_tags_empty_hint') }}
      seeAllPath="/broker/risk-tags"
      header={<p className="text-xs text-muted">{t('member_detail.risk_tags_name_match_hint')}</p>}
    >
      {data.rows.map((tag) => (
        <MemberTabRow
          key={tag.id}
          title={tag.listing_title || `#${tag.listing_id}`}
          detail={
            <>
              <span>{t(`risk_tags.category_${tag.risk_category}`, { defaultValue: tag.risk_category })}</span>
              {tag.tagged_by_name && <span>{t('risk_tags.col_tagged_by')}: {tag.tagged_by_name}</span>}
              <span className="tabular-nums">{formatServerDate(tag.created_at)}</span>
            </>
          }
          aside={
            <>
              <Chip size="sm" variant="soft" color={LEVEL_COLOR[tag.risk_level] ?? 'default'}>
                {t(`risk_tags.level_${tag.risk_level}`, { defaultValue: tag.risk_level })}
              </Chip>
              {tag.requires_approval ? (
                <Chip size="sm" variant="tertiary" color="warning">{t('risk_tags.col_approval_req')}</Chip>
              ) : null}
              {tag.insurance_required ? (
                <Chip size="sm" variant="tertiary" color="accent">{t('risk_tags.col_insurance')}</Chip>
              ) : null}
            </>
          }
        />
      ))}
    </MemberTabSection>
  );
}

export default MemberRiskTagsTab;
