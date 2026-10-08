// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Download from 'lucide-react/icons/download';
import { Alert, Button, ModalBody, ModalFooter } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';
import { downloadText, rowsFromIndexFile, rowsWithNumbersFile } from './csvFiles';
import { formatHours } from './format';
import { describeStop } from './issueText';
import type { CheckResult, RunnerState } from './types';

interface Props {
  state: RunnerState;
  check: CheckResult;
  onClose: () => void;
}

/** The end of a run: completed, stopped (by the server or the admin) or failed — and what to do next. */
export function ImportFinished({ state, check, onClose }: Props) {
  const { t } = useTranslation('admin_users');
  const { phase, created, total, nextIndex } = state;
  const reference = (check.import_id ?? '').slice(0, 8).toUpperCase();
  const incomplete = state.admissionIncomplete;
  const leftover = phase !== 'completed';

  // Members whose negative balance became 0 — only the ones this run actually reached.
  const reached = new Set((check.source_rows ?? []).slice(0, nextIndex).map((r) => r.row));
  const zeroedRows = (check.warnings ?? []).filter((w) => w.code === 'negative_balance_zeroed' && reached.has(w.row)).map((w) => w.row);

  const imported = t('member_import.failed.imported_so_far', { created: formatNumber(created), total: formatNumber(total) });

  let alert: { color: 'success' | 'warning' | 'danger'; title: string; description?: ReactNode };
  if (phase === 'completed') {
    alert = {
      color: 'success',
      title: t('member_import.done.title', { count: created, balance: formatHours(state.balance) }),
      description: state.held ? t('member_import.done.held') : undefined,
    };
  } else if (phase === 'stopped') {
    alert = {
      color: 'warning',
      title: t('member_import.stopped.title', { created: formatNumber(created), total: formatNumber(total) }),
      description: (
        <>
          <p>{state.stop ? describeStop(t, state.stop) : t('member_import.stopped.by_admin')}</p>
          <p>{t('member_import.stopped.next_step')}</p>
        </>
      ),
    };
  } else if (state.errorCode === 'IMPORT_NOT_FOUND' || state.errorCode === 'IMPORT_OUT_OF_ORDER') {
    alert = {
      color: 'danger',
      title: t('member_import.failed.cannot_continue'),
      description: (
        <>
          <p>{t(state.errorCode === 'IMPORT_NOT_FOUND' ? 'member_import.failed.not_found' : 'member_import.failed.out_of_order')}</p>
          <p>{imported}</p>
        </>
      ),
    };
  } else {
    alert = { color: 'danger', title: t('member_import.failed.title'), description: <><p>{t('member_import.failed.body')}</p><p>{imported}</p></> };
  }

  return (
    <>
      <ModalBody className="flex flex-col gap-4">
        <Alert color={alert.color} title={alert.title} description={alert.description} />

        {incomplete > 0 && (
          <Alert
            color="warning"
            description={t('member_import.done.admission_incomplete', { count: incomplete, rows: state.admissionIncompleteRows.join(', ') })}
          />
        )}

        <div className="flex flex-wrap gap-2">
          {leftover && (
            <Button
              variant="secondary"
              startContent={<Download size={16} aria-hidden="true" />}
              onPress={() => downloadText(rowsFromIndexFile(check, nextIndex), 'member_import_not_imported.csv')}
            >
              {t('member_import.stopped.download_remaining')}
            </Button>
          )}
          {state.zeroed > 0 && (
            <Button
              variant="secondary"
              startContent={<Download size={16} aria-hidden="true" />}
              onPress={() => downloadText(rowsWithNumbersFile(check, zeroedRows, t('member_import.problems.row')), 'member_import_zeroed_balances.csv')}
            >
              {t('member_import.done.download_zeroed')}
            </Button>
          )}
        </div>

        {reference && <p className="text-xs text-muted">{t('member_import.done.reference', { ref: reference })}</p>}
      </ModalBody>
      <ModalFooter>
        <Button onPress={onClose}>{t('member_import.close')}</Button>
      </ModalFooter>
    </>
  );
}
