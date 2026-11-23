// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingAutomationSummary
 * One line on Billing control: whether the automatic checks are on, when they
 * last ran, and a link to their own page.
 *
 * The whole "Automatic checks" card used to sit at the top of Billing
 * control: a dozen settings and a list above the thing people came for, the
 * list of communities. The settings have their own page in the Money menu
 * now (BillingAutomationPage), and this is what stays (23 Nov 2026).
 *
 * It also tells Billing control the saved member-limit warning percent, as
 * the card did, so the list colours usage by the number the daily check
 * warns at.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { Button } from '@/components/ui';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/helpers';

/** The two keys of GET /v2/admin/super/billing/settings this line reads. */
interface Settings {
  automation_enabled: boolean;
  limit_warning_percent: number;
}

/** GET /v2/admin/super/billing/standing/last-run. `at` is null when the check has never run. */
interface LastRun {
  at: string | null;
  result: 'ok' | 'off' | 'failed' | null;
  actions: number;
}

interface BillingAutomationSummaryProps {
  onWarningPercent?: (percent: number) => void;
}

export function BillingAutomationSummary({ onWarningPercent }: BillingAutomationSummaryProps = {}) {
  const { t } = useTranslation('admin_billing');
  const { tenantPath } = useTenant();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const response = await api.get<Settings>('/v2/admin/super/billing/settings');
      if (!alive) return;
      if (response.success && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        setSettings(response.data);
      } else {
        setLoadFailed(true);
      }
    })();
    void (async () => {
      const response = await api.get<LastRun>('/v2/admin/super/billing/standing/last-run');
      if (alive && response.success && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
        setLastRun(response.data);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const warningPercent = settings?.limit_warning_percent;
  useEffect(() => {
    if (typeof warningPercent === 'number') onWarningPercent?.(warningPercent);
  }, [warningPercent, onWarningPercent]);

  const failed = lastRun?.result === 'failed';

  return (
    <div
      data-testid="automation-summary"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-secondary px-4 py-3"
    >
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <CalendarClock size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          {loadFailed ? (
            <span role="alert" className="text-danger">{t('automation.load_failed')}</span>
          ) : settings === null ? (
            <span className="text-muted">{t('common.loading')}</span>
          ) : (
            <span className="font-medium text-foreground">
              {settings.automation_enabled ? t('automation.summary_on') : t('automation.summary_off')}
            </span>
          )}
          {lastRun ? (
            <span
              data-testid="automation-summary-last-run"
              role={failed ? 'alert' : undefined}
              className={`block ${failed ? 'font-semibold text-danger' : 'text-muted'}`}
            >
              {lastRun.at === null
                ? t('automation.last_run_never')
                : failed
                  ? t('automation.last_run_failed', { date: formatDateTime(lastRun.at) })
                  : lastRun.result === 'off'
                    ? t('automation.last_run_off', { date: formatDateTime(lastRun.at) })
                    : t('automation.last_run_ok', { date: formatDateTime(lastRun.at), actions: formatNumber(lastRun.actions) })}
            </span>
          ) : null}
        </div>
      </div>
      <Button
        as={Link}
        to={tenantPath('/platform-team/billing/automatic-checks')}
        size="sm"
        variant="secondary"
        className="whitespace-nowrap"
      >
        {t('automation.summary_open')}
      </Button>
    </div>
  );
}

export default BillingAutomationSummary;
