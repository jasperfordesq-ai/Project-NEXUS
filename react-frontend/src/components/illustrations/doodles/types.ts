// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** One Open Doodles drawing, split into its accent shape and its ink lines. */
export interface DoodleData {
  viewBox: string;
  /** The single highlight shape — painted in the community colour. */
  accent: string;
  /** Offset of the ink group in the original drawing. */
  inkTransform: string;
  /** The line work — painted in the page's text colour (light on dark). */
  ink: string[];
}
