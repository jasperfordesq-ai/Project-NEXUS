// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import { Button, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui';

/**
 * Activates the tenant-configurable inactivity auto-logout for the
 * authenticated session, and shows its warning. Must be mounted inside
 * TenantProvider and AuthProvider (see TenantShell).
 *
 * E-119 F-608: the warning is new. Members used to be signed out with no
 * notice; public-sector accessibility (WCAG 2.2.1, as the GOV.UK/DWP session
 * timeout pattern applies it) needs a warning and a way to stay signed in.
 */
export function IdleLogoutGuard() {
  const { t } = useTranslation('errors');
  const { warningOpen, secondsLeft, staySignedIn, signOutNow } = useIdleLogout();

  if (!warningOpen) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <Modal
      isOpen
      onClose={staySignedIn}
      size="sm"
      classNames={{ base: 'bg-overlay border border-theme-default' }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col items-center gap-0 pt-6 pb-2">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-amber-500/20 p-4">
              <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </div>
          </div>
          <ModalHeading id="idle-warning-title" className="text-xl font-semibold text-theme-primary">
            {t('idle_warning_title')}
          </ModalHeading>
        </ModalHeader>
        <ModalBody id="idle-warning-description" className="pb-4 text-center">
          {/* Announced once when the warning opens, not every second. */}
          <p className="text-theme-muted">
            {t('idle_warning_message', { minutes, seconds: String(seconds).padStart(2, '0') })}
          </p>
        </ModalBody>
        <ModalFooter className="gap-3">
          <Button variant="tertiary" onPress={signOutNow}>
            {t('idle_warning_sign_out')}
          </Button>
          <Button variant="primary" onPress={staySignedIn} autoFocus>
            {t('idle_warning_stay')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
