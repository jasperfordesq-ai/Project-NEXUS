// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Sticky bottom save bar for long admin forms. Shows whether anything is
 * unsaved, disables Save until something is, and offers Discard. Mirrors the
 * broker panel's ConfigurationSaveBar but reads the admin_system catalogue
 * and takes a slot for secondary actions (a "more" menu, a reload button).
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Save from 'lucide-react/icons/save';
import Undo2 from 'lucide-react/icons/undo-2';
import AlertCircle from 'lucide-react/icons/alert-circle';
import { Button, Chip } from '@/components/ui';

export interface AdminSaveBarProps {
  dirty: boolean;
  saving: boolean;
  /** A validation problem that must be fixed before Save is allowed. */
  blockedReason?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  /** Rendered between the status and the Discard/Save pair (e.g. a more-menu). */
  secondaryActions?: ReactNode;
  /** Shown as the Save label; defaults to "Save changes". */
  saveLabel?: string;
}

export function AdminSaveBar({
  dirty,
  saving,
  blockedReason = null,
  onSave,
  onDiscard,
  secondaryActions,
  saveLabel,
}: AdminSaveBarProps) {
  const { t } = useTranslation('admin_system');

  return (
    <div
      role="region"
      aria-label={t('admin_settings.save_bar_aria')}
      className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-divider/70 bg-surface/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur supports-[backdrop-filter]:bg-surface/80"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {dirty ? (
          <Chip size="sm" variant="soft" color="warning" className="shrink-0">
            {t('admin_settings.unsaved_changes')}
          </Chip>
        ) : (
          <span className="text-muted">{t('admin_settings.no_unsaved_changes')}</span>
        )}
        {blockedReason && (
          <span className="flex items-center gap-1 text-danger">
            <AlertCircle size={14} aria-hidden="true" />
            {blockedReason}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {secondaryActions}
        <Button
          size="sm"
          variant="tertiary"
          startContent={<Undo2 size={14} aria-hidden="true" />}
          onPress={onDiscard}
          isDisabled={!dirty || saving}
        >
          {t('admin_settings.discard_changes')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          startContent={<Save size={14} aria-hidden="true" />}
          onPress={onSave}
          isPending={saving}
          isDisabled={!dirty || blockedReason !== null}
        >
          {saveLabel ?? t('admin_settings.save_all_changes')}
        </Button>
      </div>
    </div>
  );
}

export default AdminSaveBar;
