// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Support needs tab: what the member told us about the
 * support they would like, what it switches on, and whether a broker has
 * seen it. Same endpoint as the Support needs page, filtered to the member;
 * "See all" opens that page focused on them (`?user=<id>`).
 */

import { useTranslation } from 'react-i18next';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import { Chip } from '@/components/ui';
import { api } from '@/lib/api';
import type { MemberSupportNeed } from '@/admin/modules/safeguarding/safeguardingShared';
import { formatServerDate } from '@/lib/serverTime';
import { MemberTabSection, MemberTabRow } from './MemberTabSection';
import { asArray, useMemberTabData } from './memberWindowData';

export const SUPPORT_NEEDS_ENDPOINT = '/v2/admin/safeguarding/member-preferences';

async function loadSupportNeeds(userId: number) {
  const res = await api.get<MemberSupportNeed[]>(SUPPORT_NEEDS_ENDPOINT);
  if (!res.success) throw new Error('support-needs');
  return { rows: asArray<MemberSupportNeed>(res.data).filter((e) => Number(e.user_id) === userId), truncated: false };
}

export function MemberSupportNeedsTab({ userId }: { userId: number }) {
  const { t } = useTranslation('broker');
  const data = useMemberTabData<MemberSupportNeed>(userId, loadSupportNeeds);

  return (
    <MemberTabSection
      loading={data.loading}
      error={data.error}
      onRetry={data.reload}
      isEmpty={data.rows.length === 0}
      empty={{ icon: LifeBuoy, title: t('member_detail.support_needs_empty_title'), hint: t('member_detail.support_needs_empty_hint') }}
      seeAllPath={`/broker/safeguarding/support-needs?user=${userId}`}
    >
      {data.rows.map((entry) => {
        const chosen = (entry.options ?? []).filter((o) => !o.is_declination);
        return (
          <MemberTabRow
            key={`${entry.user_id}-${entry.consent_given_at}`}
            title={
              entry.is_declination_only || chosen.length === 0 ? (
                <span className="font-normal text-muted">{t('member_detail.support_needs_declination')}</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {chosen.map((opt) => (
                    <Chip key={opt.option_key} size="sm" variant="soft" color="accent">{opt.label}</Chip>
                  ))}
                </span>
              )
            }
            detail={
              <>
                <span className="tabular-nums">{t('member_detail.support_needs_answered', { date: formatServerDate(entry.consent_given_at) })}</span>
                {(entry.protections?.length ?? 0) > 0 && (
                  <span>{t('member_detail.support_needs_protections', { count: entry.protections?.length ?? 0 })}</span>
                )}
              </>
            }
            aside={
              entry.needs_review ? (
                <Chip size="sm" variant="soft" color="warning">{t('member_detail.support_needs_unseen')}</Chip>
              ) : entry.seen_at ? (
                <Chip size="sm" variant="tertiary" color="success">{t('member_detail.support_needs_seen')}</Chip>
              ) : null
            }
          />
        );
      })}
    </MemberTabSection>
  );
}

export default MemberSupportNeedsTab;
