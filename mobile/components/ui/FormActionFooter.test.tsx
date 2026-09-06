// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The disabled submit button must stay readable.
 *
 * This footer painted its own fill — `theme.border` when disabled, the tenant colour
 * otherwise — while HeroUI kept choosing the LABEL colour for the accent it thought it was
 * painting. The two came apart: on the emulator (2026-09-05) the disabled "Save changes"
 * was near-black on dark grey in dark mode and white on pale grey in light. Eleven forms
 * use this footer, so the fault was on every one of them.
 *
 * The fix is to own neither: `variant="primary"` paints the fill and picks the label. This
 * test fails if anyone reintroduces a `backgroundColor` on the submit button.
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(path.join(__dirname, 'FormActionFooter.tsx'), 'utf8');

describe('FormActionFooter', () => {
  it('never paints the submit button background itself', () => {
    // Not a regex over the whole file: the explanatory comment mentions the old code.
    const code = SOURCE.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

    expect(code).not.toContain('backgroundColor');
  });

  it('still exposes isDisabled, so a form can refuse a submit without repainting anything', () => {
    expect(SOURCE).toContain('isDisabled');
    expect(SOURCE).toContain('isDisabled={isSubmitting || isDisabled}');
  });

  it('keeps the submit label beside the spinner rather than replacing it', () => {
    // A spinner alone leaves a sighted member looking at an anonymous pill mid-action.
    expect(SOURCE).toContain('<HeroButton.Label numberOfLines={1}>{submitLabel}</HeroButton.Label>');
  });
});
