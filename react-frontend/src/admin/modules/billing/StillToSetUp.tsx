// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * StillToSetUp
 * The communities that are billed but cannot be yet: no plan, no paid-until
 * date, or neither. Shown above the list on Billing control and on Branch
 * payments, each with the one button that finishes it.
 *
 * It exists because a new community starts with no plan and no date, and the
 * daily check looks only at communities that have a date: such a community
 * ran free and nothing on screen said so (23 Nov 2026).
 *
 * Renders nothing when there is nothing to set up.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody } from '@/components/ui';

export interface SetupItem {
  id: number;
  name: string;
  noPlan: boolean;
  noDate: boolean;
  /** False when this person may not give it a plan (it pays the platform by card). */
  canAssignPlan?: boolean;
}

interface StillToSetUpProps {
  items: SetupItem[];
  onAssignPlan: (id: number) => void;
  onSetDate: (id: number) => void;
  /** A row is being saved: its buttons wait. */
  isDisabled?: boolean;
}

/** How many are listed before "Show all". */
const SHOWN_AT_FIRST = 5;

export function StillToSetUp({ items, onAssignPlan, onSetDate, isDisabled = false }: StillToSetUpProps) {
  const { t } = useTranslation('admin_billing');
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) return null;

  const shown = showAll ? items : items.slice(0, SHOWN_AT_FIRST);

  return (
    <Card data-testid="still-to-set-up" className="border border-warning/40">
      <CardBody className="gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t('control.setup_title', { total: items.length })}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('control.setup_help')}</p>
        </div>

        <ul className="divide-y divide-divider">
          {shown.map((item) => {
            const missing = item.noPlan && item.noDate
              ? t('control.setup_missing_both')
              : item.noPlan ? t('billing.status_no_plan') : t('control.filter_no_paid_until');
            // The plan first: saving it asks for the date straight after.
            const assign = item.noPlan && item.canAssignPlan !== false;
            const action = assign ? t('billing.assign_plan') : item.noDate ? t('control.set_paid_until') : null;

            return (
              <li key={item.id} data-testid={`setup-item-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{item.name}</span>
                  <span className="block text-xs text-muted">{missing}</span>
                </div>
                {action !== null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="whitespace-nowrap"
                    isDisabled={isDisabled}
                    aria-label={t('control.setup_action_for', { action, name: item.name })}
                    onPress={() => (assign ? onAssignPlan(item.id) : onSetDate(item.id))}
                  >
                    {action}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {items.length > SHOWN_AT_FIRST ? (
          <div>
            <Button size="sm" variant="tertiary" aria-expanded={showAll} onPress={() => setShowAll((all) => !all)}>
              {showAll ? t('control.setup_show_fewer') : t('control.setup_show_all', { total: items.length })}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default StillToSetUp;
