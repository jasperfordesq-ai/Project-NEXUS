// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { AdminSettingsFormState } from '../settings/useAdminSettingsForm';

const { branding } = vi.hoisted(() => ({
  branding: { name: 'Hour Timebank', app_icon_url: undefined as string | undefined },
}));

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding,
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { AppIconSection } from './AppIconSection';

function stateWith(overrides: Partial<AdminSettingsFormState> = {}): AdminSettingsFormState {
  return {
    uploading: { app_icon: false },
    upload: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  } as unknown as AdminSettingsFormState;
}

describe('AppIconSection', () => {
  beforeEach(() => {
    branding.app_icon_url = undefined;
  });

  it('explains what the icon is for and what happens without one', () => {
    render(<AppIconSection state={stateWith()} />);

    expect(screen.getByRole('heading', { name: 'App icon' })).toBeInTheDocument();
    expect(screen.getByText(/home screen/i)).toBeInTheDocument();
    expect(screen.getByText(/without one, phones show the standard icon/i)).toBeInTheDocument();
    expect(screen.getByText(/square.*at least 512 × 512 pixels/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });

  it('accepts raster pictures only, never SVG', () => {
    render(<AppIconSection state={stateWith()} />);
    const input = screen.getByTestId('logo-input-app-icon') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/webp');
  });

  it('sends a chosen picture to the app icon slot', () => {
    const upload = vi.fn();
    render(<AppIconSection state={stateWith({ upload })} />);

    const file = new File(['x'], 'icon.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('logo-input-app-icon'), { target: { files: [file] } });
    expect(upload).toHaveBeenCalledWith('app_icon', file);
  });

  it('shows the current icon and can remove it', () => {
    branding.app_icon_url = '/uploads/tenants/test/app-icons/icon.png';
    const remove = vi.fn();
    render(<AppIconSection state={stateWith({ remove })} />);

    expect(screen.getByTestId('app-icon-preview').getAttribute('src')).toContain('app-icons/icon.png');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(remove).toHaveBeenCalledWith('app_icon');
  });

  it('never shows an address that is not an uploaded picture', () => {
    branding.app_icon_url = 'javascript:alert(1)//.png';
    render(<AppIconSection state={stateWith()} />);

    expect(screen.queryByTestId('app-icon-preview')).toBeNull();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });
});
