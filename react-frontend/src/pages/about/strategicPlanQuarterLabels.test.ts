// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';

import nlAbout from '../../../public/locales/nl/about.json';
import plAbout from '../../../public/locales/pl/about.json';

/**
 * The strategic plan's roadmap columns are calendar QUARTERS (English "Q1"–"Q4").
 * Machine translation rendered them as "Vraag" / "Pytanie" — "Question" — in
 * Dutch and Polish. These must match the accessible frontend's quarter labels
 * in lang/nl/govuk_alpha_tbi_pages.php and lang/pl/govuk_alpha_tbi_pages.php.
 */
const quarters = (about: {
  strategic_plan: { roadmap_q1: string; roadmap_q2: string; roadmap_q3: string; roadmap_q4: string };
}) => [
  about.strategic_plan.roadmap_q1,
  about.strategic_plan.roadmap_q2,
  about.strategic_plan.roadmap_q3,
  about.strategic_plan.roadmap_q4,
];

describe('strategic plan quarter labels', () => {
  it('Dutch uses kwartaal labels K1–K4', () => {
    expect(quarters(nlAbout)).toEqual(['K1', 'K2', 'K3', 'K4']);
  });

  it('Polish uses kwartał labels I kw.–IV kw.', () => {
    expect(quarters(plAbout)).toEqual(['I kw.', 'II kw.', 'III kw.', 'IV kw.']);
  });
});
