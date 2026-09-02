// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ModuleStageBadge — small maturity chip ("Alpha" / "Beta") for surfacing
 * pre-release modules to end users. Mirrors the admin module-config stage chip
 * (warning for alpha, accent for beta) for visual consistency.
 *
 * Replaces the old `AlphaBadge`, which could only ever say "Alpha".
 *
 * Keep the stage passed here in step with the module's `stage` in
 * `src/admin/modules/config/moduleRegistry.ts`. The two are deliberately
 * separate — member pages must not import admin code — but they describe the
 * same thing, so a module that says "Beta" to members must not still be
 * flagged "Alpha" to admins.
 */

import { useTranslation } from 'react-i18next';
import { Chip } from './Chip';

export type ModuleStage = 'alpha' | 'beta';

export interface ModuleStageBadgeProps {
  /** Maturity stage to advertise. */
  stage: ModuleStage;
  className?: string;
  size?: 'sm' | 'md';
}

export function ModuleStageBadge({ stage, className, size = 'sm' }: ModuleStageBadgeProps) {
  const { t } = useTranslation('common');
  const label = t(stage === 'alpha' ? 'alpha_badge' : 'beta_badge');

  return (
    <Chip
      color={stage === 'alpha' ? 'warning' : 'primary'}
      variant="soft"
      size={size}
      className={className}
      aria-label={label}
    >
      {label}
    </Chip>
  );
}

export default ModuleStageBadge;
