// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin-only abbreviation tooltip component.
 * Renders with a dotted underline and a HeroUI Tooltip showing the full definition.
 * Definitions are resolved from the active admin locale.
 */



export const ABBR_TERMS = {
  CHF: 'terms.chf',
  FADP: 'terms.fadp',
  nDSG: 'terms.ndsg',
  DSG: 'terms.dsg',
  GDPR: 'terms.gdpr',
  SLA: 'terms.sla',
  AGPL: 'terms.agpl',
  KPI: 'terms.kpi',
  ROI: 'terms.roi',
  NEXUS: 'terms.nexus',
  AGM: 'terms.agm',
  XP: 'terms.xp',
  ISCO: 'terms.isco',
} as const;

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '@/components/ui';
interface AbbrProps {
  /** Key from ABBR_TERMS dictionary */
  term: keyof typeof ABBR_TERMS;
  /** Override the displayed content; defaults to the term key itself */
  children?: ReactNode;
  /** Extra CSS classes on the inner span */
  className?: string;
}

/**
 * Usage:
 *   <Abbr term="CHF">CHF 35/hr</Abbr>     → renders "CHF 35/hr" with CHF tooltip
 */
export function Abbr({ term, children, className }: AbbrProps) {
  const { t } = useTranslation('admin_glossary');
  const termKey = ABBR_TERMS[term];

  // An <abbr> with an empty title is worse than no <abbr>: assistive tech
  // announces an abbreviation and then offers no expansion for it. Unknown terms
  // therefore render their content plainly. Callers are type-constrained to known
  // terms, so this only bites if a key is dropped from ABBR_TERMS while a call
  // site still passes it.
  if (!termKey) {
    return <>{children ?? term}</>;
  }

  const definition = t(termKey);

  return (
    <Tooltip
      content={
        <span className="max-w-xs block text-xs leading-relaxed">
          <strong>{term}:</strong> {definition}
        </span>
      }
      placement="top"
      delay={300}
    >
      <abbr
        title={definition}
        className={`cursor-help border-b border-dotted border-current no-underline decoration-transparent ${className ?? ''}`}
      >
        {children ?? term}
      </abbr>
    </Tooltip>
  );
}

export default Abbr;
