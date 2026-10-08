// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Hand from 'lucide-react/icons/hand';
import { Button, ModalBody, ModalFooter, Progress } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';
import { formatHours, formatTimeLeft } from './format';
import { useFocusOnMount } from './useFocusOnMount';
import type { RunnerState } from './types';

interface Props {
  state: RunnerState;
  onStop: () => void;
}

/** While the import runs: a growing bar and plain numbers. The window cannot be closed here. */
export function ImportProgress({ state, onStop }: Props) {
  const { t } = useTranslation('admin_users');
  const { total, nextIndex, batchNumber, batchSize } = state;
  const stopping = state.phase === 'stopping';
  const lead = useFocusOnMount<HTMLDivElement>();

  const percent = total > 0 ? Math.min(100, Math.floor((nextIndex / total) * 100)) : 0;
  // `batchNumber` counts batches already finished, so the one in progress is the next.
  const batchesLeft = Math.ceil(Math.max(0, total - nextIndex) / Math.max(1, batchSize));
  const estimate = Math.max(1, batchNumber + batchesLeft);
  const current = Math.min(batchNumber + 1, estimate);
  // A screen reader hears this, and only this: it changes at each 10% and when the run is stopping,
  // not with every batch, so the figures below can update freely without a running commentary.
  const announcement = stopping
    ? t('member_import.running.stopping')
    : t('member_import.running.announce', { percent: formatNumber(Math.floor(percent / 10) * 10) });

  return (
    <>
      <ModalBody className="flex flex-col gap-4">
        <div ref={lead} tabIndex={-1} className="outline-none">
          <Progress aria-label={t('member_import.running.progress_label')} value={percent} showValueLabel />
        </div>
        <span aria-live="polite" className="sr-only">{announcement}</span>
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{t('member_import.running.batch', { n: current, m: estimate })}</p>
          <p>{t('member_import.running.count', { done: formatNumber(nextIndex), total: formatNumber(total) })}</p>
          <p>{t('member_import.running.hours', { hours: formatHours(state.balance) })}</p>
          <p className="text-muted">
            {state.secondsRemaining === null
              ? t('member_import.running.calculating')
              : t('member_import.running.remaining', { time: formatTimeLeft(state.secondsRemaining) })}
          </p>
        </div>
        <p className="text-sm text-muted">{t('member_import.running.keep_open')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" isDisabled={stopping} onPress={onStop} startContent={<Hand size={16} aria-hidden="true" />}>
          {stopping ? t('member_import.running.stopping') : t('member_import.running.stop')}
        </Button>
      </ModalFooter>
    </>
  );
}
