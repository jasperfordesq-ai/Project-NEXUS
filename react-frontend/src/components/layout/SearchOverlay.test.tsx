// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Safe storage (no-op in tests) ───────────────────────────────────────────
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGetJSON: vi.fn(() => []),
  safeLocalStorageSetJSON: vi.fn(),
  safeLocalStorageRemove: vi.fn(),
}));

// ─── Avatar (jsdom never loads images, so the photo is checked by its src) ──
vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ src, name }: { src?: string; name?: string }) => (
    <span data-testid="suggestion-avatar" data-src={src ?? ''} data-name={name ?? ''} />
  ),
}));

// ─── Toast / Auth / Tenant / Theme ───────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useTheme: () => ({
      resolvedTheme: 'light' as const,
      theme: 'system' as const,
      toggleTheme: vi.fn(),
      setTheme: vi.fn(),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub @/components/ui to avoid HeroUI jsdom issues ───────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  const KbdContent = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;
  const KbdComponent = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;
  const KbdWithContent = Object.assign(KbdComponent, { Content: KbdContent });
  return {
    ...orig,
    Button: ({ children, onPress, 'aria-label': al, isIconOnly: _io, ...rest }: { children?: React.ReactNode; onPress?: () => void; 'aria-label'?: string; isIconOnly?: boolean; [key: string]: unknown }) => (
      <button onClick={onPress} aria-label={al} {...(rest as Record<string, unknown>)}>{children}</button>
    ),
    Kbd: KbdWithContent,
  };
});

// ─── @react-aria/focus stub ──────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
describe('SearchOverlay — async search and activation', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: false, data: null });
  });

  it('renders no dialog when closed', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a named modal with a collapsed combobox when open', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox');
    const inputLabel = input.getAttribute('aria-label') ?? '';

    expect(screen.getByRole('dialog', { name: inputLabel })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
  });

  it('shows quick links by default', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('calls onClose from the explicit close button', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const closeButton = screen.getAllByRole('button').find(button =>
      button.getAttribute('aria-label')?.toLowerCase().includes('close'));

    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('exposes action mode as a labelled listbox controlled by the input', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '>' } });

    const listbox = await screen.findByRole('listbox');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('shows a busy state while fetching suggestions', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-busy', 'true');
      expect(screen.getAllByRole('status').some(status => status.getAttribute('aria-busy') === 'true')).toBe(true);
    }, { timeout: 1000 });
  });

  it('shows a member suggestion with their photo and first name only', async () => {
    // E-122 (owner, 11 Nov 2026): a member may be FOUND by surname, but the
    // suggestion shows their face and first name — never the surname.
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        listings: [],
        users: [{ id: 7, name: 'Mary', avatar_url: '/uploads/avatars/mary.jpg', type: 'user' }],
        events: [],
        groups: [],
      },
    });
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'murphy' } });

    const option = await screen.findByRole('option', { name: /mary/i }, { timeout: 1000 });
    expect(option.textContent).toContain('Mary');
    expect(option.textContent).not.toContain('Murphy');
    const photo = option.querySelector('[data-testid="suggestion-avatar"]');
    expect(photo?.getAttribute('data-src')).toContain('mary.jpg');
    expect(photo?.getAttribute('data-name')).toBe('Mary');
  });

  it('relates returned suggestions to the combobox', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        listings: [{ id: 10, title: 'Garden Help', type: 'listing' }],
        users: [],
        events: [],
        groups: [],
      },
    });
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'garden' } });

    const option = await screen.findByRole('option', { name: /garden help/i }, { timeout: 1000 });
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(option).toHaveAttribute('aria-selected', 'false');
  });

  it('updates aria-activedescendant and activates a suggestion with ArrowDown + Enter', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        listings: [{ id: 10, title: 'Garden Help', type: 'listing' }],
        users: [],
        events: [],
        groups: [],
      },
    });
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'garden' } });
    const option = await screen.findByRole('option', { name: /garden help/i }, { timeout: 1000 });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    expect(option).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('10'));
    expect(onClose).toHaveBeenCalled();
  });

  it('activates a suggestion by pointer', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        listings: [{ id: 10, title: 'Garden Help', type: 'listing' }],
        users: [],
        events: [],
        groups: [],
      },
    });
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'garden' } });

    fireEvent.click(await screen.findByRole('option', { name: /garden help/i }, { timeout: 1000 }));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('10'));
  });

  it('shows the no-results action when the API returns an empty collection', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { listings: [], users: [], events: [], groups: [] },
    });
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzznotfound' } });

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/zzznotfound/);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    }, { timeout: 1000 });
  });

  it('clears the query and returns focus to the combobox', async () => {
    const { SearchOverlay } = await import('./SearchOverlay');
    render(<SearchOverlay isOpen onClose={onClose} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'something' } });
    const clearButton = screen.getAllByRole('button').find(button =>
      button.getAttribute('aria-label')?.toLowerCase().includes('clear'));

    expect(clearButton).toBeDefined();
    fireEvent.click(clearButton!);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });
});
