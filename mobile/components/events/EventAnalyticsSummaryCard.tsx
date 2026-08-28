// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { EventAnalyticsCard } from '@/components/events/EventAnalyticsCard';
import { getEventAnalytics } from '@/lib/api/eventAnalytics';
import { useApi } from '@/lib/hooks/useApi';
import type { Theme } from '@/lib/hooks/useTheme';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function EventAnalyticsSummaryCard({
  eventId,
  primary,
  theme,
  t,
  refreshSignal = 0,
}: {
  eventId: number;
  primary: string;
  theme: Theme;
  t: Translate;
  refreshSignal?: number;
}) {
  const analytics = useApi(
    () => getEventAnalytics(eventId),
    [eventId],
    { enabled: eventId > 0 },
  );

  useEffect(() => {
    if (refreshSignal > 0) analytics.refresh();
    // refresh is stable within useApi; refreshSignal is the intentional trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  return (
    <EventAnalyticsCard
      summary={analytics.data?.data ?? null}
      isLoading={analytics.isLoading}
      error={analytics.error}
      onRefresh={analytics.refresh}
      primary={primary}
      theme={theme}
      t={t}
    />
  );
}
