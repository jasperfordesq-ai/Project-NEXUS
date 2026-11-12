// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Your own thank-you notes page. Owner decision, 12 Nov 2026: the receiver
 * decides whether a note shows on their profile. So the page must list private
 * notes too, say which are showing, and let the member show, hide, remove and
 * report — and let them delete a note they sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 7, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
  })
);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ userId: '7' }),
    useNavigate: () => vi.fn(),
  };
});

// The report dialog has its own tests; here it only needs to open for the sender.
vi.mock('@/components/safety/ReportConcernModal', () => ({
  ReportConcernModal: ({ targetId, targetKind }: { targetId: number; targetKind: string }) => (
    <div data-testid="report-dialog" data-target={targetId} data-kind={targetKind} />
  ),
}));

import { api } from '@/lib/api';
import AppreciationWallPage from './AppreciationWallPage';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';

const note = (overrides = {}) => ({
  id: 1,
  sender_id: 10,
  receiver_id: 7,
  message: 'Thank you for the lift!',
  is_public: false,
  reactions_count: 0,
  created_at: '2026-11-01T12:00:00Z',
  sender: { id: 10, name: 'Alice', avatar_url: null },
  receiver: { id: 7, name: 'Test', avatar_url: null },
  my_reaction: null,
  ...overrides,
});

const renderWall = () => render(
  <ConfirmDialogProvider>
    <AppreciationWallPage />
  </ConfirmDialogProvider>,
);

describe('AppreciationWallPage — my own thank-you notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the notes I received, private ones included', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    renderWall();
    await waitFor(() => expect(screen.getByText('Thank you for the lift!')).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith('/v2/me/appreciations?tab=received&page=1');
  });

  it('says a private note is only visible to me, and offers no reactions on it', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    renderWall();
    await waitFor(() => expect(screen.getByTestId('thanks-status-1')).toHaveTextContent('Only you can see this'));
    expect(screen.queryByRole('button', { name: 'Heart' })).toBeNull();
  });

  it('shows a note on my profile when I choose to', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    vi.mocked(api.put).mockResolvedValueOnce({ success: true });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Show on my profile' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v2/appreciations/1/visibility', { is_public: true }));
    await waitFor(() => expect(screen.getByTestId('thanks-status-1')).toHaveTextContent('Shown on your profile'));
    expect(screen.getByRole('button', { name: 'Hide from my profile' })).toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalledWith('Now showing on your profile');
  });

  it('hides a note from my profile again', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note({ is_public: true })] });
    vi.mocked(api.put).mockResolvedValueOnce({ success: true });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide from my profile' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v2/appreciations/1/visibility', { is_public: false }));
    await waitFor(() => expect(screen.getByTestId('thanks-status-1')).toHaveTextContent('Only you can see this'));
  });

  it('leaves the note as it was when the server refuses', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    vi.mocked(api.put).mockResolvedValueOnce({ success: false, error: 'Not found' });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Show on my profile' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('That did not work. Please try again.'));
    expect(screen.getByTestId('thanks-status-1')).toHaveTextContent('Only you can see this');
  });

  it('removes a note only after I confirm', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    // Nothing is deleted until the question is answered.
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove note' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/appreciations/1'));
    await waitFor(() => expect(screen.queryByText('Thank you for the lift!')).not.toBeInTheDocument());
  });

  it('keeps the note when I change my mind', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep it' })).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Thank you for the lift!')).toBeInTheDocument();
  });

  it('lets me report the person who sent a note', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [note()] });
    renderWall();
    fireEvent.click(await screen.findByRole('button', { name: 'Report' }));

    const dialog = await screen.findByTestId('report-dialog');
    expect(dialog).toHaveAttribute('data-target', '10');
    expect(dialog).toHaveAttribute('data-kind', 'member');
  });

  it('lists the notes I sent on the second tab, named for who they went to', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: [note()] })
      .mockResolvedValueOnce({
        success: true,
        data: [note({ id: 9, sender_id: 7, receiver_id: 30, message: 'Cheers Sam', receiver: { id: 30, name: 'Sam', avatar_url: null } })],
      });
    renderWall();
    await waitFor(() => expect(screen.getByText('Thank you for the lift!')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Sent' }));

    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/v2/me/appreciations?tab=sent&page=1'));
    const card = await screen.findByTestId('thanks-note-9');
    expect(within(card).getByRole('link', { name: 'To Sam' })).toHaveAttribute('href', '/test/profile/30');
    // A sent note can be deleted, but it is not mine to show or hide.
    expect(within(card).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Show on my profile' })).toBeNull();
  });

  it('explains the empty page in plain words', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });
    renderWall();
    await waitFor(() => expect(screen.getByText('No thank-you notes yet')).toBeInTheDocument());
  });
});
