// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Download from 'lucide-react/icons/download';
import Undo2 from 'lucide-react/icons/undo-2';
import { Alert, Button, ModalBody, ModalFooter } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';
import { correctedFile, downloadText, problemsFile } from './csvFiles';
import { useFocusOnMount } from './useFocusOnMount';
import { describeColumn, describeFileError, describeIssue } from './issueText';
import type { CheckResult } from './types';

/** How many problems the window lists; the downloadable file always has all of them. */
const SHOWN_PROBLEMS = 200;

interface FileErrorProps {
  error: NonNullable<CheckResult['file_error']> | undefined;
  onDownloadTemplate: () => void;
  onChooseAnother: () => void;
}

/** The whole file was refused: say why, show the fix, and offer the right template. */
export function ImportFileError({ error, onDownloadTemplate, onChooseAnother }: FileErrorProps) {
  const { t } = useTranslation('admin_users');
  const { title, body } = describeFileError(t, error?.code ?? 'unknown', error?.params ?? {});
  const lead = useFocusOnMount<HTMLDivElement>();

  return (
    <>
      <ModalBody className="flex flex-col gap-4">
        <div ref={lead} tabIndex={-1} className="outline-none">
          <Alert color="danger" role="alert" title={title} description={body} />
        </div>
        <section aria-labelledby="member-import-fix">
          <h3 id="member-import-fix" className="mb-1 text-sm font-semibold">{t('member_import.fix.title')}</h3>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
            {(['step1', 'step2', 'step3', 'step4'] as const).map((step) => (
              <li key={step}>{t(`member_import.fix.${step}`)}</li>
            ))}
          </ol>
        </section>
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" onPress={onChooseAnother}>{t('member_import.choose_another')}</Button>
        <Button onPress={onDownloadTemplate} startContent={<Download size={16} aria-hidden="true" />}>
          {t('member_import.download_correct_template')}
        </Button>
      </ModalFooter>
    </>
  );
}

interface ProblemsProps {
  check: CheckResult;
  onChooseAnother: () => void;
}

/** Row problems: nothing was imported. A scrollable list, and downloads that make fixing easy. */
export function ImportProblemList({ check, onChooseAnother }: ProblemsProps) {
  const { t } = useTranslation('admin_users');
  const problems = check.problems ?? [];
  const existing = check.existing_member_rows ?? [];
  // Row 0 means "the whole file", not a row of its own.
  const rowCount = new Set(problems.filter((p) => p.row > 0).map((p) => p.row)).size;
  const hiddenCount = Math.max(0, problems.length - SHOWN_PROBLEMS);
  const lead = useFocusOnMount<HTMLDivElement>();
  const rowText = (row: number) => (row === 0 ? t('member_import.problems.whole_file') : String(row));

  const downloadList = () => downloadText(
    problemsFile(
      check,
      { row: t('member_import.problems.row'), column: t('member_import.problems.column'), problem: t('member_import.problems.problem') },
      (issue) => describeIssue(t, issue),
      (column) => describeColumn(t, column),
      rowText,
    ),
    'member_import_problems.csv',
  );
  const downloadCorrected = () => downloadText(correctedFile(check, existing), 'member_import_corrected.csv');

  return (
    <>
      <ModalBody className="flex flex-col gap-4">
        <div ref={lead} tabIndex={-1} className="outline-none">
          <Alert
            color="danger"
            role="alert"
            title={t('member_import.problems.title')}
            description={rowCount > 0
              ? t('member_import.problems.body', { problems: formatNumber(problems.length), rows: formatNumber(rowCount) })
              : t('member_import.problems.body_file', { problems: formatNumber(problems.length) })}
          />
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-start text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('member_import.problems.row')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('member_import.problems.column')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('member_import.problems.problem')}</th>
              </tr>
            </thead>
            <tbody>
              {problems.slice(0, SHOWN_PROBLEMS).map((problem, index) => (
                // The same row can have several problems, so the position is part of the key.
                <tr key={`${problem.row}-${index}`} className="border-t border-border align-top">
                  <td className="px-3 py-2 tabular-nums">
                    {rowText(problem.row)}
                  </td>
                  <td className="px-3 py-2">{describeColumn(t, problem.column)}</td>
                  <td className="px-3 py-2">{describeIssue(t, problem)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hiddenCount > 0 && <p className="text-sm text-muted">{t('member_import.problems.more', { more: formatNumber(hiddenCount) })}</p>}

        {existing.length > 0 && problems.length > existing.length && (
          <p className="text-sm text-muted">{t('member_import.problems.corrected_note')}</p>
        )}
      </ModalBody>
      <ModalFooter className="flex-wrap">
        <Button variant="tertiary" onPress={onChooseAnother}>{t('member_import.choose_another')}</Button>
        {existing.length > 0 && (
          <Button variant="secondary" onPress={downloadCorrected} startContent={<Undo2 size={16} aria-hidden="true" />}>
            {t('member_import.problems.download_corrected')}
          </Button>
        )}
        <Button onPress={downloadList} startContent={<Download size={16} aria-hidden="true" />}>
          {t('member_import.problems.download_list')}
        </Button>
      </ModalFooter>
    </>
  );
}
