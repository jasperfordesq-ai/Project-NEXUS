// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { ModalBody, Spinner } from '@/components/ui';
import { useFocusOnMount } from './useFocusOnMount';

/** Shown while the server checks the file. */
export function ImportChecking() {
  const { t } = useTranslation('admin_users');
  const lead = useFocusOnMount<HTMLDivElement>();
  return (
    <ModalBody>
      <div ref={lead} tabIndex={-1} role="status" className="flex items-center gap-3 py-6 outline-none">
        <Spinner size="md" />
        <span>{t('member_import.checking')}</span>
      </div>
    </ModalBody>
  );
}
