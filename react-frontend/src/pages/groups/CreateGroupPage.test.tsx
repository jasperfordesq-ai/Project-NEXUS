// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CreateGroupPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    upload: vi.fn(),
  },
}));
import { api } from '@/lib/api';

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
const mockNavigate = vi.fn();
const mockConfirm = vi.fn(async () => true);
let routeId: string | undefined;

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => mockToast),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAssetUrl: vi.fn((url) => url || null),
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: routeId }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}));

vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

import { CreateGroupPage } from './CreateGroupPage';
import { colourForSeed, paletteFor } from '@/lib/categoryColours';

function fillValidForm() {
  fireEvent.change(
    screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...'),
    { target: { value: 'My Test Group' } },
  );
  fireEvent.change(
    screen.getByPlaceholderText('Describe what your group is about...'),
    { target: { value: 'A description of the new group, long enough to pass.' } },
  );
}

describe('CreateGroupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({ idx: 0 }, '', '/groups/create');
    routeId = undefined;
    api.get.mockImplementation(() => new Promise(() => {}));
    api.post.mockResolvedValue({ success: true, data: { id: 10 } });
    api.put.mockResolvedValue({ success: true, data: { id: 10 } });
    api.upload.mockResolvedValue({ success: true, data: { id: 10 } });
    mockConfirm.mockResolvedValue(true);
  });

  it('renders create group form heading', () => {
    render(<CreateGroupPage />);
    expect(screen.getByText("Create new group")).toBeInTheDocument();
  });

  it('renders group name input', () => {
    render(<CreateGroupPage />);
    expect(screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...')).toBeInTheDocument();
  });

  // Warmth phase 5: the form shows how the group will look, as it is typed.
  it('shows a live picture of the group card beside the form, updated as the member types', () => {
    render(<CreateGroupPage />);
    const preview = screen.getByTestId('group-preview');
    expect(preview).not.toHaveTextContent('Riverside walkers');

    fireEvent.change(screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...'), {
      target: { value: 'Riverside walkers' },
    });
    fireEvent.change(screen.getByPlaceholderText('Describe what your group is about...'), {
      target: { value: 'A gentle walk every Sunday morning.' },
    });

    expect(preview).toHaveTextContent('Riverside walkers');
    expect(preview).toHaveTextContent('A gentle walk every Sunday morning.');
    // No cover picture yet: the coloured cover and the nudge to add one.
    expect(screen.getByTestId('group-preview-cover')).toBeInTheDocument();
    expect(screen.getByTestId('group-preview-cover-nudge')).toBeInTheDocument();
  });

  it('renders group description textarea', () => {
    render(<CreateGroupPage />);
    expect(screen.getByPlaceholderText('Describe what your group is about...')).toBeInTheDocument();
  });

  it('renders private group toggle switch', () => {
    render(<CreateGroupPage />);
    // The switch displays "Public group" by default (is_private starts false)
    expect(screen.getAllByText("Public group").length).toBeGreaterThan(0);
  });

  it('renders submit button', () => {
    render(<CreateGroupPage />);
    expect(screen.getByText("Create group")).toBeInTheDocument();
  });

  it('renders cancel/back button', () => {
    render(<CreateGroupPage />);
    // Back button with ArrowLeft icon or cancel button
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('shows validation error for empty name on submit', async () => {
    render(<CreateGroupPage />);

    const submitButton = screen.getByText("Create group");
    fireEvent.submit(submitButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByText("Give your group a name")).toBeInTheDocument();
    });
  });

  it('renders image upload area', () => {
    render(<CreateGroupPage />);
    expect(screen.getAllByText('JPEG, PNG, GIF, or WebP. Max 8MB.')).toHaveLength(2);
  });

  it('fires only ONE create request when the form is submitted twice in rapid succession', async () => {
    // Regression: handleSubmit flipped isSubmitting state (which only toggles the
    // submit button's pending pointer-events) but the native <button type="submit">
    // stayed enabled, so a double-Enter / double-click submitted the native form
    // twice and created TWO duplicate groups before the state could flush. A
    // synchronous useRef re-entry guard now rejects the second submit. Live-verified
    // on the running app: a double requestSubmit() created two groups with the same
    // name before the fix (ids 90119 + 90120) and exactly one after.
    let resolveUpload: (v: { success: boolean; data: { id: number } }) => void = () => {};
    api.upload.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));

    const { container } = render(<CreateGroupPage />);
    fillValidForm();

    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.upload).toHaveBeenCalledTimes(1);

    resolveUpload({ success: true, data: { id: 10 } });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
  });

  it('does not navigate or show success when create resolves with success:false', async () => {
    api.upload.mockResolvedValue({
      success: false,
      code: 'HTTP_422',
      error: 'Raw validation copy',
    });
    const { container } = render(<CreateGroupPage />);
    fillValidForm();

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText('Raw validation copy')).not.toBeInTheDocument();
  });

  it('keeps the form in place when the atomic create upload fails', async () => {
    api.upload.mockResolvedValue({
      success: false,
      code: 'HTTP_500',
      error: 'Raw upload copy',
    });
    const { container } = render(<CreateGroupPage />);
    fillValidForm();
    const image = new File(['pixels'], 'group.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload group image'), {
      target: { files: [image] },
    });

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledWith('/v2/groups', expect.any(FormData));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText('Raw upload copy')).not.toBeInTheDocument();
  });

  // The live preview said "1 member" for every group, so editing a group of
  // 40 showed 1 (audit of warmth phase 5, 12 Nov 2026). A new group is just
  // its creator; an existing one shows its real count.
  it('shows the group\'s real member count in the preview when editing', async () => {
    routeId = '7';
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { id: 7, name: 'Existing Group', description: 'An existing description that is long enough.', visibility: 'public', location: '', member_count: 40 },
    });
    render(<CreateGroupPage />);

    await screen.findByDisplayValue('Existing Group');
    expect(screen.getByTestId('group-preview-members')).toHaveTextContent('40');
  });

  // The preview's cover used a fixed seed, so a group with no picture showed
  // a different colour from its card on the groups page (audit, 12 Nov 2026).
  it('colours the preview cover by the group being edited, as its card on the groups page', async () => {
    const palette = paletteFor(null);
    routeId = '7';
    expect(colourForSeed('7', palette)).not.toBe(colourForSeed('group-preview', palette));
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { id: 7, name: 'Existing Group', description: 'An existing description that is long enough.', visibility: 'public', location: '', member_count: 40 },
    });
    render(<CreateGroupPage />);

    await screen.findByDisplayValue('Existing Group');
    expect(screen.getByTestId('group-preview-cover')).toHaveAttribute('data-colour', colourForSeed(7, palette));
  });

  it('counts the creator as the one member of a new group in the preview', () => {
    render(<CreateGroupPage />);
    expect(screen.getByTestId('group-preview-members')).toHaveTextContent('1');
  });

  it('loads and updates an existing group through the edit contracts', async () => {
    routeId = '7';
    api.get.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        name: 'Existing Group',
        description: 'An existing description that is long enough.',
        visibility: 'public',
        location: 'Galway',
        latitude: 53.27,
        longitude: -9.06,
      },
    });
    api.upload.mockResolvedValue({ success: true, data: { id: 7 } });
    const { container } = render(<CreateGroupPage />);

    await screen.findByDisplayValue('Existing Group');
    expect(api.get).toHaveBeenCalledWith(
      '/v2/groups/7',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(api.upload).toHaveBeenCalledWith('/v2/groups/7/settings', expect.any(FormData)));
    const body = api.upload.mock.calls.find(([url]) => url === '/v2/groups/7/settings')?.[1] as FormData;
    expect(body.get('name')).toBe('Existing Group');
    expect(body.get('location')).toBe('Galway');
    expect(mockToast.success).toHaveBeenCalledWith('Group updated');
    expect(mockNavigate).toHaveBeenCalledWith('/test/groups/7');
  });

  it('guards sidebar and internal links when the form is dirty', async () => {
    mockConfirm.mockResolvedValue(false);
    render(<CreateGroupPage />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...'), {
      target: { value: 'Unsaved group' },
    });
    const link = document.createElement('a');
    link.href = '/test/groups';
    link.textContent = 'Sidebar groups';
    document.body.appendChild(link);

    fireEvent.click(link);
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValue(true);
    fireEvent.click(link);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/test/groups'));
    link.remove();
  });

  it('restores BrowserRouter Back before a cancelled discard and preserves values and URL', async () => {
    mockConfirm.mockResolvedValue(false);
    const historyGo = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    render(<CreateGroupPage />);
    const name = screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...');
    fireEvent.change(name, {
      target: { value: 'Unsaved group' },
    });

    const targetEvent = new PopStateEvent('popstate', { state: { idx: -1 } });
    const stopImmediate = vi.spyOn(targetEvent, 'stopImmediatePropagation');
    window.dispatchEvent(targetEvent);
    expect(historyGo).toHaveBeenCalledWith(1);
    expect(stopImmediate).toHaveBeenCalled();

    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 0 } }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(historyGo).toHaveBeenCalledTimes(1);
    expect(name).toHaveValue('Unsaved group');
    expect(window.location.pathname).toBe('/groups/create');
    historyGo.mockRestore();
  });

  it('replays the exact BrowserRouter Back delta only after discard confirmation', async () => {
    mockConfirm.mockResolvedValue(true);
    const historyGo = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    render(<CreateGroupPage />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Gardening Enthusiasts, Tech Help...'), {
      target: { value: 'Unsaved group' },
    });

    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: -1 } }));
    expect(historyGo).toHaveBeenNthCalledWith(1, 1);
    window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 0 } }));
    await waitFor(() => expect(historyGo).toHaveBeenNthCalledWith(2, -1));
    historyGo.mockRestore();
  });
});
