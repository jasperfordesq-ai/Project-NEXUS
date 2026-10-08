// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Upload from 'lucide-react/icons/upload';
import { Alert, Button, Checkbox, ModalBody, ModalFooter } from '@/components/ui';
import { formatNumber } from '@/lib/helpers';
import { formatHours } from './format';
import { describeWarning } from './issueText';
import { useFocusOnMount } from './useFocusOnMount';
import type { CheckResult } from './types';

interface Props {
  check: CheckResult;
  identityChecked: boolean;
  onIdentityChange: (checked: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
}

/** Every row passed: what is about to happen, and the one decision the admin owns (identity). */
export function ImportReady({ check, identityChecked, onIdentityChange, onImport, onCancel }: Props) {
  const { t } = useTranslation('admin_users');
  const summary = check.summary;
  const rows = summary?.rows ?? 0;
  const warnings = check.warnings ?? [];
  const lead = useFocusOnMount<HTMLDivElement>();

  const lines: string[] = summary ? [
    t('member_import.ready.members', { n: formatNumber(summary.rows) }),
    t('member_import.ready.hours', { hours: formatHours(summary.total_balance) }),
    t('member_import.ready.with_town', { n: formatNumber(summary.with_location) }),
    ...(summary.without_location > 0 ? [t('member_import.ready.without_town', { n: formatNumber(summary.without_location) })] : []),
    ...(summary.blank_rows_ignored > 0 ? [t('member_import.ready.blank_rows', { n: formatNumber(summary.blank_rows_ignored) })] : []),
  ] : [];

  return (
    <>
      <ModalBody className="flex flex-col gap-4">
        <div ref={lead} tabIndex={-1} className="outline-none">
          <Alert color="success" role="status" title={t('member_import.ready.title')} />
        </div>

        <ul className="space-y-1 text-sm">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>

        {summary && summary.negative_count > 0 && (
          <details className="rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">
              {t('member_import.ready.negatives', { n: formatNumber(summary.negative_count) })}
            </summary>
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-muted">
              {warnings.map((warning) => (
                <li key={`${warning.row}-${warning.code}`}>{describeWarning(t, warning)}</li>
              ))}
            </ul>
          </details>
        )}

        {check.admission?.requires_identity_check && (
          <Checkbox
            isSelected={identityChecked}
            onChange={onIdentityChange}
            description={t('member_import.ready.identity_help')}
          >
            {t('member_import.ready.identity_attest')}
          </Checkbox>
        )}

        <p className="text-sm text-muted">{t('member_import.ready.no_emails_yet')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" onPress={onCancel}>{t('member_import.cancel')}</Button>
        <Button onPress={onImport} startContent={<Upload size={16} aria-hidden="true" />}>
          {t('member_import.ready.import', { count: rows, countFormatted: formatNumber(rows) })}
        </Button>
      </ModalFooter>
    </>
  );
}
