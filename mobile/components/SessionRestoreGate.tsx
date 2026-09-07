// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What the app shows when it holds a stored session it could not check.
 *
 * 🔴 Audit 2026-09-06, F09. On launch the app validates a stored token against
 * `/users/me`. If the server REFUSES it, the session is over and the member goes to the
 * login screen. If the server cannot be REACHED, nothing has been proven — and the member
 * must not be sent to a login form, because with no connection they cannot use one either.
 * They are shown this instead: what happened, a retry, and signing out only if they choose
 * it. `AuthContext` keeps the credentials on the device meanwhile.
 *
 * Blocking on purpose. The alternative — letting the app render signed-out underneath —
 * is what produced the original report: a member who appeared to have been logged out
 * overnight, with no explanation and nothing to press.
 */

import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import { useAuthContext } from '@/lib/context/AuthContext';

export default function SessionRestoreGate({ children }: { children: React.ReactNode }) {
  const { sessionRestoreFailed, retrySessionRestore, logout } = useAuthContext();
  const { t } = useTranslation(['common']);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = useCallback(() => {
    setIsRetrying(true);
    void Promise.resolve(retrySessionRestore()).finally(() => setIsRetrying(false));
  }, [retrySessionRestore]);

  const handleSignOut = useCallback(() => {
    void logout();
  }, [logout]);

  if (!sessionRestoreFailed) return <>{children}</>;

  return (
    <View className="flex-1 items-center justify-center bg-background" testID="session-restore-failed">
      {/*
        Both actions are rendered here rather than through `ErrorState`'s single retry
        slot, so each carries its own testID and the sign-out sits visibly second.
      */}
      <ErrorState
        icon="cloud-offline-outline"
        title={t('common:sessionRestore.title')}
        subtitle={t('common:sessionRestore.subtitle')}
      />
      <View className="w-full items-center gap-3 px-8">
        <Button
          fullWidth
          onPress={handleRetry}
          isLoading={isRetrying}
          disabled={isRetrying}
          testID="session-restore-retry"
        >
          {t('common:sessionRestore.retry')}
        </Button>
        <Button variant="ghost" fullWidth onPress={handleSignOut} testID="session-restore-sign-out">
          {t('common:sessionRestore.signOut')}
        </Button>
      </View>
    </View>
  );
}
