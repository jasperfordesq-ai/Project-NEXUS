// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The save bar that sticks to the bottom of the configuration page. Save
 * lived only in the page header, so on a long page the broker scrolled back
 * up to find it. Save is disabled while nothing has changed; Discard puts
 * the loaded values back.
 */

import { useTranslation } from 'react-i18next';
import Save from 'lucide-react/icons/save';
import Undo2 from 'lucide-react/icons/undo-2';
import { Button, Chip } from '@/components/ui';

interface ConfigurationSaveBarProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function ConfigurationSaveBar({ dirty, saving, onSave, onDiscard }: ConfigurationSaveBarProps) {
  const { t } = useTranslation('broker');

  return (
    <div
      role="region"
      aria-label={t('configuration.save_bar_aria')}
      className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-divider/70 bg-surface/95 px-4 py-3 shadow-lg shadow-black/[0.06] backdrop-blur supports-[backdrop-filter]:bg-surface/80"
    >
      <div className="min-w-0 text-sm">
        {dirty ? (
          <Chip size="sm" variant="soft" color="warning" className="shrink-0">
            {t('configuration.unsaved_changes')}
          </Chip>
        ) : (
          <span className="text-muted">{t('configuration.no_unsaved_changes')}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="tertiary"
          startContent={<Undo2 size={14} aria-hidden="true" />}
          onPress={onDiscard}
          isDisabled={!dirty || saving}
        >
          {t('configuration.discard_changes')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          startContent={<Save size={14} aria-hidden="true" />}
          onPress={onSave}
          isPending={saving}
          isDisabled={!dirty}
        >
          {t('configuration.save_changes')}
        </Button>
      </div>
    </div>
  );
}

export default ConfigurationSaveBar;
