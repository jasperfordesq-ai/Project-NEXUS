// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Set a password" — for a member whose account has none (F-611, E-121).
 *
 * A member who joined with Google (or another provider) has no password, so
 * nothing that asks "confirm it's you" with a password can work for them:
 * turning two-factor on or off, adding a passkey, linking another account,
 * changing the password or deleting the account. Owner decision (6 Nov 2026):
 * they add a password first. This sends the existing password-reset email to
 * the member's own address; using the link sets the password (and, as every
 * reset does, signs them out everywhere).
 *
 * Shown wherever a password would otherwise be asked for. Never shown where a
 * password would not help — the staff step-up check needs a second factor.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import KeyRound from 'lucide-react/icons/key-round';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface SetPasswordPromptProps {
  /** First sentence: why this needs a password. Defaults to a general one. */
  reason?: string;
}

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

export function SetPasswordPrompt({ reason }: SetPasswordPromptProps) {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const [state, setState] = useState<SendState>('idle');

  const send = async () => {
    const email = user?.email;
    if (!email) {
      setState('failed');
      return;
    }
    setState('sending');
    try {
      // Public and enumeration-safe; the server sends the link only to an
      // address it holds for this community, so a signed-in member can only
      // ever send it to themselves.
      const response = await api.post('/auth/forgot-password', { email });
      setState(response.success ? 'sent' : 'failed');
    } catch (error) {
      logError('Failed to send the set-a-password email', error);
      setState('failed');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-theme-subtle">
      <p>{reason ?? t('set_password_no_password')}</p>
      <p>{t('set_password_why')}</p>
      {state === 'sent' ? (
        <p role="status" className="font-medium text-theme-primary">{t('set_password_sent')}</p>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          startContent={<KeyRound className="w-4 h-4" aria-hidden="true" />}
          onPress={() => { void send(); }}
          isLoading={state === 'sending'}
        >
          {t('set_password_action')}
        </Button>
      )}
      {state === 'failed' && (
        <p role="alert" className="text-danger">{t('set_password_failed')}</p>
      )}
    </div>
  );
}

export default SetPasswordPrompt;
