// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card } from '@/components/ui/Card';
/**
 * Event Reminder Settings (E4)
 *
 * Placeholder for global event reminder preferences.
 * The backend currently supports per-event reminders (POST /v2/events/{id}/reminders)
 * but does not yet have a global reminder-preferences endpoint.
 * This component will be fully implemented when the backend API is ready.
 */

import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';

import Bell from 'lucide-react/icons/bell';
import Clock from 'lucide-react/icons/clock';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';

export function EventReminderSettings() {
  const { t } = useTranslation('events');
  usePageTitle(t('reminder_settings'));

  return (
    <>
      <PageMeta title={t('reminder_settings')} noIndex />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
      <Card className="bg-theme-card border border-theme-default shadow-sm">
        <Card.Content className="p-6 text-center space-y-4">
          <div className="flex justify-center">
            <div className="relative p-3 rounded-2xl bg-amber-500/10">
              <Bell className="w-8 h-8 text-[var(--color-warning)]" aria-hidden="true" />
              <Clock
                className="w-4 h-4 text-amber-400 absolute -bottom-0.5 -right-0.5"
                aria-hidden="true"
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-theme-primary">
              {t('reminder.title')}
            </h2>
            <p className="text-sm text-theme-subtle mt-1 max-w-md mx-auto">
              {t('reminder.coming_soon_desc')}
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 text-accent-soft-foreground text-xs font-medium">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {t('reminder.coming_soon_badge')}
          </div>
        </Card.Content>
      </Card>
      </motion.div>
    </>
  );
}

export default EventReminderSettings;
