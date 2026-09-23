// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VereinMembershipBadge — AG54
 *
 * Renders a small chip showing whether the user holds an active membership
 * (paid/waived) for the given Verein for the current year. If pending or
 * overdue the chip is amber; if no record exists, returns null.
 *
 * API: GET /v2/users/{userId}/verein-membership-status?organization_id={orgId}
 */

import { useEffect, useState } from 'react';import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { Chip } from '@/components/ui';

interface MembershipStatusResponse {
  user_id: number;
  organization_id: number;
  current_year: number;
  current: { status: string } | null;
  is_current_member: boolean;
}

export interface VereinMembershipBadgeProps {
  userId: number;
  organizationId: number;
  /** When true, do not render anything if no record exists for the user */
  hideWhenAbsent?: boolean;
}

export function VereinMembershipBadge({ userId, organizationId, hideWhenAbsent = true }: VereinMembershipBadgeProps) {
  const { t } = useTranslation('common');
  const [data, setData] = useState<MembershipStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<MembershipStatusResponse>(
          `/v2/users/${userId}/verein-membership-status?organization_id=${organizationId}`
        );
        if (!cancelled && res.success && res.data) setData(res.data);
      } catch {
        // silent — badge is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [userId, organizationId]);

  if (!data) return null;
  if (!data.current && hideWhenAbsent) return null;

  const status = data.current?.status ?? 'none';
  const year = data.current_year;

  if (status === 'paid' || status === 'waived') {
    return (
      <Chip
        color="success"
        size="sm"
        variant="flat"
        startContent={<CheckCircle2 className="w-3 h-3" />}
      >
        {t('verein_dues.badge_member_year', { year })}
      </Chip>
    );
  }

  if (status === 'pending' || status === 'overdue') {
    return (
      <Chip
        color="warning"
        size="sm"
        variant="flat"
        startContent={<AlertCircle className="w-3 h-3" />}
      >
        {t(`verein_dues.badge_${status}`, status === 'pending' ? 'Dues pending' : 'Dues overdue')}
      </Chip>
    );
  }

  return null;
}

export default VereinMembershipBadge;
