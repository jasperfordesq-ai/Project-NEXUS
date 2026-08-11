// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, Chip } from '@/components/ui';
import Info from 'lucide-react/icons/info';
import Lock from 'lucide-react/icons/lock';
import { useTranslation } from 'react-i18next';
import type { LegalEnforcement } from '@/admin/api/types';

/**
 * READ-ONLY display of the platform's legal-acceptance enforcement mode.
 *
 * 🔴 There is deliberately no control here. The mode is a platform-wide server
 * setting (`LEGAL_ENFORCEMENT_MODE`, see `config/legal.php`) and changing it can
 * stop members using the platform, so it stays a considered change to a server
 * file rather than a button one mis-click away. This card exists only so an
 * administrator can SEE which mode is active without shell access — previously
 * the only way to know was to read a file on the server.
 *
 * Renders nothing when the field is absent, so an older backend that does not
 * send it degrades to the dashboard as it was rather than showing an empty card
 * or claiming a mode it does not know.
 */

type KnownMode = 'off' | 'report' | 'write' | 'all';

interface ModePresentation {
  labelKey: string;
  helpKey: string;
  /** Colour is a SECOND signal — every state is also named in words. */
  colour: 'default' | 'warning' | 'success';
}

const OFF_PRESENTATION: ModePresentation = {
  labelKey: 'enterprise.legal_enforcement_mode_off',
  helpKey: 'enterprise.legal_enforcement_off_help',
  colour: 'default',
};

const MODES: Record<KnownMode, ModePresentation> = {
  off: OFF_PRESENTATION,
  report: {
    labelKey: 'enterprise.legal_enforcement_mode_report',
    helpKey: 'enterprise.legal_enforcement_report_help',
    colour: 'warning',
  },
  write: {
    labelKey: 'enterprise.legal_enforcement_mode_write',
    helpKey: 'enterprise.legal_enforcement_write_help',
    colour: 'success',
  },
  all: {
    labelKey: 'enterprise.legal_enforcement_mode_all',
    // `all` behaves as `write` today, because the gate is attached per-route and
    // never to a group, so it shares the same explanation.
    helpKey: 'enterprise.legal_enforcement_write_help',
    colour: 'success',
  },
};

function presentationFor(mode: string): ModePresentation {
  // 🔴 Falls back to ENFORCED, matching the server. `EnsureLegalAcceptance::mode()`
  // treats an unrecognised value as `write` (since 2026-08-11, when enforcement
  // became the default) because the dangerous typo is now the one that switches an
  // obligation off. The server also normalises before reporting, so this fallback
  // should never actually be reached — it exists so the two sides can never
  // disagree about what the platform is doing.
  return (MODES as Record<string, ModePresentation | undefined>)[mode] ?? MODES.write;
}

interface EnforcementModeCardProps {
  enforcement?: LegalEnforcement;
}

export function EnforcementModeCard({ enforcement }: EnforcementModeCardProps) {
  const { t } = useTranslation('admin_enterprise');

  if (!enforcement?.mode) return null;

  const { labelKey, helpKey, colour } = presentationFor(enforcement.mode);
  const gatedTypes = enforcement.enforced_acceptance_modes ?? [];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Info size={18} aria-hidden="true" />
              {t('enterprise.legal_enforcement_title')}
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {t('enterprise.legal_enforcement_subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-[var(--color-text-secondary)]">
              {t('enterprise.legal_enforcement_mode_label')}
            </span>
            <Chip color={colour} variant="flat" size="sm">
              {t(labelKey)}
            </Chip>
          </div>
        </div>

        <p className="text-sm">{t(helpKey)}</p>

        {gatedTypes.length > 0 && (
          <div className="text-sm text-[var(--color-text-secondary)]">
            <span className="font-medium">{t('enterprise.legal_enforcement_gated_label')}</span>
            {': '}
            {gatedTypes.join(', ')}
            {'. '}
            {t('enterprise.legal_enforcement_gated_none')}
          </div>
        )}

        {enforcement.editable_here === false && (
          <p className="text-xs text-[var(--color-text-tertiary)] flex items-start gap-2">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t('enterprise.legal_enforcement_read_only_notice')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default EnforcementModeCard;
