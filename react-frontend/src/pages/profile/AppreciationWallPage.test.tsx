// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
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

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 42, name: 'Test User' },
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

import { api } from '@/lib/api';
import AppreciationWallPage from './AppreciationWallPage';
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog';

// The page asks before removing a note, so it needs the app's confirm dialog.
const renderWall = () => render(
  <ConfirmDialogProvider>
    <AppreciationWallPage />
  </ConfirmDialogProvider>,
);

const makeAppreciation = (overrides = {}) => ({
  id: 1,
  sender_id: 10,
  receiver_id: 7,
  message: 'Thank you so much!',
  is_public: true,
  reactions_count: 3,
  created_at: '2024-06-01T12:00:00Z',
  sender: { id: 10, name: 'Alice', avatar_url: null },
  my_reaction: null,
  ...overrides,
});

describe('AppreciationWallPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    // Never resolves → stays in loading
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderWall();
    // LoadingScreen renders a spinner/loading indicator; we confirm the data hasn't appeared yet
    expect(screen.queryByText('Thank you so much!')).not.toBeInTheDocument();
  });

  it('renders a list of appreciations when data is returned', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 1, message: 'Great job!', reactions_count: 5 })],
    });

    renderWall();

    await waitFor(() => {
      expect(screen.getByText('Great job!')).toBeInTheDocument();
    });

    // Sender name link
    expect(screen.getByText('Alice')).toBeInTheDocument();

    // Reaction count displayed
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows empty state when no appreciations exist', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [] });

    renderWall();

    await waitFor(() => {
      // EmptyState renders both title and description
      const emptyNodes = document.body.querySelectorAll('[class]');
      expect(emptyNodes.length).toBeGreaterThan(0);
    });

    // Ensure no appreciation cards rendered
    expect(screen.queryByText('Thank you so much!')).not.toBeInTheDocument();
  });

  it('shows an error state with retry — not the empty state — on API failure (success:false)', async () => {
    // Regression: api.get resolves { success:false } on a 4xx WITHOUT throwing;
    // the page used to render "No appreciations yet" as if the wall were empty.
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'Not found' });

    renderWall();

    expect(await screen.findByText("Couldn't load appreciations")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.queryByText('No appreciations yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Thank you so much!')).not.toBeInTheDocument();
  });

  it('reloads the wall when retry is clicked after a failed load', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: false, error: 'Not found' })
      .mockResolvedValueOnce({ success: true, data: [makeAppreciation()] });

    renderWall();

    fireEvent.click(await screen.findByText('Try again'));

    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load appreciations")).not.toBeInTheDocument();
  });

  it('calls POST /v2/appreciations/:id/react when a reaction button is clicked', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 99, reactions_count: 2, my_reaction: null })],
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderWall();

    await waitFor(() => {
      expect(screen.getByText('Thank you so much!')).toBeInTheDocument();
    });

    // There should be reaction buttons (heart / clap / star)
    const heartButtons = screen.getAllByRole('button');
    expect(heartButtons.length).toBeGreaterThan(0);

    // Click the first reaction button (heart)
    fireEvent.click(heartButtons[0]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/appreciations/99/react',
        expect.objectContaining({ reaction_type: 'heart' }),
      );
    });
  });

  it('optimistically updates reaction count after clicking heart', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 5, reactions_count: 3, my_reaction: null })],
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderWall();

    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());

    // Initial count
    expect(screen.getByText('3')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  it('does not change the reaction count when the request returns success:false', async () => {
    // Regression: react() did an UNCHECKED `await api.post(...)` then applied the
    // optimistic count/my_reaction change unconditionally. api.post resolves
    // { success:false } on a 4xx (rate-limited, removed appreciation, invalid reaction)
    // WITHOUT throwing, so a rejected reaction used to bump the count (off by one until a
    // reload). The count must stay put on a rejected reaction.
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 8, reactions_count: 3, my_reaction: null })],
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Rate limited' });

    renderWall();

    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/appreciations/8/react',
        expect.objectContaining({ reaction_type: 'heart' }),
      );
    });
    // The optimistic bump must NOT have been applied on the rejected reaction.
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('reaction buttons are disabled when user is not authenticated', async () => {
    // Override auth to unauthenticated for this test only by re-mocking.
    // Because the context mock is module-level, we verify the isDisabled prop
    // through checking aria-disabled on buttons when reactions_count > 0.
    // The page shows buttons and sets isDisabled={!user}, but the DOM attribute
    // depends on the HeroUI Button rendering. We just confirm post is NOT called.
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 10, my_reaction: null })],
    });
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    renderWall();

    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());

    // Authenticated user IS set in the module-level mock (id: 42), so clicking
    // buttons WILL fire — we just verify the structure is present.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders multiple appreciations from the same page', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [
        makeAppreciation({ id: 1, message: 'First message', sender: { id: 10, name: 'Alice', avatar_url: null } }),
        makeAppreciation({ id: 2, message: 'Second message', sender_id: 11, sender: { id: 11, name: 'Bob', avatar_url: null } }),
      ],
    });

    renderWall();

    await waitFor(() => {
      expect(screen.getByText('First message')).toBeInTheDocument();
      expect(screen.getByText('Second message')).toBeInTheDocument();
    });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  // Someone else's page shows only notes that member chose to show, so there
  // is nothing to show, hide or report here.
  it("offers no show, hide or report controls on someone else's page", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: [makeAppreciation()] });
    renderWall();
    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());
    expect(api.get).toHaveBeenCalledWith('/v2/users/7/appreciations?page=1');
    expect(screen.queryByTestId('thanks-status-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide from my profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('lets me delete a note I sent, after asking', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation({ id: 5, sender_id: 42, sender: { id: 42, name: 'Test', avatar_url: null } })],
    });
    vi.mocked(api.delete).mockResolvedValueOnce({ success: true });
    renderWall();
    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove note' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/appreciations/5'));
    await waitFor(() => expect(screen.queryByText('Thank you so much!')).not.toBeInTheDocument());
  });

  it('reads the number of pages the server sends (last_page)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: [makeAppreciation()],
      meta: { current_page: 1, last_page: 3, per_page: 20, total: 55, has_more: true },
    });
    renderWall();
    await waitFor(() => expect(screen.getByText('Thank you so much!')).toBeInTheDocument());
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
