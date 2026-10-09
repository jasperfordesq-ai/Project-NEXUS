// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Download from 'lucide-react/icons/download';
import { Alert, Button, ModalBody, ModalFooter } from '@/components/ui';
import { adminMemberImport } from '@/admin/api/adminApi';
import { formatNumber } from '@/lib/helpers';
import { downloadText, rowsFromIndexFile, rowsWithNumbersFile } from './csvFiles';
import { aboutMinutes, formatHours } from './format';
import { describeStop } from './issueText';
import { useFocusOnMount } from './useFocusOnMount';
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
  // Rows the run never reached. For a checked file every row became a held row, in order.
  const remaining = Math.max(0, (check.source_rows ?? []).length - nextIndex);
  const lead = useFocusOnMount<HTMLDivElement>();

  // Taking the import back: ask once, then say what happened.
  const [undoStep, setUndoStep] = useState<'idle' | 'confirm' | 'working' | 'done'>('idle');
  const [undoResult, setUndoResult] = useState<{ color: 'success' | 'danger'; text: string } | null>(null);
  const [undoRemoved, setUndoRemoved] = useState(0);
  // The server removes members for about 8 s per call and says whether any are left; keep
  // calling until it is done. `removed` adds up across calls; `kept` is complete on the last.
  const undoImport = async () => {
    if (!check.import_id) return;
    setUndoStep('working');
    let removedSoFar = 0;
    for (;;) {
      const response = await adminMemberImport.undo(check.import_id);
      if (!response?.success || !response.data) {
        setUndoResult({ color: 'danger', text: t(response?.code === 'IMPORT_BUSY' ? 'member_import.undo.busy' : 'member_import.undo.failed') });
        setUndoStep('idle');
        return;
      }
      removedSoFar += response.data.removed;
      setUndoRemoved(removedSoFar);
      if (response.data.done) {
        const kept = Object.values(response.data.kept).reduce((sum, n) => sum + n, 0);
        setUndoResult({ color: 'success', text: t('member_import.undo.done', { removed: formatNumber(removedSoFar), kept: formatNumber(kept) }) });
        setUndoStep('done');
        return;
      }
    }
  };

  // Members whose negative balance became 0 — only the ones this run actually reached.
  const reached = new Set((check.source_rows ?? []).slice(0, nextIndex).map((r) => r.row));
  const zeroedRows = (check.warnings ?? []).filter((w) => w.code === 'negative_balance_zeroed' && reached.has(w.row)).map((w) => w.row);

  const queued = state.invitationsQueued;
  const invitations = queued > 0
    ? t('member_import.done.invitations_queued', {
      count: queued,
      countFormatted: formatNumber(queued),
      duration: aboutMinutes(t, Math.max(1, state.invitationsEtaMinutes)),
    })
    : t('member_import.done.no_invitations');

  const imported = t('member_import.failed.imported_so_far', { created: formatNumber(created), total: formatNumber(total) });

  let alert: { color: 'success' | 'warning' | 'danger'; title: string; description?: ReactNode };
  if (phase === 'completed') {
    alert = {
      color: 'success',
      title: t('member_import.done.title', { count: created, countFormatted: formatNumber(created), balance: formatHours(state.balance) }),
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
    const reason = state.errorCode === 'IMPORT_NOT_FOUND' ? 'member_import.failed.not_found' : 'member_import.failed.out_of_order';
    alert = {
      color: 'danger',
      title: t('member_import.failed.cannot_continue'),
      description: (
        <>
          <p>{t(reason)}</p>
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
        <div ref={lead} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          <Alert
            color={alert.color}
            role={alert.color === 'success' ? 'status' : 'alert'}
            title={alert.title}
            description={alert.description}
          />

          {incomplete > 0 && (
            <Alert
              color="warning"
              role="alert"
              description={t('member_import.done.admission_incomplete', {
                count: incomplete,
                countFormatted: formatNumber(incomplete),
                rows: state.admissionIncompleteRows.map((row) => formatNumber(row)).join(', '),
              })}
            />
          )}

          <p className="text-sm">{invitations}</p>

          {undoStep === 'working' && (
            <Alert color="default" role="status" description={t('member_import.undo.working', { removed: formatNumber(undoRemoved) })} />
          )}
          {undoResult && <Alert color={undoResult.color} role={undoResult.color === 'success' ? 'status' : 'alert'} description={undoResult.text} />}
          {undoStep === 'confirm' && (
            <Alert
              color="warning"
              role="alert"
              description={(
                <div className="flex flex-col gap-2">
                  <p>{t('member_import.undo.confirm')}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" onPress={undoImport}>{t('member_import.undo.confirm_yes')}</Button>
                    <Button variant="secondary" onPress={() => setUndoStep('idle')}>{t('member_import.undo.confirm_no')}</Button>
                  </div>
                </div>
              )}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {created > 0 && undoStep === 'idle' && check.import_id && (
            <Button variant="secondary" onPress={() => setUndoStep('confirm')}>{t('member_import.undo.button')}</Button>
          )}
          {leftover && remaining > 0 && (
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

        {leftover && remaining === 0 && <p className="text-sm text-muted">{t('member_import.stopped.all_processed')}</p>}

        {reference && <p className="text-xs text-muted">{t('member_import.done.reference', { ref: reference })}</p>}
      </ModalBody>
      <ModalFooter>
        <Button onPress={onClose}>{t('member_import.close')}</Button>
      </ModalFooter>
    </>
  );
}
