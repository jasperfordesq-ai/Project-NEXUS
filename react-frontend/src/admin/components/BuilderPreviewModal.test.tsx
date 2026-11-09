// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { buildBuilderPreviewSrcDoc } from './BuilderPreviewModal';

describe('BuilderPreviewModal', () => {
  it('wraps builder preview HTML with the active dark theme tokens', () => {
    const srcDoc = buildBuilderPreviewSrcDoc('<section class="hero">Preview</section>', 'dark');

    expect(srcDoc).toContain('data-theme="dark"');
    expect(srcDoc).toContain('data-nexus-preview-theme="dark"');
    expect(srcDoc).toContain('--background:#0c0a09');
    expect(srcDoc).toContain('--foreground:#ededed');
    expect(srcDoc).toContain('<section class="hero">Preview</section>');
  });

  it('wraps builder preview HTML with the active light theme tokens', () => {
    const srcDoc = buildBuilderPreviewSrcDoc('<section>Preview</section>', 'light');

    expect(srcDoc).toContain('data-theme="light"');
    expect(srcDoc).toContain('--background:#fafaf9');
    expect(srcDoc).toContain('--foreground:#292524');
  });
});
