// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { normalizeGroupApiError } from '../api/core';

const {
  mockAcceptAnswer,
  mockAskQuestion,
  mockGetQuestion,
  mockListQuestions,
  mockPostAnswer,
  mockVote,
} = vi.hoisted(() => ({
  mockAcceptAnswer: vi.fn(),
  mockAskQuestion: vi.fn(),
  mockGetQuestion: vi.fn(),
  mockListQuestions: vi.fn(),
  mockPostAnswer: vi.fn(),
  mockVote: vi.fn(),
}));

vi.mock('../api/qa', () => ({
  acceptGroupAnswer: mockAcceptAnswer,
  askGroupQuestion: mockAskQuestion,
  getGroupQuestion: mockGetQuestion,
  listGroupQuestions: mockListQuestions,
  postGroupAnswer: mockPostAnswer,
  voteOnGroupQA: mockVote,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description && <p>{description}</p>}
    </div>
  ),
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

const makeQuestion = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  group_id: 10,
  title: 'How does timebanking work?',
  body: 'Please explain',
  vote_count: 3,
  user_vote: 0 as const,
  answer_count: 1,
  has_accepted_answer: false,
  author: { id: 5, name: 'Alice', avatar: null },
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

const makeAnswer = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  question_id: 1,
  body: 'Great question! It works like this...',
  vote_count: 1,
  user_vote: 0 as const,
  is_accepted: false,
  author: { id: 6, name: 'Bob', avatar: null },
  created_at: '2026-01-02T10:00:00Z',
  ...overrides,
});

const makeDetail = (overrides: Record<string, unknown> = {}) => ({
  ...makeQuestion(),
  answers: [makeAnswer()],
  ...overrides,
});

const makeListPage = (items: object[] = [], extra: Record<string, unknown> = {}) => ({
  items,
  cursor: null,
  has_more: false,
  ...extra,
});

describe('GroupQATab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListQuestions.mockResolvedValue(makeListPage());
    mockAskQuestion.mockResolvedValue({ id: 1, title: 'How does timebanking work?' });
    mockPostAnswer.mockResolvedValue({ id: 101, question_id: 1 });
    mockGetQuestion.mockResolvedValue(makeDetail());
    mockVote.mockResolvedValue(undefined);
    mockAcceptAnswer.mockResolvedValue(undefined);
  });

  it('shows loading then the truthful empty state', async () => {
    let resolveList!: (value: ReturnType<typeof makeListPage>) => void;
    mockListQuestions.mockImplementationOnce(() => new Promise((resolve) => {
      resolveList = resolve;
    }));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} />);

    expect(screen.getByRole('status', { name: 'Loading questions' })).toBeInTheDocument();
    resolveList(makeListPage());
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });

  it('sanitizes scripts, event handlers, and javascript URLs in questions and answers', async () => {
    const malicious = '<script>window.__qaXss=1</script><img src=x onerror="window.__qaXss=2"><a href="javascript:alert(1)" onclick="alert(2)">Safe Q&A content</a>';
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    mockGetQuestion.mockResolvedValue(makeDetail({
      body: malicious,
      answers: [makeAnswer({ body: malicious })],
    }));
    const { GroupQATab } = await import('./GroupQATab');
    const { container } = render(<GroupQATab groupId={10} isAdmin={false} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    expect((await screen.findAllByText('Safe Q&A content', { exact: true })).length).toBe(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror], [onclick]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect((window as typeof window & { __qaXss?: number }).__qaXss).toBeUndefined();
  });

  it('renders question controls without nesting interactive buttons', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    const { GroupQATab } = await import('./GroupQATab');
    const { rerender } = render(
      <GroupQATab groupId={10} isAdmin={false} isMember={true} />,
    );

    const toggle = await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    });
    const upvote = screen.getByRole('button', { name: 'Upvote' });
    expect(toggle).not.toContainElement(upvote);
    expect(toggle.querySelector('button')).toBeNull();
    expect(toggle).toHaveAttribute('aria-controls', 'group-question-1-detail');
    expect(upvote).toHaveClass('min-h-11', 'min-w-11');
    expect(screen.getByText('Alice')).toBeInTheDocument();
    rerender(<GroupQATab groupId={10} isAdmin={false} isMember={false} />);
    expect(screen.getByRole('button', { name: 'Upvote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Downvote' })).toBeDisabled();
  });

  it('labels the expanded question region and shows a clear no-answers state', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion({ answer_count: 0 })]));
    mockGetQuestion.mockResolvedValue(makeDetail({ answers: [], answer_count: 0 }));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));

    expect(await screen.findByRole('region', { name: 'How does timebanking work?' })).toBeInTheDocument();
    expect(screen.getByText('No answers yet')).toHaveAttribute('role', 'status');
  });

  it('renders and retries a list error instead of showing an empty state', async () => {
    mockListQuestions
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeListPage([makeQuestion()]));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load that question.");
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('How does timebanking work?')).toBeInTheDocument();
  });

  it('passes debounced search text through the adapter', async () => {
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} />);
    await screen.findByTestId('empty-state');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions' }), {
      target: { value: 'time credits' },
    });

    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ query: 'time credits', sort: 'newest' }),
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ query: '', sort: 'newest' }),
    ));
  });

  it('maps sort tabs and cursor-based load more', async () => {
    mockListQuestions
      .mockResolvedValueOnce(makeListPage([makeQuestion()], { cursor: 'next', has_more: true }))
      .mockResolvedValueOnce(makeListPage([makeQuestion({ id: 2, title: 'Second question' })]));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} />);

    await screen.findByText('How does timebanking work?');
    fireEvent.click(screen.getByRole('button', { name: "Load more" }));
    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ cursor: 'next', sort: 'newest' }),
    ));
    expect(await screen.findByText('Second question')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: "Most voted" }));
    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ sort: 'most_voted' }),
    ));
    fireEvent.click(screen.getByRole('tab', { name: 'Unanswered' }));
    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ sort: 'unanswered' }),
    ));
    fireEvent.click(screen.getByRole('tab', { name: 'Newest' }));
    await waitFor(() => expect(mockListQuestions).toHaveBeenLastCalledWith(
      10,
      expect.objectContaining({ sort: 'newest' }),
    ));
  });

  it('gates asking to members and submits the full form contract', async () => {
    const { GroupQATab } = await import('./GroupQATab');
    const { rerender } = render(
      <GroupQATab groupId={10} isAdmin={false} isMember={false} />,
    );
    await screen.findByTestId('empty-state');
    expect(screen.queryByRole('button', { name: "Ask question" })).not.toBeInTheDocument();

    rerender(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);
    fireEvent.click(screen.getByRole('button', { name: "Ask question" }));
    let dialog = await waitFor(() => {
      const element = document.querySelector('[role="dialog"]');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    )!);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: "Ask question" }));
    dialog = await waitFor(() => {
      const element = document.querySelector('[role="dialog"]');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.change(dialog.querySelector('input[aria-label="Question title"]')!, {
      target: { value: 'My question title' },
    });
    fireEvent.change(dialog.querySelector('textarea[aria-label="Question details"]')!, {
      target: { value: 'My question body detail' },
    });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === "Post question",
    )!);

    await waitFor(() => expect(mockAskQuestion).toHaveBeenCalledWith(10, {
      title: 'My question title',
      body: 'My question body detail',
    }));
    expect(mockToast.success).toHaveBeenCalledWith('Question posted');
  });

  it('keeps the ask modal open and suppresses success on adapter failure', async () => {
    mockAskQuestion.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);
    await screen.findByTestId('empty-state');

    fireEvent.click(screen.getByRole('button', { name: "Ask question" }));
    const dialog = await waitFor(() => {
      const element = document.querySelector('[role="dialog"]');
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });
    fireEvent.change(dialog.querySelector('input[aria-label="Question title"]')!, {
      target: { value: 'Question' },
    });
    fireEvent.change(dialog.querySelector('textarea[aria-label="Question details"]')!, {
      target: { value: 'Details' },
    });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === "Post question",
    )!);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("We couldn't post your question. Please try again."));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();
  });

  it('posts an answer and refreshes without collapsing the question', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    expect(await screen.findByText('Great question! It works like this...')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer' }), {
      target: { value: 'A new answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: "Post answer" }));

    await waitFor(() => expect(mockPostAnswer).toHaveBeenCalledWith(10, 1, {
      body: 'A new answer',
    }));
    await waitFor(() => expect(mockGetQuestion).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows and retries an explicit question-detail load error', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    mockGetQuestion
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(makeDetail());
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load that question.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Great question! It works like this...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    expect(screen.queryByText('Great question! It works like this...')).not.toBeInTheDocument();
  });

  it('updates and correctly toggles a successful vote', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);

    await screen.findByText('How does timebanking work?');
    fireEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '4 votes' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '3 votes' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Downvote' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '2 votes' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Downvote' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '3 votes' })).toBeInTheDocument());
    expect(mockVote).toHaveBeenNthCalledWith(1, 10, {
      type: 'question', target_id: 1, vote: 1,
    });
    expect(mockVote).toHaveBeenNthCalledWith(3, 10, {
      type: 'question', target_id: 1, vote: -1,
    });
  });

  it('does not apply a vote when a resolved failure is rejected', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    mockVote.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={false} isMember={true} />);

    await screen.findByText('How does timebanking work?');
    fireEvent.click(screen.getByRole('button', { name: 'Upvote' }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("We couldn't count your vote. Please try again."));
    expect(screen.getByRole('img', { name: '3 votes' })).toBeInTheDocument();
  });

  it('accepts an answer for an admin and updates its state', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={true} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    const accept = await screen.findByRole('button', { name: 'Accept this answer' });
    expect(accept).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(accept);

    await waitFor(() => expect(mockAcceptAnswer).toHaveBeenCalledWith(10, 101));
    expect(await screen.findByText("Accepted answer")).toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalledWith('Answer accepted');
  });

  it('does not mark an answer accepted when acceptance fails', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    mockAcceptAnswer.mockRejectedValue(normalizeGroupApiError({
      success: false,
      code: 'HTTP_403',
      status: 403,
    }));
    const { GroupQATab } = await import('./GroupQATab');
    render(<GroupQATab groupId={10} isAdmin={true} isMember={true} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this answer' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("We couldn't mark that answer as accepted. Please try again."));
    expect(screen.queryByText("Accepted answer")).not.toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('aborts in-flight list and detail reads on unmount', async () => {
    mockListQuestions.mockResolvedValue(makeListPage([makeQuestion()]));
    mockGetQuestion.mockImplementationOnce(() => new Promise(() => {}));
    const { GroupQATab } = await import('./GroupQATab');
    const { unmount } = render(<GroupQATab groupId={10} isAdmin={false} />);

    fireEvent.click(await screen.findByRole('button', {
      name: 'Toggle question: How does timebanking work?',
    }));
    await waitFor(() => expect(mockGetQuestion).toHaveBeenCalled());
    const listSignal = mockListQuestions.mock.calls[0]?.[1]?.signal as AbortSignal;
    const detailSignal = mockGetQuestion.mock.calls[0]?.[2]?.signal as AbortSignal;
    unmount();

    expect(listSignal.aborted).toBe(true);
    expect(detailSignal.aborted).toBe(true);
  });
});
