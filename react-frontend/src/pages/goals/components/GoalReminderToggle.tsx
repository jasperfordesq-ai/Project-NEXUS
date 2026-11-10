// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Popover, PopoverTrigger, PopoverContent, PopoverHeading } from '@/components/ui/Popover';
import { Separator } from '@/components/ui/Separator';
/**
 * G4 - Goal Reminder Toggle
 *
 * Shows a bell icon with reminder status and a popover to
 * configure reminder frequency for a goal.
 *
 * API: GET /api/v2/goals/{id}/reminder
 *      PUT /api/v2/goals/{id}/reminder
 *      DELETE /api/v2/goals/{id}/reminder
 */

import { useState, useEffect, useCallback } from 'react';
import Bell from 'lucide-react/icons/bell';
import BellOff from 'lucide-react/icons/bell-off';
import BellRing from 'lucide-react/icons/bell-ring';
import Check from 'lucide-react/icons/check';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

import { useTranslation } from 'react-i18next';
/* ───────────────────────── Types ───────────────────────── */

interface GoalReminder {
  id: number;
  goal_id: number;
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  enabled: boolean;
  next_reminder_at: string | null;
}

interface GoalReminderToggleProps {
  goalId: number;
  className?: string;
}

/* ───────────────────────── Frequency Options ───────────────────────── */

const FREQUENCIES = [
  { value: 'daily', labelKey: 'frequency.daily' },
  { value: 'weekly', labelKey: 'frequency.weekly' },
  { value: 'biweekly', labelKey: 'frequency.biweekly' },
  { value: 'monthly', labelKey: 'frequency.monthly' },
] as const;

/* ───────────────────────── Component ───────────────────────── */

export function GoalReminderToggle({ goalId, className = '' }: GoalReminderToggleProps) {
  const toast = useToast();
  const { t } = useTranslation('goals');
  const [reminder, setReminder] = useState<GoalReminder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const loadReminder = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.get<GoalReminder>(`/v2/goals/${goalId}/reminder`);
      if (response.success && response.data) {
        setReminder(response.data);
      } else {
        setReminder(null);
      }
    } catch {
      // No reminder set — that's OK
      setReminder(null);
    } finally {
      setIsLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    loadReminder();
  }, [loadReminder]);

  const handleSetReminder = async (frequency: string) => {
    try {
      setIsSaving(true);
      const response = await api.put(`/v2/goals/${goalId}/reminder`, { frequency });
      if (response.success) {
        toast.success(t('reminder.reminder_set_success', { frequency }));
        await loadReminder();
        setIsPopoverOpen(false);
      } else {
        toast.error(t('reminder_set_failed'));
      }
    } catch (err) {
      logError('Failed to set goal reminder', err);
      toast.error(t('reminder_set_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteReminder = async () => {
    try {
      setIsSaving(true);
      const response = await api.delete(`/v2/goals/${goalId}/reminder`);
      if (response.success) {
        toast.success(t('reminder_removed'));
        setReminder(null);
        setIsPopoverOpen(false);
      } else {
        toast.error(t('reminder_remove_failed'));
      }
    } catch (err) {
      logError('Failed to delete goal reminder', err);
      toast.error(t('reminder_remove_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const hasReminder = reminder?.enabled;

  return (
    <Popover
      placement="bottom"
      isOpen={isPopoverOpen}
      onOpenChange={setIsPopoverOpen}
    >
      <PopoverTrigger>
        <Button
          isIconOnly
          size="sm"
          variant="flat"
          className={`${hasReminder ? 'bg-accent/10 text-accent-soft-foreground' : 'bg-theme-elevated text-theme-muted'} ${className}`}
          isLoading={isLoading}
          aria-label={hasReminder ? t('reminder.aria_active') : t('reminder.aria_set')}
        >
          {hasReminder ? (
            <BellRing className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="bg-overlay border border-theme-default p-3 w-52">
        <div className="space-y-2">
          <PopoverHeading className="text-sm font-semibold text-theme-primary">
            {hasReminder ? t('reminder.active') : t('reminder.set')}
          </PopoverHeading>

          {hasReminder && reminder && (
            <p className="text-xs text-theme-subtle">
              {t('reminder.currently', { frequency: FREQUENCIES.find((f) => f.value === reminder.frequency) ? t(FREQUENCIES.find((f) => f.value === reminder.frequency)!.labelKey) : reminder.frequency })}
            </p>
          )}

          <Separator />

          <div className="space-y-1">
            {FREQUENCIES.map((freq) => (
              <Button
                key={freq.value}
                size="sm"
                variant="flat"
                className={`w-full justify-start text-sm ${
                  reminder?.frequency === freq.value
                    ? 'bg-accent/10 text-accent-soft-foreground'
                    : 'bg-transparent text-theme-muted hover:bg-theme-hover'
                }`}
                onPress={() => handleSetReminder(freq.value)}
                isDisabled={isSaving}
                endContent={reminder?.frequency === freq.value ? <Check className="w-3.5 h-3.5" /> : undefined}
              >
                {t(freq.labelKey)}
              </Button>
            ))}
          </div>

          {hasReminder && (
            <>
              <Separator />
              <Button
                size="sm"
                variant="flat"
                className="w-full justify-start text-sm text-danger hover:bg-danger/10"
                startContent={<BellOff className="w-3.5 h-3.5" aria-hidden="true" />}
                onPress={handleDeleteReminder}
                isDisabled={isSaving}
              >
                {t('reminder.remove')}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default GoalReminderToggle;
