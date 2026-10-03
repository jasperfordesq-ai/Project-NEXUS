// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerShortcutsModal — the panel's keyboard shortcuts, opened from the
 * user menu or by pressing `?` anywhere that is not a text field.
 *
 * Two shortcuts exist today (search and this list). The modifier shown for
 * search follows the broker's platform, so a Windows broker is not told to
 * press a key their keyboard does not have.
 */

import { useTranslation } from 'react-i18next';
import Keyboard from 'lucide-react/icons/keyboard';
import { Button, Kbd, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalHeading } from '@/components/ui';
import { isApplePlatform } from '../platform';

interface BrokerShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The search shortcut's keys as the broker's keyboard names them. */
export function SearchShortcutKeys() {
  const { t } = useTranslation('broker');
  if (isApplePlatform()) {
    return <Kbd>{t('header.search_shortcut')}</Kbd>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Kbd>{t('header.search_shortcut_ctrl')}</Kbd>
      <Kbd>{t('header.search_shortcut_key')}</Kbd>
    </span>
  );
}

export function BrokerShortcutsModal({ isOpen, onClose }: BrokerShortcutsModalProps) {
  const { t } = useTranslation('broker');

  const rows: { key: string; keys: React.ReactNode; label: string }[] = [
    { key: 'search', keys: <SearchShortcutKeys />, label: t('header.shortcuts_search') },
    { key: 'help', keys: <Kbd>?</Kbd>, label: t('header.shortcuts_help') },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalContent aria-label={t('header.keyboard_shortcuts')}>
        <ModalHeader className="flex items-center gap-2">
          <Keyboard size={18} className="text-accent" aria-hidden="true" />
          <ModalHeading className="text-base font-semibold">{t('header.keyboard_shortcuts')}</ModalHeading>
        </ModalHeader>
        <ModalBody>
          <dl className="divide-y divide-divider">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-sm text-foreground">{row.label}</dt>
                <dd className="shrink-0">{row.keys}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">{t('header.shortcuts_hint')}</p>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" onPress={onClose}>
            {t('header.shortcuts_close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default BrokerShortcutsModal;
