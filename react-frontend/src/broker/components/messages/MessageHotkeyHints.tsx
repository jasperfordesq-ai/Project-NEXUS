// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessageHotkeyHints — the one-line key legend shown in a toolbar on wide
 * screens, so the shortcuts are discoverable without opening the `?` sheet.
 * Hidden on narrow screens, where there is no keyboard to speak of.
 */

import { useTranslation } from 'react-i18next';
import { Kbd } from '@/components/ui';

export interface HotkeyHint {
  keys: string[];
  label: string;
}

export function MessageHotkeyHints({ hints }: { hints: HotkeyHint[] }) {
  const { t } = useTranslation('broker');
  return (
    <ul
      aria-label={t('header.keyboard_shortcuts')}
      className="hidden items-center gap-3 text-xs text-muted xl:flex"
    >
      {hints.map((hint) => (
        <li key={hint.label} className="flex items-center gap-1">
          {hint.keys.map((key) => (
            <Kbd key={key} variant="light" className="text-[11px]">
              {key}
            </Kbd>
          ))}
          <span>{hint.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default MessageHotkeyHints;
