// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Landing page venue staff reach by scanning a member's pass QR:
 *   {frontend}/{tenant}/venues/checkin/{token}
 *
 * Deliberately does NOT record on page load — link scanners and chat clients
 * prefetch URLs, and recording a visit is a state change that needs a human
 * tap. The member's identity is only revealed by the response to that tap, so
 * a prefetch cannot disclose who holds the pass.
 *
 * Records engagement only: no discount is calculated or applied here. Whatever
 * the venue offers is the venue's own arrangement.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Chip } from '@/components/ui/Chip';
import { Select, SelectItem } from '@/components/ui/Select';
import QrCode from 'lucide-react/icons/qr-code';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Trophy from 'lucide-react/icons/trophy';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { partnerVenuesApi, type RecordVisitResult } from '@/lib/partner-venues-api';

type State = 'confirm' | 'submitting' | 'choose_venue' | 'recorded' | 'already' | 'error';

export default function VenueVisitVerifyPage() {
  const { t } = useTranslation('venues');
  usePageTitle(t('verify.title'));

  const { token } = useParams<{ token: string }>();
  const { tenantPath } = useTenant();

  const [state, setState] = useState<State>(token ? 'confirm' : 'error');
  const [result, setResult] = useState<RecordVisitResult | null>(null);
  const [venueChoices, setVenueChoices] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>(t('verify.error'));
  const resultRef = useRef<HTMLDivElement>(null);

  // Announce outcomes to assistive tech (WCAG 4.1.3) — the result region is a
  // live region and takes focus once an action resolves, because the button
  // that triggered it unmounts.
  useEffect(() => {
    if (state === 'recorded' || state === 'already' || state === 'error') {
      resultRef.current?.focus();
    }
  }, [state]);

  const errorForCode = (code?: string): string => {
    if (code === 'FORBIDDEN') return t('verify.forbidden');
    if (code === 'NOT_FOUND') return t('verify.invalid');
    if (code === 'FEATURE_DISABLED') return t('verify.unavailable');
    return t('verify.error');
  };

  async function submit(venueId?: number) {
    if (!token) return;
    setState('submitting');

    const res = await partnerVenuesApi.recordVisit(token, venueId);

    if (!res.success || !res.data) {
      const first = res.errors?.[0];
      setErrorMessage(first?.message || res.error || errorForCode(first?.code));
      setState('error');
      return;
    }

    if (res.data.status === 'needs_venue') {
      setVenueChoices(res.data.venues ?? []);
      setState('choose_venue');
      return;
    }

    setResult(res.data);
    setState(res.data.status === 'already_recorded_today' ? 'already' : 'recorded');
  }

  const memberName = result?.member?.name || '';
  const completed = result?.completed_challenges ?? [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
      <PageMeta title={t('verify.title')} noIndex />
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div
          ref={resultRef}
          tabIndex={-1}
          role={state === 'error' ? 'alert' : 'status'}
          aria-live={state === 'error' ? 'assertive' : 'polite'}
          className="space-y-4 outline-none"
        >
          {state === 'confirm' && (
            <>
              <QrCode className="w-12 h-12 text-[var(--color-primary)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('verify.title')}</h1>
              <p className="text-theme-muted">{t('verify.intro')}</p>
              <Button
                color="primary"
                className="w-full"
                data-testid="venue-verify-confirm"
                onPress={() => void submit()}
              >
                {t('verify.confirm_button')}
              </Button>
            </>
          )}

          {state === 'submitting' && (
            <>
              <Spinner className="mx-auto" aria-label={t('loading')} />
              <p className="text-theme-muted">{t('loading')}</p>
            </>
          )}

          {state === 'choose_venue' && (
            <>
              <QrCode className="w-12 h-12 text-[var(--color-primary)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">{t('verify.choose_venue_title')}</h1>
              <p className="text-theme-muted">{t('verify.choose_venue_intro')}</p>
              <Select
                label={t('verify.venue_label')}
                selectedKeys={selectedVenueId ? [selectedVenueId] : []}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const first = Array.from(keys)[0];
                  setSelectedVenueId(first !== undefined ? String(first) : '');
                }}
              >
                {venueChoices.map((venue) => (
                  <SelectItem key={String(venue.id)} id={String(venue.id)}>
                    {venue.name}
                  </SelectItem>
                ))}
              </Select>
              <Button
                color="primary"
                className="w-full"
                isDisabled={!selectedVenueId}
                data-testid="venue-verify-choose"
                onPress={() => void submit(Number(selectedVenueId))}
              >
                {t('verify.confirm_button')}
              </Button>
            </>
          )}

          {(state === 'recorded' || state === 'already') && (
            <>
              <CheckCircle className="w-12 h-12 text-[var(--color-success)] mx-auto" aria-hidden="true" />
              <h1 className="text-xl font-semibold">
                {state === 'recorded'
                  ? t('verify.recorded', { name: memberName })
                  : t('verify.already_recorded', { name: memberName })}
              </h1>
              {result?.venue?.name && (
                <p className="text-theme-muted">{result.venue.name}</p>
              )}
              {typeof result?.visits_this_month === 'number' && (
                <Chip variant="secondary">
                  {t('verify.visits_this_month', { count: result.visits_this_month })}
                </Chip>
              )}
              {completed.length > 0 && (
                <div className="space-y-2 pt-2">
                  {completed.map((challenge) => (
                    <p key={challenge.id} className="text-sm flex items-center justify-center gap-2">
                      <Trophy className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />
                      {t('verify.challenge_complete', { title: challenge.title })}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          {state === 'error' && (
            <>
              <XCircle className="w-12 h-12 text-[var(--color-danger)] mx-auto" aria-hidden="true" />
              <p className="text-theme-muted">{errorMessage}</p>
            </>
          )}
        </div>

        <Link to={tenantPath('/venues')} className="text-sm text-[var(--color-primary)] underline block">
          {t('verify.done')}
        </Link>
      </Card>
    </div>
  );
}
