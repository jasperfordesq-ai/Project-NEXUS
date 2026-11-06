// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { FacebookIcon } from '@/components/icons/FacebookIcon';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { API_BASE } from '@/lib/api';
import {
  clearOAuthBrowserVerifier,
  createOAuthBrowserBinding,
} from '@/lib/oauth-browser-binding';

type Provider = 'google' | 'facebook';

/**
 * Sign-up only (E-121): the member's tick in the same box the sign-up form has
 * ("I agree to the Terms and Privacy Policy, and I am 18 years of age or older").
 * It is rendered beside the buttons because on phones the form's own box is on
 * its last screen while these buttons are on the first. The server refuses a
 * provider sign-up that does not carry the tick, so a sign-up without this
 * prop cannot start.
 */
export interface OAuthSignUpConsent {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  /** The box's label: the sign-up form's own words and links. */
  label: ReactNode;
}

interface OAuthButtonsProps {
  /**
   * "login" or "register" — passed to the backend so the state token records intent.
   */
  intent?: 'login' | 'register';
  /**
   * Restrict which providers to show (e.g. from tenant settings). Empty/undefined = show all.
   */
  enabledProviders?: Provider[];
  /**
   * Optional tenant id to forward when no tenant is resolved by host/slug yet.
   */
  tenantId?: string | number;
  /** Required for intent="register" — see OAuthSignUpConsent. */
  consent?: OAuthSignUpConsent;
}

const PROVIDERS: ReadonlyArray<{ id: Provider; Icon: typeof GoogleIcon; key: string }> = [
  { id: 'google', Icon: GoogleIcon, key: 'oauth.continue_with_google' },
  { id: 'facebook', Icon: FacebookIcon, key: 'oauth.continue_with_facebook' },
];

export function OAuthButtons({ intent = 'login', enabledProviders, tenantId, consent }: OAuthButtonsProps) {
  const { t } = useTranslation('common');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [consentMissing, setConsentMissing] = useState(false);
  const isSignUp = intent === 'register';

  // If parent didn't pass enabledProviders, ask the backend which providers are enabled.
  // Backend returns [] when OAUTH_ENABLED is off — buttons hide entirely.
  const [serverProviders, setServerProviders] = useState<Provider[] | null>(
    enabledProviders ?? null
  );
  useEffect(() => {
    if (enabledProviders !== undefined) return;
    const headers: Record<string, string> = {};
    if (tenantId) headers['X-Tenant-Id'] = String(tenantId);
    fetch(`${API_BASE}/v2/auth/oauth/enabled-providers`, { credentials: 'include', headers })
      .then((r) => r.json())
      .then((data: { success?: boolean; providers?: Provider[] }) => {
        setServerProviders(Array.isArray(data?.providers) ? data.providers : []);
      })
      .catch(() => setServerProviders([]));
  }, [enabledProviders, tenantId]);

  // While we don't yet know, render nothing (no flash of unavailable buttons)
  if (serverProviders === null) return null;

  const visible = PROVIDERS.filter((p) =>
    serverProviders.length > 0 ? serverProviders.includes(p.id) : false
  );

  if (visible.length === 0) {
    return null;
  }

  async function startFlow(provider: Provider) {
    setFlowError(null);
    if (isSignUp && !consent?.accepted) {
      // Say why nothing happened rather than leaving a button that does nothing.
      setConsentMissing(true);
      return;
    }
    let challenge: string | null = null;

    try {
      ({ challenge } = await createOAuthBrowserBinding());
      const params = new URLSearchParams({ intent, browser_challenge: challenge });
      if (isSignUp) params.set('terms_accepted', '1');
      if (tenantId) params.set('tenant_id', String(tenantId));
      const response = await fetch(
        `${API_BASE}/v2/auth/oauth/${provider}/redirect?${params.toString()}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: tenantId ? { 'X-Tenant-Id': String(tenantId) } : {},
        },
      );
      const data = await response.json() as {
        success?: boolean;
        redirect_url?: string;
      };
      if (data?.success && data.redirect_url) {
        window.location.href = data.redirect_url;
        return;
      }
    } catch {
      // Fail closed when secure browser storage/crypto or initiation is unavailable.
    }

    clearOAuthBrowserVerifier(challenge);
    setFlowError(t('oauth.callback_failed'));
  }

  return (
    <div className="space-y-3">
      {flowError && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {flowError}
        </p>
      )}
      {isSignUp && consent && (
        // Same control, size and contrast overrides as the sign-up form's own
        // terms box (RegisterPage) — a consent control is not the place to shrink.
        <Checkbox
          isSelected={consent.accepted}
          onValueChange={(selected) => {
            consent.onChange(selected);
            if (selected) setConsentMissing(false);
          }}
          isInvalid={consentMissing}
          size="lg"
          color="primary"
          classNames={{
            label: 'text-theme-muted text-sm',
            wrapper: 'border-black/50 dark:border-white/50',
          }}
        >
          <span>{consent.label}</span>
        </Checkbox>
      )}
      {consentMissing && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('oauth.terms_required')}
        </p>
      )}
      {visible.map(({ id, Icon, key }) => (
        <Button
          key={id}
          type="button"
          variant="outline"
          fullWidth
          size="lg"
          startContent={<Icon className="w-5 h-5" aria-hidden="true" />}
          onPress={() => void startFlow(id)}
          className="border-[var(--border-default)] text-theme-primary hover:bg-theme-hover"
        >
          {t(key)}
        </Button>
      ))}
      <div className="relative flex items-center my-2">
        <div className="flex-grow border-t border-[var(--border-default)]" />
        <span className="flex-shrink mx-3 text-xs text-theme-subtle">
          {t('oauth.or_continue_with_email')}
        </span>
        <div className="flex-grow border-t border-[var(--border-default)]" />
      </div>
    </div>
  );
}

export default OAuthButtons;
