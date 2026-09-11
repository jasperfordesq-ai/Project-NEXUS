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
    const errCode = params.get('error');
    const errMsg = params.get('message');

    if (errCode) {
      setError(errMsg || t('oauth.callback_failed'));
      return;
    }

    if (!code) {
      setError(t('oauth.callback_failed'));
      return;
    }

    void exchangeOAuthCode(code, flow).then(
      (data) => {
        if (cancelled) return;

        if (data.two_factor_token && (data.requires_2fa || data.requires_2fa_setup)) {
          clearOAuthBrowserVerifier(flow);
          beginTwoFactorChallenge(data.two_factor_token, !!data.requires_2fa_setup, data.methods || ['totp'], data.allow_trusted_device === true);
          navigate(tenantPath(data.requires_2fa_setup ? '/auth/two-factor/setup' : '/login'), { replace: true });
          return;
        }

        if (data.tenant_id) {
          tokenManager.setTenantId(String(data.tenant_id));
        }
        if (data.refresh_token) {
          tokenManager.setRefreshToken(String(data.refresh_token));
        }
        // Persist the rotating credential before the access token. Other tabs
        // wake on the access-token storage event and must observe a complete
        // token generation rather than new access paired with stale refresh.
        tokenManager.setAccessToken(String(data.access_token || data.token));
        clearOAuthBrowserVerifier(flow);
        window.location.href = tenantPath('/dashboard');
      },
      () => {
        if (!cancelled) {
          setError(t('oauth.callback_failed'));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [params, tenantPath, t, beginTwoFactorChallenge, navigate]);

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
