// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AiChatPage.
 *
 * The page was rebuilt on 18 Nov 2026 after the owner reported that sending a
 * message scrolled the page to the chat box instead of to the answer. The
 * scrolling tests below pin the cause: nothing on this page may call
 * scrollIntoView or scroll the window; only the conversation list moves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, userEvent, act } from '@/test/test-utils';

vi.mock('@/lib/api', () => {
  const api = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return {
    default: api,
    api,
    API_BASE: 'http://localhost:8090/api',
    tokenManager: {
      getAccessToken: vi.fn(() => 'test-token'),
      getTenantId: vi.fn(() => '2'),
      getCsrfToken: vi.fn(() => 'csrf-token'),
    },
  };
});

const { toastWarning, toastError } = vi.hoisted(() => ({ toastWarning: vi.fn(), toastError: vi.fn() }));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', last_name: 'User', avatar_url: null, avatar: null },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    hasFeature: vi.fn(() => true),
    tenantPath: (p: string) => (p.startsWith('/test/') ? p : `/test${p}`),
    tenant: { name: 'Test Timebank' },
  })),
  useToast: vi.fn(() => ({
    warning: toastWarning,
    error: toastError,
    success: vi.fn(),
  })),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import AiChatPage, { conversationStorageKey, readableError } from './AiChatPage';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';

const mockUseTenant = useTenant as unknown as ReturnType<typeof vi.fn>;
const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;

const scrollIntoViewSpy = vi.fn();
const elementScrollToSpy = vi.fn();
const windowScrollToSpy = vi.fn();

function answer(content: string, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      conversation_id: 42,
      message: { id: 10, role: 'assistant', content },
      trace_id: 99,
      limits: { daily_remaining: 9, monthly_remaining: 99 },
      ...extra,
    },
  };
}

function typeAndSend(text: string) {
  const box = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
  return box;
}

describe('AiChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;
    Element.prototype.scrollTo = elementScrollToSpy as unknown as typeof Element.prototype.scrollTo;
    window.scrollTo = windowScrollToSpy as unknown as typeof window.scrollTo;
    mockUseTenant.mockReturnValue({
      hasFeature: vi.fn(() => true),
      tenantPath: (p: string) => (p.startsWith('/test/') ? p : `/test${p}`),
      tenant: { name: 'Test Timebank' },
    });
    mockApiGet.mockImplementation(async (url: string) => {
      if (url === '/ai/chat/starters') return { success: true, data: { starters: ['How do I offer a skill?'] } };
      return { success: false, error: 'not found' };
    });
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('greets the member by first name and names the community', async () => {
    render(<AiChatPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'AI Assistant' })).toBeInTheDocument();
    expect(screen.getByText('Here to help with Test Timebank')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Hi Test, how can I help?' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'How do I offer a skill?' })).toBeInTheDocument();
  });

  it('shows the not-available message when the feature is off', () => {
    mockUseTenant.mockReturnValue({
      hasFeature: vi.fn(() => false),
      tenantPath: (p: string) => `/test${p}`,
      tenant: { name: 'Test Timebank' },
    });
    render(<AiChatPage />);
    expect(screen.getByText('AI Assistant Not Available')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps the send button off until something is typed', () => {
    render(<AiChatPage />);
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello' } });
    expect(send).not.toBeDisabled();
  });

  it('sends the question and shows the answer formatted, with links kept in the app', async () => {
    mockApiPost.mockResolvedValueOnce(answer('Go to **Offers** then [create a listing](/listings/create).'));
    render(<AiChatPage />);

    typeAndSend('How do I offer a skill?');

    expect(mockApiPost).toHaveBeenCalledWith('/ai/chat', { message: 'How do I offer a skill?' });
    // The question is on screen straight away.
    expect(screen.getByText('How do I offer a skill?')).toBeInTheDocument();

    const bold = await screen.findByText('Offers');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();

    const link = screen.getByRole('link', { name: 'create a listing' });
    expect(link).toHaveAttribute('href', '/test/listings/create');
    expect(link).not.toHaveAttribute('target');
  });

  it('never scrolls the page when a question is sent or answered (owner report, 18 Nov 2026)', async () => {
    mockApiPost.mockResolvedValueOnce(answer('A plain answer.'));
    render(<AiChatPage />);

    typeAndSend('Where is the answer?');
    expect(await screen.findByText('A plain answer.')).toBeInTheDocument();

    // The bug: scrollIntoView scrolled the whole page to the typing box.
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(windowScrollToSpy).not.toHaveBeenCalled();
    // Only the conversation list itself is scrolled.
    expect(elementScrollToSpy).toHaveBeenCalled();
    const scrolled = elementScrollToSpy.mock.contexts.map((ctx) => (ctx as HTMLElement).getAttribute('data-chat-scroll'));
    expect(scrolled.every((value) => value === '')).toBe(true);
  });

  it('keeps the typing box usable while waiting and does not send twice', async () => {
    let resolveAnswer: (value: unknown) => void = () => {};
    mockApiPost.mockImplementationOnce(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    render(<AiChatPage />);

    const box = typeAndSend('First question');
    expect(await screen.findByText('Thinking...')).toBeInTheDocument();
    expect(box).not.toBeDisabled();

    // Enter again while the first answer is on its way does nothing.
    fireEvent.change(box, { target: { value: 'Second question' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    await act(async () => {
      resolveAnswer(answer('Done.'));
    });
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
    // The second question is still in the box, ready to send.
    expect(box).toHaveValue('Second question');
  });

  it('continues the same conversation on the next question', async () => {
    mockApiPost.mockResolvedValueOnce(answer('One.')).mockResolvedValueOnce(answer('Two.'));
    render(<AiChatPage />);
    typeAndSend('Q1');
    await screen.findByText('One.');
    typeAndSend('Q2');
    await screen.findByText('Two.');
    expect(mockApiPost).toHaveBeenLastCalledWith('/ai/chat', { message: 'Q2', conversation_id: 42 });
  });

  it('does not crash when an error arrives as an object, and Try again resends the same question', async () => {
    mockApiPost
      .mockResolvedValueOnce({ success: false, error: { code: 'SERVER_ERROR', message: 'boom' }, data: { error: { code: 'X' } } })
      .mockResolvedValueOnce(answer('Recovered answer.'));
    render(<AiChatPage />);

    typeAndSend('Will this work?');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText("That didn't work. Please try again.")).toBeInTheDocument();

    await userEvent.click(retry);

    expect(await screen.findByText('Recovered answer.')).toBeInTheDocument();
    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(mockApiPost).toHaveBeenLastCalledWith('/ai/chat', { message: 'Will this work?' });
    // The question is not added a second time, and the error is gone.
    expect(screen.getAllByText('Will this work?')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the usage-limit message on a 429', async () => {
    mockApiPost.mockResolvedValueOnce({ success: false, code: 'HTTP_429', error: 'Too many' });
    render(<AiChatPage />);
    typeAndSend('Hello');
    expect(await screen.findByText('You have reached your usage limit for now. Please try again later.')).toBeInTheDocument();
    expect(toastWarning).toHaveBeenCalledWith('Usage limit reached');
  });

  it('shows a connection message when the request fails outright', async () => {
    mockApiPost.mockRejectedValueOnce(new Error('Connection refused'));
    render(<AiChatPage />);
    typeAndSend('Hello');
    expect(await screen.findByText("We can't connect. Check your internet connection and try again.")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("We can't connect right now");
  });

  it('remembers the conversation for this tab and reopens it on return', async () => {
    mockApiPost.mockResolvedValueOnce(answer('Remembered.'));
    const { unmount } = render(<AiChatPage />);
    typeAndSend('Remember me');
    await screen.findByText('Remembered.');
    expect(window.sessionStorage.getItem(conversationStorageKey(1))).toBe('42');
    unmount();

    mockApiGet.mockImplementation(async (url: string) => {
      if (url === '/ai/conversations/42') {
        return {
          success: true,
          data: {
            id: 42,
            messages: [
              { id: 1, role: 'user', content: 'Remember me', created_at: '2026-11-18 10:00:00' },
              { id: 2, role: 'assistant', content: 'Remembered.', created_at: '2026-11-18 10:00:05' },
            ],
          },
        };
      }
      return { success: true, data: { starters: [] } };
    });
    render(<AiChatPage />);
    expect(await screen.findByText('Remembered.')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith('/ai/conversations/42');
  });

  it('forgets a remembered conversation that can no longer be opened', async () => {
    window.sessionStorage.setItem(conversationStorageKey(1), '77');
    render(<AiChatPage />);
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith('/ai/conversations/77'));
    await waitFor(() => expect(window.sessionStorage.getItem(conversationStorageKey(1))).toBeNull());
    expect(await screen.findByRole('heading', { level: 2, name: 'Hi Test, how can I help?' })).toBeInTheDocument();
  });

  it('starts a new conversation and forgets the old one', async () => {
    mockApiPost.mockResolvedValueOnce(answer('Old answer.'));
    render(<AiChatPage />);
    typeAndSend('Old question');
    await screen.findByText('Old answer.');

    await userEvent.click(screen.getByRole('button', { name: 'Start new conversation' }));

    expect(screen.queryByText('Old answer.')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(conversationStorageKey(1))).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Hi Test, how can I help?' })).toBeInTheDocument();
  });

  it('copies the answer as plain text', async () => {
    mockApiPost.mockResolvedValueOnce(answer('Press **Publish** now.'));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<AiChatPage />);
    typeAndSend('How?');
    await screen.findByText('Publish');

    await user.click(screen.getByRole('button', { name: 'Copy answer' }));

    expect(writeText).toHaveBeenCalledWith('Press Publish now.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('sends a starter question when it is pressed', async () => {
    mockApiPost.mockResolvedValueOnce(answer('Like this.'));
    render(<AiChatPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'How do I offer a skill?' }));
    expect(mockApiPost).toHaveBeenCalledWith('/ai/chat', { message: 'How do I offer a skill?' });
    expect(await screen.findByText('Like this.')).toBeInTheDocument();
  });

  it('marks a thumbs-up vote as pressed', async () => {
    mockApiPost
      .mockResolvedValueOnce(answer('Helpful?'))
      .mockResolvedValueOnce({ success: true, data: { recorded: true } });
    render(<AiChatPage />);
    typeAndSend('Q');
    await screen.findByText('Helpful?');

    const up = screen.getByRole('button', { name: 'Helpful answer' });
    expect(up).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(mockApiPost).toHaveBeenLastCalledWith('/ai/chat/feedback', { feedback: 'up', trace_id: 99, message_id: 10 });
  });
});

describe('readableError', () => {
  it('accepts only non-empty text', () => {
    expect(readableError('Nope')).toBe('Nope');
    expect(readableError('  ')).toBeNull();
    expect(readableError({ code: 'X' })).toBeNull();
    expect(readableError(undefined)).toBeNull();
  });
});
