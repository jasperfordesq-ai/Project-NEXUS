// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The rule for what happens when a community goes over its plan's member
 * number: its wording, the compact form a table shows, the select and days
 * field, and the dialog that sets one community's own rule.
 *
 * Shared by Branch plans (a hub's default), Branch payments (a hub's manager
 * on one community) and Billing control (the platform team), so all three say
 * the same thing with the same words. The words live in `admin_billing`
 * under `over_limit_rule`.
 *
 * 🔴 The types are the server's shape (App\Support\Billing\OverLimitRule::for()
 * plus own_action / own_grace_days / acts_on). The screen decides nothing: a
 * refusal (RULE_NOT_ALLOWED, EXEMPT …) is the server's, shown as sent by the
 * page that saves.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem } from '@/components/ui';
import { formatDate } from '@/lib/helpers';

export type OverLimitAction = 'none' | 'block_joining' | 'pause' | 'upgrade';
export type OverLimitSource = 'community' | 'hub' | 'platform';

export const OVER_LIMIT_ACTIONS: readonly OverLimitAction[] = ['none', 'block_joining', 'pause', 'upgrade'];

/** OverLimitRule::for() */
export interface OverLimitRule {
  action: OverLimitAction;
  effective_action: OverLimitAction;
  grace_days: number;
  action_source: OverLimitSource;
  days_source: OverLimitSource;
}

/** As a list row carries it: the rule that applies plus what the community itself stores. */
export interface OverLimitState extends OverLimitRule {
  /** Null = the community follows a default. */
  own_action: string | null;
  own_grace_days: number | null;
  /** YYYY-MM-DD it will be paused under its present state; null when nothing is scheduled. */
  acts_on: string | null;
}

/** What a save sends: null for either means "follow the default". */
export interface OverLimitChoice {
  action: OverLimitAction | null;
  grace_days: number | null;
}

export const MIN_GRACE_DAYS = 1;
export const MAX_GRACE_DAYS = 365;

/** The key the select uses for "follow the default"; never one of the four rules. */
const FOLLOW_KEY = 'default';

export function isOverLimitAction(value: unknown): value is OverLimitAction {
  return typeof value === 'string' && (OVER_LIMIT_ACTIONS as readonly string[]).includes(value);
}

/** Only pause and move-up wait a number of days. */
export function usesDays(action: OverLimitAction | null): boolean {
  return action === 'pause' || action === 'upgrade';
}

/** Empty is "follow the default" (null); anything else must be a whole number 1–365. */
export function parseGraceDays(text: string): number | null | 'invalid' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return 'invalid';
  const n = Number(value);
  return n >= MIN_GRACE_DAYS && n <= MAX_GRACE_DAYS ? n : 'invalid';
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Warn only", "Stop new members joining", "Pause the community", "Move up to the next plan". */
export function overLimitLabel(t: Translate, action: OverLimitAction): string {
  return t(`admin_billing:over_limit_rule.label_${action}`);
}

/** One plain sentence on what the rule does. */
export function overLimitExplanation(t: Translate, action: OverLimitAction): string {
  return t(`admin_billing:over_limit_rule.explain_${action}`);
}

/**
 * The compact form for a table cell: the rule that applies, its days, where it
 * comes from when it is a default, and the pause date when one is set.
 */
export function OverLimitSummary({ rule }: { rule: OverLimitState | null }) {
  const { t } = useTranslation('admin_billing');

  if (!rule || !isOverLimitAction(rule.effective_action)) {
    return <span className="text-sm text-muted">—</span>;
  }

  let main: string;
  if (rule.action === 'upgrade' && rule.effective_action === 'none') {
    // A card payer: its card subscription would have to change too.
    main = t('over_limit_rule.upgrade_by_hand');
  } else if (rule.effective_action === 'pause') {
    main = t('over_limit_rule.summary_pause', { count: rule.grace_days });
  } else if (rule.effective_action === 'upgrade') {
    main = t('over_limit_rule.summary_upgrade', { count: rule.grace_days });
  } else {
    main = t(`over_limit_rule.short_${rule.effective_action}`);
  }

  const source = rule.action_source === 'hub'
    ? t('over_limit_rule.source_hub')
    : rule.action_source === 'platform'
      ? t('over_limit_rule.source_platform')
      : null;

  return (
    <div data-testid="over-limit-summary" className="flex flex-col gap-0.5">
      <span className="text-sm whitespace-nowrap">{main}</span>
      {source ? <span className="text-xs text-muted">{source}</span> : null}
      {rule.acts_on ? (
        <span className="text-xs text-warning whitespace-nowrap">
          {t('over_limit_rule.pause_on', { date: formatDate(rule.acts_on) })}
        </span>
      ) : null}
    </div>
  );
}

interface OverLimitRuleFieldsProps {
  /** Null = follow the default. */
  action: OverLimitAction | null;
  onActionChange: (action: OverLimitAction | null) => void;
  days: string;
  onDaysChange: (days: string) => void;
  /** The wording of the "follow the default" choice, naming the default when known. */
  followLabel: string;
  /** The rule followed when no choice is made; null when not known here. */
  inheritedAction: OverLimitAction | null;
  /** The days followed when the field is empty; null when not known here. */
  defaultDays: number | null;
  allowUpgrade: boolean;
  daysError?: string;
}

/** The select, its one-sentence explanation, and the days field when the rule waits. */
export function OverLimitRuleFields({
  action,
  onActionChange,
  days,
  onDaysChange,
  followLabel,
  inheritedAction,
  defaultDays,
  allowUpgrade,
  daysError,
}: OverLimitRuleFieldsProps) {
  const { t } = useTranslation('admin_billing');

  const shown = action ?? inheritedAction;
  // An unknown inherited rule might wait days, so the field stays available.
  const showDays = action === null && inheritedAction === null ? true : usesDays(shown);
  const choices = OVER_LIMIT_ACTIONS.filter((a) => a !== 'upgrade' || allowUpgrade || action === 'upgrade');

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t('over_limit_rule.what_happens')}
        selectedKeys={[action ?? FOLLOW_KEY]}
        disallowEmptySelection
        description={shown ? overLimitExplanation(t, shown) : undefined}
        onSelectionChange={(keys) => {
          if (keys === 'all') return;
          const picked = String(Array.from(keys)[0] ?? FOLLOW_KEY);
          onActionChange(isOverLimitAction(picked) ? picked : null);
        }}
      >
        {[
          <SelectItem key={FOLLOW_KEY} id={FOLLOW_KEY}>{followLabel}</SelectItem>,
          ...choices.map((a) => (
            <SelectItem key={a} id={a}>{overLimitLabel(t, a)}</SelectItem>
          )),
        ]}
      </Select>

      {showDays ? (
        <Input
          className="sm:max-w-xs"
          label={t('over_limit_rule.days_label')}
          value={days}
          onValueChange={onDaysChange}
          inputMode="numeric"
          maxLength={3}
          placeholder={defaultDays !== null ? String(defaultDays) : ''}
          description={defaultDays !== null
            ? t('over_limit_rule.days_help_default', { count: defaultDays })
            : t('over_limit_rule.days_help')}
          isInvalid={daysError !== undefined}
          errorMessage={daysError}
        />
      ) : null}
    </div>
  );
}

export interface OverLimitTarget {
  id: number;
  name: string;
  state: OverLimitState;
  /** False for a community that pays the platform by card: move-up is left out. */
  upgradeAllowed: boolean;
}

interface OverLimitRuleDialogProps {
  target: OverLimitTarget | null;
  onClose: () => void;
  /** Sends the choice; true when it was saved (the page shows any refusal). */
  onSave: (choice: OverLimitChoice) => Promise<boolean>;
}

/** Sets one community's own rule. Opens on what the community itself stores. */
export function OverLimitRuleDialog({ target, onClose, onSave }: OverLimitRuleDialogProps) {
  const { t } = useTranslation('admin_billing');
  const [action, setAction] = useState<OverLimitAction | null>(null);
  const [days, setDays] = useState('');
  const [daysError, setDaysError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const targetId = target?.id ?? null;
  const ownAction = target?.state.own_action ?? null;
  const ownDays = target?.state.own_grace_days ?? null;

  useEffect(() => {
    setAction(isOverLimitAction(ownAction) ? ownAction : null);
    setDays(ownDays === null ? '' : String(ownDays));
    setDaysError(undefined);
  }, [targetId, ownAction, ownDays]);

  if (!target) return null;

  const { state } = target;
  // While the community follows a default, the rule that applies IS that
  // default; once it has its own, the default is not sent, so it is not named.
  const following = state.own_action === null;
  const inheritedAction = following && isOverLimitAction(state.action) ? state.action : null;
  const defaultDays = state.own_grace_days === null ? state.grace_days : null;

  const save = async () => {
    const parsed = parseGraceDays(days);
    if (parsed === 'invalid') {
      setDaysError(t('over_limit_rule.days_invalid'));
      return;
    }
    setDaysError(undefined);
    setSaving(true);
    const done = await onSave({ action, grace_days: parsed });
    setSaving(false);
    if (done) onClose();
  };

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>
          {t('over_limit_rule.open_dialog')}
          <span className="text-muted text-sm font-normal ml-2">— {target.name}</span>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('over_limit_rule.dialog_help')}</p>
            <OverLimitRuleFields
              action={action}
              onActionChange={setAction}
              days={days}
              onDaysChange={setDays}
              followLabel={inheritedAction
                ? t('over_limit_rule.follow_default_current', { rule: overLimitLabel(t, inheritedAction) })
                : t('over_limit_rule.follow_default')}
              inheritedAction={inheritedAction}
              defaultDays={defaultDays}
              allowUpgrade={target.upgradeAllowed}
              daysError={daysError}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('billing.cancel')}
          </Button>
          <Button color="primary" onPress={() => void save()} isLoading={saving}>
            {t('over_limit_rule.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default OverLimitRuleDialog;
