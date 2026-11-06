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

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useSearchParams, Link, useNavigate, type NavigateFunction } from 'react-router-dom';
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
import { consumeAuthReturn } from '@/lib/auth-return';
import { PendingApprovalNotice } from '@/components/auth/PendingApprovalNotice';

interface OAuthExchangeResponse {
  requires_2fa?: boolean;
  requires_2fa_setup?: boolean;
  two_factor_token?: string;
  methods?: string[];
  allow_trusted_device?: boolean;
  /** The community's "trust this device" length (E-121: was dropped, so 30 showed). */
  trusted_device_days?: number;
  success?: boolean;
  token?: string;
  access_token?: string;
  refresh_token?: string;
  session_binding?: string;
  tenant_id?: number | string;
  message?: string;
  /** E-121: why the sign-in did not complete — one of REFUSAL_REASONS. */
  reason?: string;
  is_new?: boolean;
}

/**
 * E-121: the fixed reasons the server can give for a provider sign-in that did
 * not complete (App\Services\Auth\ProviderSignInRefused). Anything else is a
 * plain failure, and the wording is always ours (F-196).
 */
const REFUSAL_MESSAGES = {
  pending_approval: null, // the shared waiting panel says it all
  no_account: { ns: 'common', key: 'oauth.refused_no_account' },
  registration_closed: { ns: 'common', key: 'oauth.refused_registration_closed' },
  suspended: { ns: 'common', key: 'oauth.refused_suspended' },
  email_unverified: { ns: 'common', key: 'oauth.refused_email_unverified' },
  identity_check_pending: { ns: 'auth', key: 'login.pending_verification' },
  identity_check_failed: { ns: 'auth', key: 'login.verification_failed' },
  under_18: { ns: 'auth', key: 'login.under_minimum_age' },
} as const;

type RefusalReason = keyof typeof REFUSAL_MESSAGES;

function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REFUSAL_MESSAGES, value);
}

/** The server said why the sign-in did not complete (E-121). */
class ProviderRefusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(`provider_sign_in_refused:${reason}`);
    this.name = 'ProviderRefusal';
  }
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

/**
 * Words the page shows. Kept as a translation key and translated as the page
 * draws (E-121), so a language that finishes loading after the answer arrived
 * still applies, without re-running the exchange. `text` is the server's own
 * translated explanation (minimum age).
 */
type PageMessage =
  | { ns: 'common' | 'auth'; key: string }
  | { text: string };

/** What the page shows for a sign-in code. */
type CallbackView =
  | { kind: 'working' } // exchanging, or on the way to the next page
  | { kind: 'refused'; reason: RefusalReason }
  | { kind: 'failed'; message: PageMessage };

const WORKING: CallbackView = { kind: 'working' };

function failedView(key: string, ns: 'common' | 'auth' = 'common'): CallbackView {
  return { kind: 'failed', message: { ns, key } };
}

// React StrictMode deliberately restarts effects during development. OAuth
// callback codes are single-use, so every mounted instance in this tab/module
// must share the same exchange for an exact code + browser flow.
// Plain failures are removed so an explicit remount/retry remains possible.
// A successful answer stays until a page acts on it (E-121): a page taken away
// while the code was being exchanged, and then built again, must still be able
// to finish the sign-in with it.
const inFlightOAuthExchanges = new Map<string, Promise<OAuthExchangeResponse>>();

/**
 * E-121: codes a page in this tab has acted on, with what that page went on to
 * show. A code works once. A page built again for the same code (a remount, a
 * re-render) takes this outcome and never exchanges the used code a second
 * time: the server refuses it, and the member saw "Sign-in failed" on a
 * sign-in that had worked. It also stops a second page signing in again, or
 * sending the member somewhere other than where the first page sent them.
 */
const finishedOAuthCodes = new Map<string, Promise<CallbackView>>();

function oauthCodeKey(code: string, flow: string | null): string {
  return JSON.stringify([code, flow]);
}

/** For test isolation only: in the app this memory lasts as long as the tab. */
export function resetOAuthCallbackMemoryForTests(): void {
  if (import.meta.env.MODE === 'test') {
    inFlightOAuthExchanges.clear();
    finishedOAuthCodes.clear();
  }
}

function exchangeOAuthCode(code: string, flow: string | null): Promise<OAuthExchangeResponse> {
  const key = oauthCodeKey(code, flow);
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
        if (isRefusalReason(data.reason)) {
          throw new ProviderRefusal(data.reason);
        }
      }
      throw new Error('oauth_exchange_failed');
    }

    return data;
  })();

  inFlightOAuthExchanges.set(key, exchange);
  const removeSettledExchange = () => {
    if (inFlightOAuthExchanges.get(key) === exchange) {
      inFlightOAuthExchanges.delete(key);
    }
  };
  void exchange.then(undefined, (failure: unknown) => {
    // A refusal is the server's final answer and the code is used up (E-121).
    // Keep it, so a page built again after it arrived (a remount) shows the
    // same reason instead of re-exchanging the used code and showing
    // "Sign-in failed". Other failures stay retryable.
    if (failure instanceof ProviderRefusal || failure instanceof MinimumAgeRefusal) return;
    removeSettledExchange();
  });

  return exchange;
}

/** The router and context functions a successful answer needs, at their newest. */
interface SignInActions {
  tenantPath: (path: string) => string;
  navigate: NavigateFunction;
  beginTwoFactorChallenge: ReturnType<typeof useAuth>['beginTwoFactorChallenge'];
}

/**
 * Act on a successful answer: start two-factor, or adopt the session and go
 * on. Runs once per code (see finishedOAuthCodes).
 */
async function completeSignIn(
  data: OAuthExchangeResponse,
  flow: string | null,
  isLink: boolean,
  sessionGenerationAtStart: string | null,
  actions: MutableRefObject<SignInActions>,
): Promise<CallbackView> {
  if (tokenManager.getSessionGeneration() !== sessionGenerationAtStart) {
    return failedView('oauth.callback_failed');
  }

  if (data.two_factor_token && (data.requires_2fa || data.requires_2fa_setup)) {
    clearOAuthBrowserVerifier(flow);
    actions.current.beginTwoFactorChallenge(
      data.two_factor_token,
      !!data.requires_2fa_setup,
      data.methods || ['totp'],
      data.allow_trusted_device === true,
      sessionGenerationAtStart,
      typeof data.trusted_device_days === 'number' ? data.trusted_device_days : undefined,
    );
    actions.current.navigate(
      actions.current.tenantPath(data.requires_2fa_setup ? '/auth/two-factor/setup' : '/login'),
      { replace: true },
    );
    return WORKING;
  }

  const adoptedGeneration = await tokenManager.adoptSessionIfCurrent(
    sessionGenerationAtStart,
    String(data.access_token || data.token),
    data.refresh_token ? String(data.refresh_token) : null,
    data.tenant_id ? String(data.tenant_id) : undefined,
    data.session_binding,
  );
  if (!adoptedGeneration || tokenManager.getSessionGeneration() !== adoptedGeneration) {
    return failedView('oauth.callback_failed');
  }
  clearOAuthBrowserVerifier(flow);
  const { tenantPath } = actions.current;
  // A completed link returns the member to the settings tab they started
  // from, which confirms the link.
  // A sign-in returns to the page the member set out for (stored by the
  // login page before leaving for the provider).
  window.location.href = isLink
    ? tenantPath('/settings?tab=connected-accounts&linked=1')
    : consumeAuthReturn(tenantPath('/dashboard'));
  return WORKING;
}

/**
 * Our own wording for a callback error code. `intent=link` marks a provider
 * being linked from account settings (community SSO), which fails with
 * link-specific codes and returns the member to settings rather than login.
 */
function errorMessageKey(errCode: string, isLink: boolean): string {
  if (errCode === 'sso_link_required') return 'oauth.sso_link_required';
  if (isLink) {
    return errCode === 'sso_identity_in_use' ? 'oauth.link_identity_in_use' : 'oauth.link_failed';
  }
  return 'oauth.callback_failed';
}

export function OauthCallbackPage() {
  const { t } = useTranslation('common');
  const { t: tAuth } = useTranslation('auth');
  const [params] = useSearchParams();
  const code = params.get('code');
  const flow = params.get('flow');
  const errCode = params.get('error');
  const isLink = params.get('intent') === 'link';
  usePageTitle(t(isLink ? 'oauth.callback_linking' : 'oauth.callback_signing_in'));
  const { tenantPath } = useTenant();
  const { beginTwoFactorChallenge } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<CallbackView>(WORKING);

  // The exchange below depends on the address alone (E-121). These functions
  // change identity while the app settles (translations loading, the session
  // being adopted); an effect that re-ran on them exchanged the single-use code
  // again. It reads them from here instead, at their newest.
  const actions = useRef<SignInActions>({ tenantPath, navigate, beginTwoFactorChallenge });
  useEffect(() => {
    actions.current = { tenantPath, navigate, beginTwoFactorChallenge };
  });

  useEffect(() => {
    let cancelled = false;
    const show = (next: CallbackView) => {
      if (!cancelled) setView(next);
    };

    if (errCode) {
      // The error code (oauth_failed, sso_failed, a provider's access_denied …)
      // only decides THAT sign-in failed; the wording is always ours.
      show(errCode === ACCOUNT_UNDER_MINIMUM_AGE
        ? failedView('login.under_minimum_age', 'auth')
        : failedView(errorMessageKey(errCode, isLink)));
      return;
    }

    if (!code) {
      show(failedView(isLink ? 'oauth.link_failed' : 'oauth.callback_failed'));
      return;
    }

    const key = oauthCodeKey(code, flow);
    const finished = finishedOAuthCodes.get(key);
    if (finished) {
      void finished.then(show);
      return () => {
        cancelled = true;
      };
    }

    const sessionGenerationAtStart = tokenManager.getSessionGeneration();
    void exchangeOAuthCode(code, flow).then(
      (data) => {
        // Nobody is looking at this page any more. The answer stays with the
        // exchange, so a page built again for this code can still finish.
        if (cancelled) return;
        let outcome = finishedOAuthCodes.get(key);
        if (!outcome) {
          outcome = completeSignIn(data, flow, isLink, sessionGenerationAtStart, actions)
            .catch(() => failedView('oauth.callback_failed'));
          finishedOAuthCodes.set(key, outcome);
          // The answer has been used: drop the credentials it carried.
          inFlightOAuthExchanges.delete(key);
        }
        void outcome.then(show);
      },
      (failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ProviderRefusal && !isLink) {
          // The server has used the code up; this flow is finished.
          clearOAuthBrowserVerifier(flow);
          show({ kind: 'refused', reason: failure.reason });
          return;
        }
        if (failure instanceof MinimumAgeRefusal) {
          show(failure.serverMessage !== undefined
            ? { kind: 'failed', message: { text: failure.serverMessage } }
            : failedView('login.under_minimum_age', 'auth'));
          return;
        }
        show(failedView(isLink ? 'oauth.link_failed' : 'oauth.callback_failed'));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [code, flow, errCode, isLink]);

  const say = (message: PageMessage): string => ('text' in message
    ? message.text
    : (message.ns === 'auth' ? tAuth(message.key) : t(message.key)));

  if (view.kind === 'refused' && view.reason === 'pending_approval') {
    // Not a failure: the account exists and is waiting for the community.
    return (
      <>
        <PageMeta title={tAuth('login.pending_approval_title')} noIndex />
        <div className="min-h-screen flex items-center justify-center p-4">
          <GlassCard className="p-6 max-w-md w-full">
            <div role="status" className="p-4 rounded-xl border text-sm bg-emerald-500/10 border-emerald-500/20">
              <PendingApprovalNotice />
            </div>
          </GlassCard>
        </div>
      </>
    );
  }

  if (view.kind === 'refused') {
    const message = REFUSAL_MESSAGES[view.reason];
    return (
      <>
        <PageMeta title={t('oauth.refused_title')} noIndex />
        <div className="min-h-screen flex items-center justify-center p-4">
          <GlassCard className="p-6 max-w-md w-full">
            <h1 className="text-xl font-bold text-theme-primary mb-3">{t('oauth.refused_title')}</h1>
            <p className="text-theme-muted text-sm mb-6">{message ? say(message) : null}</p>
            <div className="flex flex-wrap gap-2">
              {view.reason === 'no_account' && (
                <Button as={Link} to={tenantPath('/register')} variant="primary">
                  {t('oauth.sign_up_instead')}
                </Button>
              )}
              <Button
                as={Link}
                to={tenantPath('/login')}
                variant="bordered"
                startContent={<ArrowLeft className="w-4 h-4" />}
              >
                {t('back_to_login')}
              </Button>
            </div>
          </GlassCard>
        </div>
      </>
    );
  }

  if (view.kind === 'failed') {
    const title = t(isLink ? 'oauth.link_failed_title' : 'oauth.callback_failed');
    return (
      <>
        <PageMeta title={title} noIndex />
        <div className="min-h-screen flex items-center justify-center p-4">
          <GlassCard className="p-6 max-w-md w-full">
            <h1 className="text-xl font-bold text-theme-primary mb-3">{title}</h1>
            <p className="text-theme-muted text-sm mb-6">{say(view.message)}</p>
            <Button
              as={Link}
              to={tenantPath(isLink ? '/settings?tab=connected-accounts' : '/login')}
              variant="bordered"
              startContent={<ArrowLeft className="w-4 h-4" />}
            >
              {isLink ? t('oauth.back_to_settings') : t('back_to_login')}
            </Button>
          </GlassCard>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title={t(isLink ? 'oauth.callback_linking' : 'oauth.callback_signing_in')} noIndex />
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <Spinner size="lg" aria-hidden="true" />
          <p className="text-theme-muted mt-3">{t(isLink ? 'oauth.callback_linking' : 'oauth.callback_signing_in')}</p>
        </div>
      </div>
    </>
  );
}

export default OauthCallbackPage;
