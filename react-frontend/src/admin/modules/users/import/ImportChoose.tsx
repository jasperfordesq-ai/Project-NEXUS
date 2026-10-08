// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import Download from 'lucide-react/icons/download';
import FileCheck from 'lucide-react/icons/file-check';
import { Alert, Button, ModalBody, ModalFooter } from '@/components/ui';
import { useFocusOnMount } from './useFocusOnMount';
import type { ImportColumn } from './types';

const COLUMNS: ImportColumn[] = ['first_name', 'last_name', 'email', 'phone', 'location', 'balance'];

export type CheckFailure = 'check_failed' | 'check_rate_limited';

interface Props {
  file: File | null;
  /** Why the last check could not run; shown at the top and announced. */
  checkFailure: CheckFailure | null;
  onFile: (file: File | null) => void;
  onCheck: () => void;
  onDownloadTemplate: () => void;
  onCancel: () => void;
}

/** First screen: what the file must look like, the template, and the file picker. */
export function ImportChoose({ file, checkFailure, onFile, onCheck, onDownloadTemplate, onCancel }: Props) {
  const { t } = useTranslation('admin_users');
  const lead = useFocusOnMount<HTMLDivElement>();

  return (
    <>
      <ModalBody className="flex flex-col gap-5">
        <div ref={lead} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          {checkFailure && <Alert color="danger" role="alert" description={t(`member_import.${checkFailure}`)} />}
          <p className="text-sm text-muted">{t('member_import.intro')}</p>
        </div>

        <section aria-labelledby="member-import-columns" className="flex flex-col gap-2">
          <h3 id="member-import-columns" className="text-sm font-semibold">{t('member_import.columns_title')}</h3>
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
            {COLUMNS.map((column) => (
              <Fragment key={column}>
                <dt className="font-medium">{t(`member_import.columns.${column}.label`)}</dt>
                <dd className="mb-2 text-muted sm:mb-0">{t(`member_import.columns.${column}.rule`)}</dd>
              </Fragment>
            ))}
          </dl>
          <div>
            <Button size="sm" variant="tertiary" startContent={<Download size={14} aria-hidden="true" />} onPress={onDownloadTemplate}>
              {t('member_import.download_template')}
            </Button>
          </div>
        </section>

        <div>
          <label htmlFor="member-import-file" className="mb-1 block text-sm font-medium">
            {t('member_import.choose_file')}
          </label>
          <input
            id="member-import-file"
            type="file"
            accept=".csv,text/csv"
            aria-describedby="member-import-file-hint"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted file:me-4 file:rounded-lg file:border-0 file:bg-accent-soft file:px-4 file:py-2 file:text-sm file:font-semibold file:text-accent"
          />
          {file && <p className="mt-2 text-sm font-medium">{t('member_import.chosen_file', { name: file.name })}</p>}
          <p id="member-import-file-hint" className="mt-1 text-xs text-muted">{t('member_import.file_hint')}</p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" onPress={onCancel}>{t('member_import.cancel')}</Button>
        <Button isDisabled={!file} onPress={onCheck} startContent={<FileCheck size={16} aria-hidden="true" />}>
          {t('member_import.check_file')}
        </Button>
      </ModalFooter>
    </>
  );
}
