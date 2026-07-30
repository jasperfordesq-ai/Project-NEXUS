// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Confirmation Modal for Dangerous Actions
 * Used before delete, ban, suspend, and other destructive operations
 */

import { useRef } from 'react';

import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';

type ConfirmColor = 'danger' | 'warning' | 'primary';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  /**
   * Label for the Cancel button. Pass a translated string from the
   * caller's i18n namespace — the broker panel uses `t('common.cancel')`.
   * Defaults to "Cancel" for backward compatibility with existing admin
   * call sites.
   */
  cancelLabel?: string;
  confirmColor?: ConfirmColor;
  isLoading?: boolean;
  children?: React.ReactNode;
}

function confirmVariant(confirmColor: ConfirmColor) {
  switch (confirmColor) {
    case 'danger':
      return 'danger' as const;
    case 'warning':
      return 'secondary' as const;
    case 'primary':
    default:
      return 'primary' as const;
  }
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmColor = 'danger',
  isLoading = false,
  children,
}: ConfirmModalProps) {
  const { t } = useTranslation('common');
  const resolvedConfirmLabel = confirmLabel ?? t('confirm');
  const resolvedCancelLabel = cancelLabel ?? t('cancel');
  // Synchronous double-click gate. `isLoading` becomes true after the parent
  // re-renders; in the microsecond window between the two clicks, the second
  // press still fires onConfirm. The ref blocks re-entry within the same
  // render tick. Reset whenever the modal closes.
  const inFlightRef = useRef(false);
  if (!isOpen && inFlightRef.current) {
    inFlightRef.current = false;
  }
  const handleConfirm = () => {
    if (inFlightRef.current || isLoading) return;
    inFlightRef.current = true;
    onConfirm();
  };
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        inFlightRef.current = false;
        onClose();
      }}
      size="sm"
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-warning" aria-hidden="true" />
          {title}
        </ModalHeader>
        <ModalBody>
          <p className="text-muted">{message}</p>
          {children}
        </ModalBody>
        {/*
          The two action buttons carry stable test ids. Call sites routinely
          override `confirmLabel` with their own wording (this modal's default
          is "Confirm", but e.g. the GDPR consent-type page passes "Delete"), so
          a test that located the confirm button by its text was really asserting
          one particular translation. When the label stopped being "Confirm" the
          lookup silently returned undefined and the click never happened —
          which is how two delete tests sat quarantined as a "dialog race".
          Target these ids, not the label.
        */}
        <ModalFooter>
          <Button
            autoFocus
            variant="tertiary"
            onPress={onClose}
            isDisabled={isLoading}
            data-testid="confirm-modal-cancel"
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={confirmVariant(confirmColor)}
            onPress={handleConfirm}
            isLoading={isLoading}
            isDisabled={isLoading || inFlightRef.current}
            data-testid="confirm-modal-confirm"
          >
            {resolvedConfirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ConfirmModal;
