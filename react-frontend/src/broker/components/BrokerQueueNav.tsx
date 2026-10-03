// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "3 more waiting · Next" for a broker detail page header. Pairs with
 * useBrokerQueue; renders nothing until the queue is known, and nothing when
 * no other item is waiting.
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import ArrowRight from 'lucide-react/icons/arrow-right';
import type { BrokerQueue } from '../useBrokerQueue';

export function BrokerQueueNav({ queue }: { queue: BrokerQueue }) {
  const { t } = useTranslation('broker');
  if (!queue.nextId || !queue.remaining) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted" aria-live="polite">
        {t('queue.more_waiting', { count: queue.remaining })}
      </span>
      <Button
        size="sm"
        variant="secondary"
        endContent={<ArrowRight size={16} aria-hidden="true" />}
        onPress={() => void queue.goNext()}
        aria-label={t('queue.next_aria')}
      >
        {t('queue.next')}
      </Button>
    </div>
  );
}
