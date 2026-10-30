// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner check of Admin → Translation settings (30 Oct 2026): "Enable
 * translation" was saved and read by nothing. A community that switched it off
 * still showed Translate buttons everywhere.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test', features: {}, translation: { enabled: false, auto_translate_default: false, provider: 'openai' } },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
} as unknown as Parameters<typeof createMockContexts>[0]));

import { TranslateButton } from '../TranslateButton';

describe('TranslateButton when the community switched translation off', () => {
  it('shows no Translate button', () => {
    render(<TranslateButton contentType="listing" contentId="1" sourceText="Bonjour le monde" sourceLocale="fr" />);
    expect(screen.queryByRole('button', { name: /translate/i })).not.toBeInTheDocument();
  });
});
