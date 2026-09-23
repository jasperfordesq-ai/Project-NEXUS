// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Connected Accounts Tab (SOC13)
 *
 * Lists vetted Google / Facebook identities currently linked to the user.
 * Allows connecting new providers (initiates OAuth link flow) and disconnecting
 * existing ones (refuses if it would remove the user's only auth method —
 * backend returns 422 in that case).
 *
 * Linking adds a permanent sign-in method, so the server requires a fresh
 * security confirmation (F-056): `POST /webauthn/security-confirm` is tried
 * silently first (it succeeds shortly after a strong sign-in), and otherwise
 * the user confirms with their password, authenticator code or backup code.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { FacebookIcon } from '@/components/icons/FacebookIcon';
import {
  SecurityConfirmationModal,
  buildSecurityConfirmationInput,
  defaultSecurityConfirmationMethod,
  type SecurityConfirmationMethod,
  type SecurityConfirmationMethods,
} from '@/components/security/SecurityConfirmationModal';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { confirmWebAuthnSecurity, getWebAuthnStatus } from '@/lib/webauthn';
import {
  clearOAuthBrowserVerifier,
  createOAuthBrowserBinding,
} from '@/lib/oauth-browser-binding';

type Provider = 'google' | 'facebook';

interface OauthIdentity {
  provider: Provider;
  provider_email: string | null;
  avatar_url: string | null;
  linked_at: string;
  last_used_at: string | null;
}

interface IdentitiesResponse {
  identities: OauthIdentity[];
  enabled_providers: Provider[];
  supported_providers: Provider[];
}

interface CachedSecurityConfirmation {
  token: string;
  expiresAt: number;
}

const SECURITY_CONFIRMATION_REQUIRED = 'SECURITY_CONFIRMATION_REQUIRED';

const PROVIDER_META: Record<Provider, { Icon: typeof GoogleIcon; providerLabelKey: string }> = {
  google: { Icon: GoogleIcon, providerLabelKey: 'oauth.provider_google' },
  facebook: { Icon: FacebookIcon, providerLabelKey: 'oauth.provider_facebook' },
};

export function ConnectedAccountsTab() {
  const { t } = useTranslation(['common', 'settings']);
  const toast = useToast();
  const [data, setData] = useState<IdentitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);

  // Step-up security confirmation state (mirrors BiometricSettings).
  const [confirmationMethods, setConfirmationMethods] = useState<SecurityConfirmationMethods>({
    password: true,
    totp: false,
  });
  const [confirmationMethod, setConfirmationMethod] = useState<SecurityConfirmationMethod>('password');
  const [confirmationValue, setConfirmationValue] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmingSecurity, setConfirmingSecurity] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const securityConfirmationRef = useRef<CachedSecurityConfirmation | null>(null);
  const recentSessionCheckedRef = useRef(false);
  const methodsLoadedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<IdentitiesResponse>('/v2/auth/oauth/me/identities');
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      logError('[ConnectedAccountsTab] Failed to load identities', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => {
    securityConfirmationRef.current = null;
  }, []);

  const cacheSecurityConfirmation = (token: string, expiresIn: number) => {
    securityConfirmationRef.current = {
      token,
      expiresAt: Date.now() + Math.max(1, expiresIn) * 1000,
    };
  };

  const getCachedSecurityConfirmation = (): string | null => {
    const cached = securityConfirmationRef.current;
    if (!cached || cached.expiresAt <= Date.now() + 5_000) {
      securityConfirmationRef.current = null;
      return null;
    }
    return cached.token;
  };

  const loadConfirmationMethods = async (): Promise<SecurityConfirmationMethods> => {
    if (methodsLoadedRef.current) return confirmationMethods;
    try {
      const status = await getWebAuthnStatus();
      const methods = status.confirmation_methods;
      if (methods) {
        const available: SecurityConfirmationMethods = {
          password: methods.password === true,
          passkey: methods.passkey === true,
          totp: methods.totp === true,
        };
        methodsLoadedRef.current = true;
        setConfirmationMethods(available);
        return available;
      }
    } catch (err) {
      logError('[ConnectedAccountsTab] Failed to load confirmation methods', err);
    }
    return confirmationMethods;
  };

  const resetConfirmation = () => {
    setPendingProvider(null);
    setConfirmationValue('');
    setConfirmationError(null);
  };

  const openSecurityConfirmation = async (provider: Provider, error?: string) => {
    const methods = await loadConfirmationMethods();
    setConfirmationMethod(defaultSecurityConfirmationMethod(methods));
    setConfirmationValue('');
    setConfirmationError(error ?? null);
    setPendingProvider(provider);
  };

  /** Returns true when the browser is being redirected to the provider. */
  const performLink = async (provider: Provider, securityToken: string): Promise<boolean> => {
    let challenge: string | null = null;
    try {
      ({ challenge } = await createOAuthBrowserBinding());
      const res = await api.post<{ redirect_url: string }>(
        `/v2/auth/oauth/${provider}/link`,
        { browser_challenge: challenge, security_confirmation_token: securityToken },
      );
      if (res.success && res.data?.redirect_url) {
        window.location.href = res.data.redirect_url;
        return true;
      }
      clearOAuthBrowserVerifier(challenge);
      if (res.code === SECURITY_CONFIRMATION_REQUIRED) {
        securityConfirmationRef.current = null;
        await openSecurityConfirmation(provider, t('settings:passkey_security_confirm_failed'));
      } else {
        toast.error(res.error || t('oauth.callback_failed'));
      }
    } catch (err) {
      clearOAuthBrowserVerifier(challenge);
      logError('[ConnectedAccountsTab] connect failed', err);
      toast.error(t('oauth.callback_failed'));
    }
    return false;
  };

  async function handleConnect(provider: Provider) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusyProvider(provider);
    let redirecting = false;
    try {
      let token = getCachedSecurityConfirmation();

      // Passkey and federated sign-ins carry a short-lived, strong proof. Ask
      // the server once whether this session is still inside that window
      // before prompting.
      if (!token && !recentSessionCheckedRef.current) {
        recentSessionCheckedRef.current = true;
        try {
          const recent = await confirmWebAuthnSecurity();
          if (recent.success && recent.securityConfirmationToken && recent.expiresIn) {
            cacheSecurityConfirmation(recent.securityConfirmationToken, recent.expiresIn);
            token = recent.securityConfirmationToken;
          }
        } catch (err) {
          logError('[ConnectedAccountsTab] silent security confirmation failed', err);
        }
      }

      if (token) {
        redirecting = await performLink(provider, token);
      } else {
        await openSecurityConfirmation(provider);
      }
    } finally {
      inFlightRef.current = false;
      if (!redirecting) setBusyProvider(null);
    }
  }

  async function submitSecurityConfirmation() {
    const provider = pendingProvider;
    if (!provider || !confirmationValue.trim() || inFlightRef.current) return;
    inFlightRef.current = true;
    setConfirmingSecurity(true);
    setConfirmationError(null);
    let redirecting = false;
    try {
      const result = await confirmWebAuthnSecurity(
        buildSecurityConfirmationInput(confirmationMethod, confirmationValue),
      );
      if (!result.success || !result.securityConfirmationToken || !result.expiresIn) {
        setConfirmationError(t('settings:passkey_security_confirm_failed'));
        return;
      }
      cacheSecurityConfirmation(result.securityConfirmationToken, result.expiresIn);
      resetConfirmation();
      setBusyProvider(provider);
      redirecting = await performLink(provider, result.securityConfirmationToken);
      if (!redirecting) setBusyProvider(null);
    } catch {
      setConfirmationError(t('settings:passkey_security_confirm_failed'));
    } finally {
      setConfirmingSecurity(false);
      inFlightRef.current = false;
    }
  }

  async function handleDisconnect(provider: Provider) {
    setBusyProvider(provider);
    try {
      const res = await api.delete(`/v2/auth/oauth/${provider}/unlink`);
      if (res.success) {
        toast.success(t('oauth.disconnected'));
        await load();
      } else {
        toast.error(res.error || t('oauth.cannot_disconnect_last'));
      }
    } catch (err) {
      logError('[ConnectedAccountsTab] disconnect failed', err);
      toast.error(t('oauth.cannot_disconnect_last'));
    } finally {
      setBusyProvider(null);
    }
  }

  const supported: Provider[] = data?.supported_providers ?? ['google', 'facebook'];
  const enabled = new Set(data?.enabled_providers ?? []);
  const linkedMap = new Map((data?.identities ?? []).map((i) => [i.provider, i] as const));

  return (
    <GlassCard className="p-6">
      <h2 className="text-lg font-semibold text-theme-primary mb-1">
        {t('oauth.connected_accounts.title')}
      </h2>
      <p className="text-sm text-theme-muted mb-6">
        {t('oauth.connected_accounts.subtitle')}
      </p>

      <ul className="space-y-3">
        {supported.map((provider) => {
          const meta = PROVIDER_META[provider];
          const linked = linkedMap.get(provider);
          const isBusy = busyProvider === provider;
          const isOnlyAuthMethod = !!linked && (data?.identities.length ?? 0) <= 1;
          const isProviderEnabled = enabled.has(provider);
          return (
            <li
              key={provider}
              className="flex items-center gap-4 p-4 rounded-xl border border-[var(--border-default)] bg-[var(--color-surface)]"
            >
              <meta.Icon className="w-7 h-7 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-theme-primary">{t(meta.providerLabelKey)}</p>
                {linked ? (
                  <p className="text-xs text-theme-muted truncate">
                    {linked.provider_email ?? ''}
                    {linked.linked_at && (
                      <span className="ml-2">
                        {t('oauth.connected_at')}{' '}
                        {new Date(linked.linked_at).toLocaleDateString(getFormattingLocale())}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-theme-subtle">
                    {isProviderEnabled ? t('oauth.not_connected') : t('oauth.provider_unavailable')}
                  </p>
                )}
              </div>
              {linked ? (
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={isBusy || isOnlyAuthMethod}
                  isLoading={isBusy}
                  onPress={() => handleDisconnect(provider)}
                >
                  {isOnlyAuthMethod ? t('oauth.cannot_disconnect_last') : t('oauth.disconnect')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  isDisabled={isBusy || loading || !isProviderEnabled || pendingProvider !== null}
                  isLoading={isBusy}
                  onPress={() => handleConnect(provider)}
                >
                  {t('oauth.connect')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <SecurityConfirmationModal
        isOpen={pendingProvider !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !confirmingSecurity) resetConfirmation();
        }}
        methods={confirmationMethods}
        method={confirmationMethod}
        onMethodChange={(method) => {
          setConfirmationMethod(method);
          setConfirmationValue('');
          setConfirmationError(null);
        }}
        value={confirmationValue}
        onValueChange={setConfirmationValue}
        error={confirmationError}
        isConfirming={confirmingSecurity}
        isSubmitDisabled={!confirmationValue.trim() || confirmingSecurity}
        onSubmit={() => { void submitSecurityConfirmation(); }}
        onCancel={resetConfirmation}
        description={t('oauth.connected_accounts.security_confirm_description')}
      />
    </GlassCard>
  );
}

export default ConnectedAccountsTab;
