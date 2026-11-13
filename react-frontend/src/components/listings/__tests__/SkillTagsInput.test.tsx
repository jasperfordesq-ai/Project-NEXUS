// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SkillTagsInput component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { SkillTagsInput } from '../SkillTagsInput';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

describe('SkillTagsInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><SkillTagsInput tags={[]} onChange={vi.fn()} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('displays "Skill tags" label', () => {
    render(<W><SkillTagsInput tags={[]} onChange={vi.fn()} /></W>);
    expect(screen.getByText(/Skill tags/)).toBeInTheDocument();
  });

  it('shows tag count indicator', () => {
    render(<W><SkillTagsInput tags={['react', 'typescript']} onChange={vi.fn()} /></W>);
    expect(screen.getByText('(2/10)')).toBeInTheDocument();
  });

  it('renders existing tags as chips', () => {
    render(
      <W><SkillTagsInput tags={['react', 'node']} onChange={vi.fn()} /></W>,
    );
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('node')).toBeInTheDocument();
  });

  it('renders input field with placeholder', () => {
    render(<W><SkillTagsInput tags={[]} onChange={vi.fn()} /></W>);
    expect(screen.getByPlaceholderText('Type a skill and press Enter...')).toBeInTheDocument();
  });

  it('calls onChange when Enter is pressed with a value', () => {
    const onChange = vi.fn();
    render(<W><SkillTagsInput tags={[]} onChange={onChange} /></W>);
    const input = screen.getByPlaceholderText('Type a skill and press Enter...');
    fireEvent.change(input, { target: { value: 'javascript' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['javascript']);
  });

  it('adds tag on comma key press', () => {
    const onChange = vi.fn();
    render(<W><SkillTagsInput tags={[]} onChange={onChange} /></W>);
    const input = screen.getByPlaceholderText('Type a skill and press Enter...');
    fireEvent.change(input, { target: { value: 'css' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['css']);
  });

  it('does not add duplicate tags', () => {
    const onChange = vi.fn();
    render(<W><SkillTagsInput tags={['react']} onChange={onChange} /></W>);
    const input = screen.getByPlaceholderText('Type a skill and press Enter...');
    fireEvent.change(input, { target: { value: 'React' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hides input when max tags reached', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `skill${i}`);
    render(<W><SkillTagsInput tags={tags} onChange={vi.fn()} maxTags={10} /></W>);
    expect(screen.queryByPlaceholderText('Type a skill and press Enter...')).not.toBeInTheDocument();
  });

  it('uses custom maxTags', () => {
    render(<W><SkillTagsInput tags={['a', 'b']} onChange={vi.fn()} maxTags={5} /></W>);
    expect(screen.getByText('(2/5)')).toBeInTheDocument();
  });

  it('removes last tag on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<W><SkillTagsInput tags={['react', 'node']} onChange={onChange} /></W>);
    const input = screen.getByPlaceholderText('Type a skill and press Enter...');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['react']);
  });
});
