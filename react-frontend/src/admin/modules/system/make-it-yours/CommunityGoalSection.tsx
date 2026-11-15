// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Make it yours" → A shared goal (warmth phase 6, D1).
 *
 * The community's admin sets ONE goal for everyone ("Let's share 500 hours by
 * spring"): a name, what counts towards it, a target and dates. Members see
 * the whole community's progress on their dashboard — a total, never what one
 * person did. Ending a goal, or its end date passing, keeps it for members as
 * "What we've done together".
 *
 * Optional and not a step: it never moves the "x of 6" meter. It lives on
 * this page alone (one admin place per setting). The server applies the same
 * rules (CommunityGoalService::validate); they are checked here too so a goal
 * that would be refused is never sent.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Target from 'lucide-react/icons/target';
import { Alert, Button, Chip, Input, Progress, Radio, RadioGroup } from '@/components/ui';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { getFormattingLocale } from '@/lib/helpers';
import {
  adminCommunitySetup,
  type AdminCommunityGoal,
  type CommunityGoalInput,
  type CommunityGoalMetric,
} from '../../../api/adminApi';
import { SettingsSection } from '../settings/SettingsSection';

const METRICS: readonly CommunityGoalMetric[] = ['hours', 'exchanges', 'offers', 'events'];
export const GOAL_TITLE_MAX = 120;
const TARGET_MAX = 1_000_000;
/** Two years, a leap day included — the server's limit. */
const MAX_SPAN_DAYS = 731;

/** A real YYYY-MM-DD date, as a UTC timestamp, or null. */
function dateValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime();
}

/**
 * The server's date rule: a real start no later than today, and a real end
 * after the start that has not passed, at most two years later.
 */
export function isValidGoalDates(startsOn: string, endsOn: string, today: string): boolean {
  const start = dateValue(startsOn);
  const end = dateValue(endsOn);
  if (start === null || end === null) return false;
  if (startsOn > today || endsOn < today || endsOn <= startsOn) return false;
  return (end - start) / 86_400_000 <= MAX_SPAN_DAYS;
}

interface Draft {
  title: string;
  metric: CommunityGoalMetric;
  target: string;
  startsOn: string;
  endsOn: string;
}

function draftFrom(goal: AdminCommunityGoal | null, today: string): Draft {
  return goal
    ? { title: goal.title, metric: goal.metric, target: String(goal.target), startsOn: goal.starts_on, endsOn: goal.ends_on }
    : { title: '', metric: 'hours', target: '', startsOn: today, endsOn: '' };
}

/** The goal to send, or null while the draft would be refused. */
function inputFrom(draft: Draft, today: string): CommunityGoalInput | null {
  const title = draft.title.replace(/\s+/g, ' ').trim();
  const target = /^\d{1,7}$/.test(draft.target.trim()) ? Number(draft.target.trim()) : NaN;
  if (title.length < 1 || title.length > GOAL_TITLE_MAX) return null;
  if (!Number.isInteger(target) || target < 1 || target > TARGET_MAX) return null;
  if (!isValidGoalDates(draft.startsOn, draft.endsOn, today)) return null;
  return { title, metric: draft.metric, target, starts_on: draft.startsOn, ends_on: draft.endsOn };
}

export interface CommunityGoalSectionProps {
  goal: AdminCommunityGoal | null;
  /** The community's name, for the description. */
  name: string;
  /** Today's date on this device as YYYY-MM-DD. */
  today: string;
  /** Read the page again after a save or an end. */
  onChanged: () => Promise<void>;
  /** Tells the page whether the form holds unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function CommunityGoalSection({ goal, name, today, onChanged, onDirtyChange }: CommunityGoalSectionProps) {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const saved = useMemo(() => draftFrom(goal, today), [goal, today]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);

  // The form follows the server's copy whenever that changes (after a save,
  // an end, or another admin's change read on refetch).
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirty = draft.title !== saved.title || draft.metric !== saved.metric || draft.target !== saved.target
    || draft.startsOn !== saved.startsOn || draft.endsOn !== saved.endsOn;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const input = inputFrom(draft, today);
  // Only complain once the admin has filled the form in enough to be judged.
  const touched = draft.title.trim() !== '' && draft.target.trim() !== '' && draft.endsOn !== '';
  const showInvalid = dirty && touched && input === null;

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = useCallback(async () => {
    if (!input) return;
    setSaving(true);
    try {
      const res = await adminCommunitySetup.updateGoal(input);
      if (!res.success) {
        // admin-i18n-ignore: localized server message — CommunitySetupController refusals are __() keys.
        toast.error(res.error || t('system.save_failed'));
        return;
      }
      toast.success(t('admin_settings.miy_goal_saved'));
      await onChanged();
    } catch (err) {
      logError('Community goal save error', err);
      toast.error(t('system.failed_to_save_settings'));
    } finally {
      setSaving(false);
    }
  }, [input, onChanged, toast, t]);

  const end = useCallback(async () => {
    setEnding(true);
    try {
      const res = await adminCommunitySetup.endGoal();
      if (!res.success) {
        // admin-i18n-ignore: localized server message — CommunitySetupController refusals are __() keys.
        toast.error(res.error || t('system.save_failed'));
        return;
      }
      toast.success(t('admin_settings.miy_goal_ended'));
      await onChanged();
    } catch (err) {
      logError('Community goal end error', err);
      toast.error(t('system.failed_to_save_settings'));
    } finally {
      setEnding(false);
    }
  }, [onChanged, toast, t]);

  const locale = getFormattingLocale();
  const percent = goal ? Math.round(Math.min(100, Math.max(0, (goal.current / goal.target) * 100)) * 10) / 10 : 0;

  return (
    // Optional, and deliberately not a step: a community without a goal is
    // not "unfinished", so it never moves the meter.
    <section id="make-it-yours-goal" data-testid="setup-goal" className="scroll-mt-24 space-y-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Chip size="sm" variant="soft" color="default">
          {t('admin_settings.miy_founded_optional')}
        </Chip>
      </div>
      <SettingsSection
        id="make-it-yours-shared-goal"
        icon={<Target size={20} aria-hidden="true" />}
        title={t('admin_settings.miy_goal_title')}
        description={t('admin_settings.miy_goal_desc', { name })}
      >
        {goal && (
          <div className="space-y-2 rounded-xl bg-surface-secondary p-3" data-testid="setup-goal-progress">
            <p className="text-sm font-medium text-foreground">
              {t('admin_settings.miy_goal_progress', {
                current: goal.current.toLocaleString(locale),
                target: goal.target.toLocaleString(locale),
              })}
            </p>
            <Progress aria-label={t('admin_settings.miy_goal_title')} value={percent} size="sm" className="w-full" />
            {goal.reached && <p className="text-sm text-success">{t('admin_settings.miy_goal_reached')}</p>}
          </div>
        )}
        {goal?.finished && <Alert color="warning" title={t('admin_settings.miy_goal_finished')} />}

        <Input
          label={t('admin_settings.miy_goal_name_label')}
          placeholder={t('admin_settings.miy_goal_name_placeholder')}
          variant="secondary"
          value={draft.title}
          maxLength={GOAL_TITLE_MAX}
          onValueChange={set('title')}
          description={t('admin_settings.miy_tagline_count', { used: draft.title.length, max: GOAL_TITLE_MAX })}
        />
        <RadioGroup
          label={t('admin_settings.miy_goal_metric_label')}
          value={draft.metric}
          onValueChange={(value) => {
            if ((METRICS as readonly string[]).includes(value)) set('metric')(value as CommunityGoalMetric);
          }}
        >
          {METRICS.map((metric) => (
            <Radio key={metric} value={metric}>
              {t(`admin_settings.miy_goal_metric_${metric}`)}
            </Radio>
          ))}
        </RadioGroup>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            type="number"
            label={t('admin_settings.miy_goal_target_label')}
            variant="secondary"
            value={draft.target}
            min={1}
            max={TARGET_MAX}
            step={1}
            inputMode="numeric"
            onValueChange={set('target')}
          />
          <Input
            type="date"
            label={t('admin_settings.miy_goal_starts_label')}
            variant="secondary"
            value={draft.startsOn}
            max={today}
            onValueChange={set('startsOn')}
          />
          <Input
            type="date"
            label={t('admin_settings.miy_goal_ends_label')}
            variant="secondary"
            value={draft.endsOn}
            min={today}
            onValueChange={set('endsOn')}
          />
        </div>
        {showInvalid && (
          <p className="text-sm text-danger" role="alert">{t('admin_settings.miy_goal_invalid')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            isDisabled={!dirty || input === null || saving || ending}
            isLoading={saving}
            onPress={() => void save()}
          >
            {t('admin_settings.miy_goal_save')}
          </Button>
          {goal && (
            <Button variant="secondary" size="sm" isDisabled={saving || ending} isLoading={ending} onPress={() => void end()}>
              {t('admin_settings.miy_goal_end')}
            </Button>
          )}
        </div>
      </SettingsSection>
    </section>
  );
}

export default CommunityGoalSection;
