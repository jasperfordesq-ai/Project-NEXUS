// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { DEFAULT_SETTINGS, type SettingsForm } from '../settingsForm';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { HeaderColorsSection } from './HeaderColorsSection';

function stateWith(form: Partial<SettingsForm>): AdminSettingsFormState {
  return { form: { ...DEFAULT_SETTINGS, ...form }, setField: vi.fn() } as unknown as AdminSettingsFormState;
}

function previewBar(): HTMLElement {
  return screen.getByTestId('header-colour-preview').firstElementChild as HTMLElement;
}

// Since 10 Nov 2026 the accessible site draws its header line in the community
// colour when no header colour is chosen; the preview has to show that line.
describe('HeaderColorsSection preview', () => {
  it('draws the line in the community colour when no header colour is chosen', () => {
    render(<HeaderColorsSection state={stateWith({ community_color: '#c2185b' })} />);
    expect(previewBar().style.borderBottom).toBe('8px solid rgb(194, 24, 91)');
    // The bar itself stays the standard near-black.
    expect(previewBar().style.backgroundColor).toBe('rgb(11, 12, 12)');
  });

  it('keeps the chosen header colours ahead of the community colour', () => {
    render(<HeaderColorsSection state={stateWith({ community_color: '#c2185b', header_bg_color: '#5b2a86' })} />);
    expect(previewBar().style.borderBottom).toBe('8px solid rgb(91, 42, 134)');
  });

  it('shows the standard blue line for a community with no colours at all', () => {
    render(<HeaderColorsSection state={stateWith({})} />);
    expect(previewBar().style.borderBottom).toBe('8px solid rgb(29, 112, 184)');
  });
});
