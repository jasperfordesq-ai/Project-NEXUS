// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  api: { get: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());
// Breadcrumbs imports useTenant from the concrete module, not the barrel.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    hasFeature: () => true,
    hasModule: () => true,
    isLoading: false,
  }),
}));

const mockNavigate = vi.fn();
let mockParams: Record<string, string | undefined> = { childId: '42' };
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}));

import { api } from '@/lib/api';
import { SupportedMessagesPage } from './SupportedMessagesPage';

const mockedGet = vi.mocked(api.get);

describe('SupportedMessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockParams = { childId: '42' };
  });

  /** 🔴 The purpose dialog is the front door: nothing fetches without it. */
  it('fetches nothing until a purpose is given, then sends it on the request', async () => {
    mockedGet.mockResolvedValue({ success: true, data: { conversations: [] } } as never);

    render(<SupportedMessagesPage />);

    expect(screen.getByText('Why do you need to look?')).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalled();
    });

    // 🔴 The purpose travels in a HEADER and must NOT appear in the URL: it can
    // quote a safeguarding concern about a named person, and URLs reach access
    // logs, browser history, `Referer` headers and shared screenshots.
    const [url, options] = mockedGet.mock.calls[0] ?? [];
    expect(String(url)).toBe('/v2/users/me/sub-accounts/42/messages');
    expect(String(url)).not.toContain('purpose');

    // The default reason still travels into the audit purpose — RFC 8187
    // encoded.
    //
    // 🔴 This assertion used to compare the RAW string, which passes against a
    // mocked api.get and fails against the real one: header values are bytes,
    // and `fetch()` throws "Cannot convert argument to a ByteString" for the
    // curly apostrophe in this very sentence. The page therefore never made
    // the request, the member was told the permission may have been withdrawn,
    // and nothing was audited. Asserting the DECODED value keeps the intent
    // (the reason reaches the audit trail) while pinning the encoding.
    const headers = (options as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    const sent = headers['X-Message-View-Purpose'] ?? '';
    expect(sent.startsWith("UTF-8''")).toBe(true);
    expect(() => new Headers({ 'X-Message-View-Purpose': sent })).not.toThrow();
    expect(decodeURIComponent(sent.slice(7))).toContain('Checking they’re okay');

    // A signal is required, not incidental: api.get keys its in-flight cache on
    // method + URL + tenant only, so without one two reads with different
    // purposes would share a request and one would go unaudited.
    expect((options as { signal?: AbortSignal } | undefined)?.signal).toBeDefined();
  });

  it('remembers the purpose for the session and renders the real conversation-row shape', async () => {
    sessionStorage.setItem('nexus_msg_view_purpose_42', 'Weekly check');
    // The REAL shape from MessageService::getConversations: partner data lives
    // in `other_user`, the preview in `last_message.body` — both sub-objects.
    // Rendering them directly as children is the crash this pins against.
    mockedGet.mockResolvedValue({
      success: true,
      data: { conversations: [{
        partner_id: 7,
        other_user: { id: 7, name: 'Petra Partner', first_name: 'Petra', last_name: 'Partner', avatar_url: null },
        last_message: { body: 'See you at ten', created_at: '2026-08-01T10:00:00Z' },
        created_at: '2026-08-01T10:00:00Z',
      }] },
    } as never);

    render(<SupportedMessagesPage />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(screen.queryByText('Why do you need to look?')).not.toBeInTheDocument();
    expect(await screen.findByText('Petra Partner')).toBeInTheDocument();
    expect(screen.getByText('See you at ten')).toBeInTheDocument();
  });

  /** Read-only IS the page: no composer, no reactions, nothing sendable. */
  it('renders a thread with no composer and no action affordances', async () => {
    sessionStorage.setItem('nexus_msg_view_purpose_42', 'Safety check');
    mockParams = { childId: '42', partnerId: '7' };
    mockedGet.mockResolvedValue({
      success: true,
      data: { items: [
        { id: 1, sender_id: 42, receiver_id: 7, body: 'From the member', created_at: '2026-08-01T10:00:00Z' },
        { id: 2, sender_id: 7, receiver_id: 42, body: 'From the partner', created_at: '2026-08-01T11:00:00Z', sender: { id: 7, first_name: 'Petra', last_name: 'Partner' } },
      ] },
    } as never);

    const { container } = render(<SupportedMessagesPage />);

    expect(await screen.findByText('From the member')).toBeInTheDocument();
    expect(screen.getByText('From the partner')).toBeInTheDocument();
    expect(screen.getByTestId('supported-messages-banner')).toBeInTheDocument();
    // No input of any kind exists on this page (the purpose dialog is closed).
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('says plainly when access was withdrawn instead of showing an empty page', async () => {
    sessionStorage.setItem('nexus_msg_view_purpose_42', 'Check');
    mockedGet.mockResolvedValue({ success: false, error: 'You do not have permission to do this for that account' } as never);

    render(<SupportedMessagesPage />);

    expect(await screen.findByTestId('supported-messages-denied')).toHaveTextContent(
      'You do not have permission to do this for that account',
    );
  });

  it('preserves the cursor and appends the next page of conversations', async () => {
    sessionStorage.setItem('nexus_msg_view_purpose_42', 'Check');
    mockedGet
      .mockResolvedValueOnce({ success: true, data: {
        conversations: [{ partner_id: 7, other_user: { id: 7, name: 'First Person' }, last_message: { body: 'First' } }],
        cursor: 'next-20',
        has_more: true,
      } } as never)
      .mockResolvedValueOnce({ success: true, data: {
        conversations: [{ partner_id: 8, other_user: { id: 8, name: 'Twenty First Person' }, last_message: { body: 'Next' } }],
        cursor: null,
        has_more: false,
      } } as never);

    render(<SupportedMessagesPage />);
    expect(await screen.findByText('First Person')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(await screen.findByText('Twenty First Person')).toBeInTheDocument();
    expect(String(mockedGet.mock.calls[1]?.[0])).toContain('cursor=next-20');
  });
});
