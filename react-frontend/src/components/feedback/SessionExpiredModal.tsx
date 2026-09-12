// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Session Expired Modal
 * Displays when the user's session has expired and they need to log in again
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LogIn from 'lucide-react/icons/log-in';
import Clock from 'lucide-react/icons/clock';
import { SESSION_EXPIRED_EVENT, type SessionEndReason, type SessionExpiredDetail } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui';

export function SessionExpiredModal() {
  const { t } = useTranslation('errors');
  const [isOpen, setIsOpen] = useState(false);
  // Why the session ended. 'mfa_required' means the server refused a live session
  // because the account now needs a second factor — the member is told that, not
  // "your session has expired" (mandatory administrator two-factor, 12 Sept 2026).
  const [reason, setReason] = useState<SessionEndReason>('expired');
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { status } = useAuth();
  const wasAuthenticated = useRef(false);

  // Track if user was ever authenticated in this session
  useEffect(() => {
    if (status === 'authenticated') {
      wasAuthenticated.current = true;
    }
  }, [status]);

  useEffect(() => {
    function handleSessionExpired(event: Event) {
      // Only show modal if user had an active session — not for stale tokens on first visit
      if (wasAuthenticated.current) {
        setReason((event as CustomEvent<SessionExpiredDetail>).detail?.reason ?? 'expired');
        setIsOpen(true);
      }
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  function handleLogin() {
    setIsOpen(false);
    navigate(tenantPath('/login'));
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      size="sm"
      classNames={{
        base: 'bg-overlay border border-theme-default',
      }}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader
              className="flex flex-col items-center gap-0 pt-6 pb-2"
            >
              {/* Icon */}
              <div className="flex justify-center mb-4">
                <div className="p-4 rounded-full bg-amber-500/20">
                  <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <ModalHeading
                id="session-expired-title"
                className="text-xl font-semibold text-theme-primary"
              >
                {t(reason === 'mfa_required' ? 'session_mfa_required' : 'session_expired')}
              </ModalHeading>
            </ModalHeader>

            <ModalBody
              id="session-expired-description"
              className="text-center pb-4"
            >
              <p className="text-theme-muted">
                {t(reason === 'mfa_required' ? 'session_mfa_required_message' : 'session_expired_message')}
              </p>
            </ModalBody>

            <ModalFooter className="gap-3">
              <Button
                variant="flat"
                className="flex-1 bg-theme-elevated text-theme-primary"
                onPress={onClose}
              >
                {t('dismiss')}
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<LogIn className="w-4 h-4" />}
                onPress={handleLogin}
              >
                {t('auth.log_in', { ns: 'common' })}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SessionExpiredModal;
