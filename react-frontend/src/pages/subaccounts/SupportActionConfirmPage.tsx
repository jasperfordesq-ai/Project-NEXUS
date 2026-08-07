// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public page where a supported member lands from the confirm email:
 *   {frontend}/{tenant}/support-actions/confirm/{token}
 *
 * The single-use token IS the credential — no login needed, which is the
 * whole point: this flow exists for members who rarely or never sign in.
 *
 * Deliberately does NOT confirm on page load: mail scanners prefetch links,
 * and approval must be a human act. The GET behind this page is a read-only
 * lookup; only the explicit button fires the confirming POST. (Same split as
 * the volunteering guardian-consent verify page this mirrors.)
 *
 * There is no decline button here — declining requires a signed-in session
 * (Settings → Linked accounts). Doing nothing is always safe: the request
 * simply expires, and the email says so.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import ShieldCheck from 'lucide-react/icons/shield-check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';

type State = 'loading' | 'confirm' | 'submitting' | 'success' | 'unavailable' | 'error';

interface TokenLookup {
  action_type: 'listing_create' | 'credit_transfer' | 'message_access_grant';
  status: string;
  supporter_name: string | null;
  expires_at: string | null;
}

export default function SupportActionConfirmPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('support_actions.confirm_page_title'));

  const { token } = useParams<{ token: string }>();
  const { tenantPath } = useTenant();
  const [state, setState] = useState<State>(token ? 'loading' : 'error');
  const [details, setDetails] = useState<TokenLookup | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Read-only lookup so the member sees WHAT they are approving and WHO
  // prepared it before any button exists to press.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<TokenLookup>(`/v2/support-actions/confirm/${encodeURIComponent(token)}`, { skipAuth: true });
        if (cancelled) return;
        if (res.success && res.data) {
          setDetails(res.data);
          setState(res.data.status === 'pending' ? 'confirm' : 'unavailable');
        } else {
          setState('error');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Announce state transitions to assistive tech (WCAG 4.1.3).
  useEffect(() => {
    if (state === 'success' || state === 'error' || state === 'unavailable') {
      resultRef.current?.focus();
    }
  }, [state]);

  async function handleConfirm() {
    if (!token) return;
    setState('submitting');
    try {
      const res = await api.post(`/v2/support-actions/confirm/${encodeURIComponent(token)}`, undefined, { skipAuth: true });
      setState(res.success ? 'success' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
      <PageMeta title={t('support_actions.confirm_page_title')} noIndex />
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div
          ref={resultRef}
          tabIndex={-1}
          role={state === 'error' ? 'alert' : 'status'}
          aria-live={state === 'error' ? 'assertive' : 'polite'}
          className="space-y-4 outline-none"
        >
          {state === 'loading' && (
            <>
              <Spinner className="mx-auto" aria-label={t('support_actions.confirm_loading')} />
              <p className="text-theme-muted">{t('support_actions.confirm_loading')}</p>
            </>
          )}

          {state === 'confirm' && details && (
            <>
              <ShieldCheck className="w-12 h-12 text-[var(--color-primary)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('support_actions.confirm_page_title')}</h1>
              <p className="text-theme-muted">
                {t('support_actions.confirm_intro', {
                  name: details.supporter_name ?? '',
                  what: t(`support_actions.type_${details.action_type}`),
                })}
              </p>
              <p className="text-sm text-theme-muted">{t('support_actions.confirm_nothing_otherwise')}</p>
              <Button color="primary" className="w-full" onPress={handleConfirm}>
                {t('support_actions.confirm_button')}
              </Button>
            </>
          )}

          {state === 'submitting' && (
            <>
              <Spinner className="mx-auto" aria-label={t('support_actions.confirm_loading')} />
              <p className="text-theme-muted">{t('support_actions.confirm_loading')}</p>
            </>
          )}

          {state === 'success' && (
            <>
              <CheckCircle className="w-12 h-12 text-[var(--color-success)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('support_actions.confirm_success_title')}</h1>
              <p className="text-theme-muted">{t('support_actions.confirm_success_body')}</p>
            </>
          )}

          {state === 'unavailable' && (
            <>
              <XCircle className="w-12 h-12 text-theme-muted mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('support_actions.confirm_unavailable_title')}</h1>
              <p className="text-theme-muted">{t('support_actions.confirm_unavailable_body')}</p>
            </>
          )}

          {state === 'error' && (
            <>
              <XCircle className="w-12 h-12 text-[var(--color-danger)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('support_actions.confirm_error_title')}</h1>
              <p className="text-theme-muted">{t('support_actions.confirm_error_body')}</p>
            </>
          )}
        </div>

        <Link to={tenantPath('/')} className="text-sm text-[var(--color-primary)] underline block">
          {t('support_actions.confirm_close')}
        </Link>
      </Card>
    </div>
  );
}
