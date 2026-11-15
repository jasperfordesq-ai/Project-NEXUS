// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { DEFAULT_SETTINGS, settingsFromResponse, type SettingsForm } from '../settingsForm';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { DefaultThemeSection } from './DefaultThemeSection';

function stateWith(form: Partial<SettingsForm>, setField = vi.fn()): AdminSettingsFormState {
  return { form: { ...DEFAULT_SETTINGS, ...form }, setField } as unknown as AdminSettingsFormState;
}

const radio = (name: string) => within(screen.getByTestId(`default-theme-${name}`)).getByRole('radio');

describe('DefaultThemeSection (light or dark to start with)', () => {
  it('offers light, dark and the visitor’s device, with light chosen until an admin changes it', () => {
    render(<DefaultThemeSection state={stateWith({})} />);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(radio('light')).toBeChecked();
    expect(radio('dark')).not.toBeChecked();
    expect(radio('system')).not.toBeChecked();
    // The group is named by the section's heading.
    expect(screen.getByRole('radiogroup', { name: 'Light or dark to start with' })).toBeInTheDocument();
  });

  it('shows the saved choice', () => {
    render(<DefaultThemeSection state={stateWith({ default_theme: 'system' })} />);
    expect(radio('system')).toBeChecked();
    expect(radio('light')).not.toBeChecked();
  });

  it('records the admin’s choice on the form', () => {
    const setField = vi.fn();
    const { rerender } = render(<DefaultThemeSection state={stateWith({}, setField)} />);

    fireEvent.click(radio('dark'));
    expect(setField).toHaveBeenCalledWith('default_theme', 'dark');

    rerender(<DefaultThemeSection state={stateWith({ default_theme: 'dark' }, setField)} />);
    fireEvent.click(radio('system'));
    expect(setField).toHaveBeenCalledWith('default_theme', 'system');

    rerender(<DefaultThemeSection state={stateWith({ default_theme: 'system' }, setField)} />);
    fireEvent.click(radio('light'));
    expect(setField).toHaveBeenCalledWith('default_theme', 'light');
  });

  it('says who the choice is for, that anyone can switch, and what dark costs older eyes', () => {
    render(<DefaultThemeSection state={stateWith({})} />);

    expect(screen.getByText(/has not chosen for themselves/)).toBeInTheDocument();
    expect(screen.getByText(/Anyone can still switch/)).toBeInTheDocument();
    expect(screen.getByText(/older members especially, find it harder to read/)).toBeInTheDocument();
    expect(screen.getByText(/accessible site is always light, and the phone app follows the phone/)).toBeInTheDocument();
    // No wording key left unfilled.
    expect(screen.queryByText(/default_theme_|\{\{/)).toBeNull();
  });

  it('treats a stored value that is not one of the three as light', () => {
    render(<DefaultThemeSection state={stateWith({ default_theme: 'sepia' })} />);
    expect(radio('light')).toBeChecked();
  });
});

describe('settings form: default_theme', () => {
  it('reads the server’s value, and is light when the server says nothing or something else', () => {
    expect(settingsFromResponse({ settings: { default_theme: 'dark' } } as never).default_theme).toBe('dark');
    expect(settingsFromResponse({ settings: { default_theme: 'system' } } as never).default_theme).toBe('system');
    expect(settingsFromResponse({ settings: {} } as never).default_theme).toBe('light');
    expect(settingsFromResponse({ settings: { default_theme: 'sepia' } } as never).default_theme).toBe('light');
    expect(DEFAULT_SETTINGS.default_theme).toBe('light');
  });
});
