// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Hand from 'lucide-react/icons/hand';
import type { ReactNode } from 'react';
import { Button, ModalBody, ModalFooter, Progress } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';
import { formatHours, formatTimeLeft } from './format';
import { useFocusOnMount } from './useFocusOnMount';
import type { RunnerState } from './types';

interface Props {
  state: RunnerState;
  onStop: () => void;
}

/** One statistic: a small heading, a large tabular figure and an optional note under it. */
function Tile({ label, figure, note }: { label: string; figure: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-secondary p-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="truncate text-2xl font-semibold tabular-nums">{figure}</dd>
      {note && <dd className="text-xs text-muted">{note}</dd>}
    </div>
  );
}

/**
 * While the import runs: a large percentage, a thick growing bar and four figures in tiles.
 * The window cannot be closed here.
 */
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
      <ModalBody className="flex flex-col gap-5">
        <div ref={lead} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          <p className="text-5xl font-semibold leading-none tabular-nums" aria-hidden="true">
            {formatNumber(percent / 100, { style: 'percent', maximumFractionDigits: 0 })}
          </p>
          <Progress aria-label={t('member_import.running.progress_label')} value={percent} size="lg" />
        </div>
        <span aria-live="polite" className="sr-only">{announcement}</span>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={t('member_import.running.tile_members')}
            figure={formatNumber(nextIndex)}
            note={t('member_import.running.tile_of_total', { total: formatNumber(total) })}
          />
          <Tile label={t('member_import.running.tile_hours')} figure={formatHours(state.balance)} />
          <Tile
            label={t('member_import.running.tile_batch')}
            figure={formatNumber(current)}
            note={t('member_import.running.tile_of_about', { m: formatNumber(estimate) })}
          />
          <Tile
            label={t('member_import.running.tile_time_left')}
            figure={state.secondsRemaining === null ? '—' : formatTimeLeft(state.secondsRemaining)}
            note={state.secondsRemaining === null ? t('member_import.running.calculating') : undefined}
          />
        </dl>
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
