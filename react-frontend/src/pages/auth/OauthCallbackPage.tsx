// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OAuth Callback Page (SOC13)
 *
 * The backend redirects the user here after a successful OAuth round-trip with
 * a short-lived `?code=<one-time-code>` that is exchanged via POST.
 * On error: `?error=<code>&message=<text>&provider=<x>`.
 *
 * F-196: only our own translated text is ever shown. The `message` parameter is
 * never rendered — anyone can craft a link to this page, and its text would
 * otherwise appear under the platform's own heading.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { API_BASE, tokenManager } from '@/lib/api';
import { ACCOUNT_UNDER_MINIMUM_AGE, serverMessageFor } from '@/lib/minimum-age';
import {
  clearOAuthBrowserVerifier,
  getOAuthBrowserVerifier,
} from '@/lib/oauth-browser-binding';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePageTitle } from '@/hooks/usePageTitle';

interface OAuthExchangeResponse {
  requires_2fa?: boolean;
  requires_2fa_setup?: boolean;
  two_factor_token?: string;
  methods?: string[];
  allow_trusted_device?: boolean;
  success?: boolean;
  token?: string;
  access_token?: string;
  refresh_token?: string;
  tenant_id?: number | string;
  message?: string;
}

/**
 * Adults-only decision 2026-09-25: the account behind this social sign-in is
 * under 18. Carries the server's translated explanation when it sent one.
 */
class MinimumAgeRefusal extends Error {
  constructor(readonly serverMessage?: string) {
    super(ACCOUNT_UNDER_MINIMUM_AGE);
    this.name = 'MinimumAgeRefusal';
  }
}

// React StrictMode deliberately restarts effects during development. OAuth
// callback codes are single-use, so every mounted instance in this tab/module
// must share the same in-flight exchange for an exact code + browser flow.
// Settled failures are removed so an explicit remount/retry remains possible.
const inFlightOAuthExchanges = new Map<string, Promise<OAuthExchangeResponse>>();

function exchangeOAuthCode(code: string, flow: string | null): Promise<OAuthExchangeResponse> {
  const key = JSON.stringify([code, flow]);
  const existing = inFlightOAuthExchanges.get(key);
  if (existing) return existing;

  const exchange = (async () => {
    const browserVerifier = getOAuthBrowserVerifier(flow);
    const response = await fetch(`${API_BASE}/v2/auth/oauth/exchange`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, browser_verifier: browserVerifier }),
    });
    const data = await response.json() as OAuthExchangeResponse;

    if (!response.ok || !data.success || (!data.token && !data.two_factor_token)) {
      if (response.status === 403) {
        const refused = data as { errors?: { code?: string; message?: string }[] };
        if (refused.errors?.some((error) => error?.code === ACCOUNT_UNDER_MINIMUM_AGE)) {
          throw new MinimumAgeRefusal(serverMessageFor(refused.errors, ACCOUNT_UNDER_MINIMUM_AGE));
        }
      }
      throw new Error(data.message || 'oauth_exchange_failed');
    }

    return data;
  })();

  inFlightOAuthExchanges.set(key, exchange);
  const removeSettledExchange = () => {
    if (inFlightOAuthExchanges.get(key) === exchange) {
      inFlightOAuthExchanges.delete(key);
    }
  };
  void exchange.then(removeSettledExchange, removeSettledExchange);

  return exchange;
}

export function OauthCallbackPage() {
  const { t } = useTranslation('common');
  const { t: tAuth } = useTranslation('auth');
  usePageTitle(t('oauth.callback_signing_in'));
  const [params] = useSearchParams();
  const { tenantPath } = useTenant();
  const { beginTwoFactorChallenge } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const code = params.get('code');
    const flow = params.get('flow');
    const sessionGenerationAtStart = tokenManager.getSessionGeneration();
    const errCode = params.get('error');

    if (errCode) {
      // The error code (oauth_failed, sso_failed, a provider's access_denied …)
      // only decides THAT sign-in failed; the wording is always ours.
      setError(errCode === ACCOUNT_UNDER_MINIMUM_AGE
        ? tAuth('login.under_minimum_age')
        : t('oauth.callback_failed'));
      return;
    }

    if (!code) {
      setError(t('oauth.callback_failed'));
      return;
    }

    void exchangeOAuthCode(code, flow).then(
      async (data) => {
        if (cancelled) return;
        if (tokenManager.getSessionGeneration() !== sessionGenerationAtStart) {
          setError(t('oauth.callback_failed'));
          return;
        }

        if (data.two_factor_token && (data.requires_2fa || data.requires_2fa_setup)) {
          clearOAuthBrowserVerifier(flow);
          beginTwoFactorChallenge(
            data.two_factor_token,
            !!data.requires_2fa_setup,
            data.methods || ['totp'],
            data.allow_trusted_device === true,
            sessionGenerationAtStart,
          );
          navigate(tenantPath(data.requires_2fa_setup ? '/auth/two-factor/setup' : '/login'), { replace: true });
          return;
        }

        const adoptedGeneration = await tokenManager.adoptSessionIfCurrent(
          sessionGenerationAtStart,
          String(data.access_token || data.token),
          data.refresh_token ? String(data.refresh_token) : null,
          data.tenant_id ? String(data.tenant_id) : undefined,
        );
        if (!adoptedGeneration || tokenManager.getSessionGeneration() !== adoptedGeneration) {
          setError(t('oauth.callback_failed'));
          return;
        }
        clearOAuthBrowserVerifier(flow);
        window.location.href = tenantPath('/dashboard');
      },
      (failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof MinimumAgeRefusal
            ? failure.serverMessage ?? tAuth('login.under_minimum_age')
            : t('oauth.callback_failed'));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [params, tenantPath, t, tAuth, beginTwoFactorChallenge, navigate]);

  if (error) {
    return (
      <>
        <PageMeta title={t('oauth.callback_failed')} noIndex />
        <div className="min-h-screen flex items-center justify-center p-4">
          <GlassCard className="p-6 max-w-md w-full">
            <h1 className="text-xl font-bold text-theme-primary mb-3">{t('oauth.callback_failed')}</h1>
            <p className="text-theme-muted text-sm mb-6">{error}</p>
            <Button
              as={Link}
              to={tenantPath('/login')}
              variant="bordered"
              startContent={<ArrowLeft className="w-4 h-4" />}
            >
              {t('back_to_login')}
            </Button>
          </GlassCard>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title={t('oauth.callback_signing_in')} noIndex />
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Spinner size="lg" aria-hidden="true" />
          <p className="text-theme-muted mt-3">{t('oauth.callback_signing_in')}</p>
        </div>
      </div>
    </>
  );
}

export default OauthCallbackPage;
