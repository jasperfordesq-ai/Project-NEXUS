// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';

const { apiGet, apiPost, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { get: apiGet, post: apiPost },
  AUTH_STEP_UP_REQUIRED: 'AUTH_STEP_UP_REQUIRED',
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({ useToast: () => toast }));

import { AccessReviewPage, type AccessReview, type ReviewAccount } from './AccessReviewPage';

const URL = '/v2/platform-team/access-review';

const account = (over: Partial<ReviewAccount> = {}): ReviewAccount => ({
  id: 1,
  name: 'Alex Sample',
  level: 'platform_team',
  community: { id: 1, name: 'Platform' },
  status: 'active',
  last_sign_in_at: '2026-11-10T09:00:00+00:00',
  two_step_on: true,
  ...over,
});

const ACCOUNTS = [
  account(),
  account({ id: 2, name: 'Blair Example', level: 'global_super_admin' }),
  account({ id: 3, name: null, level: 'tenant_super_admin', community: { id: 9, name: 'Riverside Timebank' } }),
];

const review = (over: Partial<AccessReview> = {}): AccessReview => ({
  due: true,
  days_since_last: null,
  last_review: null,
  accounts: ACCOUNTS,
  history: [],
  open_removals: [],
  ...over,
});

const ok = (data: AccessReview) => ({ success: true, data });

const recordButton = () => screen.getByRole('button', { name: 'Record this review' });

/** Choose a decision for an account, by the account's card. */
const choose = (id: number, label: 'Keep' | 'Should be removed') =>
  fireEvent.click(within(screen.getByTestId(`review-account-${id}`)).getByRole('radio', { name: label }));

describe('AccessReviewPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toast.success.mockReset();
    apiGet.mockResolvedValue(ok(review()));
  });

  it('says when no review has been recorded and that one is due', async () => {
    render(<AccessReviewPage />);

    expect(await screen.findByText('No review has been recorded yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Access review' })).toBeInTheDocument();
    expect(screen.getByText('A review is due.')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(URL);
  });

  it('says when the last review was, who recorded it, and when the next is due', async () => {
    apiGet.mockResolvedValue(
      ok(
        review({
          due: false,
          days_since_last: 3,
          last_review: { id: 7, at: '2026-11-13T10:00:00+00:00', by_name: 'Casey Reviewer', account_count: 3, remove_count: 1 },
          history: [{ id: 7, at: '2026-11-13T10:00:00+00:00', by_name: 'Casey Reviewer', account_count: 3, remove_count: 1 }],
        }),
      ),
    );
    render(<AccessReviewPage />);

    expect(await screen.findByTestId('last-review')).toHaveTextContent('Casey Reviewer');
    expect(screen.queryByText('A review is due.')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-due')).toBeInTheDocument();
  });

  it('shows every senior account grouped by level, with no choice made for any of them', async () => {
    render(<AccessReviewPage />);

    const first = await screen.findByTestId('review-account-1');
    expect(within(screen.getByTestId('review-level-platform_team')).getByText('Alex Sample')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-level-global_super_admin')).getByText('Blair Example')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-level-tenant_super_admin')).getByText('No name recorded')).toBeInTheDocument();
    expect(within(screen.getByTestId('review-account-3')).getByText('Riverside Timebank')).toBeInTheDocument();
    expect(screen.queryByTestId('review-level-platform_flag_only')).not.toBeInTheDocument();

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(within(first).getAllByRole('radio')).toHaveLength(2);
  });

  it('says plainly that recording a review changes nobody\'s access', async () => {
    render(<AccessReviewPage />);

    expect(await screen.findByText(/Recording a review changes nobody's access/)).toBeInTheDocument();
  });

  it('keeps the Record button off until every account has a choice', async () => {
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');

    expect(recordButton()).toBeDisabled();
    choose(1, 'Keep');
    choose(2, 'Should be removed');
    expect(recordButton()).toBeDisabled();
    choose(3, 'Keep');
    expect(recordButton()).not.toBeDisabled();
  });

  it('sends one decision per account and the note, then shows the page as it now stands', async () => {
    const after = review({
      due: false,
      days_since_last: 0,
      last_review: { id: 8, at: '2026-11-16T10:00:00+00:00', by_name: 'Alex Sample', account_count: 3, remove_count: 1 },
      history: [{ id: 8, at: '2026-11-16T10:00:00+00:00', by_name: 'Alex Sample', account_count: 3, remove_count: 1 }],
      open_removals: [{ id: 2, name: 'Blair Example', level: 'global_super_admin', community: { id: 1, name: 'Platform' } }],
    });
    apiPost.mockResolvedValue(ok(after));
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');

    choose(1, 'Keep');
    choose(2, 'Should be removed');
    choose(3, 'Keep');
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Checked with the board.' } });
    fireEvent.click(recordButton());

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(apiPost).toHaveBeenCalledWith(URL, {
      decisions: [
        { user_id: 1, decision: 'keep' },
        { user_id: 2, decision: 'remove' },
        { user_id: 3, decision: 'keep' },
      ],
      note: 'Checked with the board.',
    });
    const open = await screen.findByTestId('open-removals');
    expect(within(open).getByText('Blair Example')).toBeInTheDocument();
    // The choices start again for the next review.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
  });

  it('keeps the choices when the second sign-in step was not completed', async () => {
    apiPost.mockResolvedValue({ success: false, code: 'AUTH_STEP_UP_REQUIRED' });
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');
    choose(1, 'Keep');
    choose(2, 'Keep');
    choose(3, 'Keep');
    fireEvent.click(recordButton());

    expect(await screen.findByText(/the sign-in code was not entered/)).toBeInTheDocument();
    expect(within(screen.getByTestId('review-account-1')).getByRole('radio', { name: 'Keep' })).toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says the list changed and offers to load it again', async () => {
    apiPost.mockResolvedValue({ success: false, code: 'ACCESS_REVIEW_LIST_CHANGED' });
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');
    choose(1, 'Keep');
    choose(2, 'Keep');
    choose(3, 'Keep');
    fireEvent.click(recordButton());

    expect(await screen.findByText(/The list changed while you were reviewing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load the list again' }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
  });

  it('says nothing was saved when the review could not be recorded', async () => {
    apiPost.mockResolvedValue({ success: false, code: 'SERVER_ERROR' });
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');
    choose(1, 'Keep');
    choose(2, 'Keep');
    choose(3, 'Keep');
    fireEvent.click(recordButton());

    expect(await screen.findByText(/Nothing was saved/)).toBeInTheDocument();
  });

  it('lists the accounts marked for removal last time that are still here', async () => {
    apiGet.mockResolvedValue(
      ok(
        review({
          open_removals: [{ id: 3, name: null, level: 'tenant_super_admin', community: { id: 9, name: 'Riverside Timebank' } }],
        }),
      ),
    );
    render(<AccessReviewPage />);

    const open = await screen.findByTestId('open-removals');
    expect(within(open).getByRole('heading', { name: 'Marked for removal last time and still here' })).toBeInTheDocument();
    expect(within(open).getByText('No name recorded')).toBeInTheDocument();
  });

  it('shows no "still here" section when there is nothing to show', async () => {
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');

    expect(screen.queryByTestId('open-removals')).not.toBeInTheDocument();
  });

  it('shows the recent reviews, with an erased reviewer shown as such', async () => {
    apiGet.mockResolvedValue(
      ok(
        review({
          due: false,
          days_since_last: 1,
          last_review: { id: 9, at: '2026-11-15T10:00:00+00:00', by_name: null, account_count: 4, remove_count: 0 },
          history: [
            { id: 9, at: '2026-11-15T10:00:00+00:00', by_name: null, account_count: 4, remove_count: 0 },
            { id: 6, at: '2026-08-01T10:00:00+00:00', by_name: 'Casey Reviewer', account_count: 5, remove_count: 2 },
          ],
        }),
      ),
    );
    render(<AccessReviewPage />);

    const history = await screen.findByTestId('review-history');
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const [newest, older] = rows as [HTMLElement, HTMLElement];
    // The words and the name come from one wording, never joined in code.
    expect(within(newest).getByText('Recorded by Erased account')).toBeInTheDocument();
    expect(within(newest).getByText('4 accounts')).toBeInTheDocument();
    expect(within(older).getByText('Recorded by Casey Reviewer')).toBeInTheDocument();
    expect(within(older).getByText('2 marked for removal')).toBeInTheDocument();
    expect(screen.getByTestId('last-review')).toHaveTextContent('recorded by an erased account');
  });

  it('keeps the choices for accounts still listed when the review is refreshed', async () => {
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');
    choose(1, 'Keep');
    choose(2, 'Should be removed');
    apiGet.mockResolvedValue(ok(review({ accounts: [ACCOUNTS[0]!, ACCOUNTS[2]!] })));

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByTestId('review-account-2')).not.toBeInTheDocument());

    expect(within(screen.getByTestId('review-account-1')).getByRole('radio', { name: 'Keep' })).toBeChecked();
    expect(screen.getByText('Decided: 1 of 2 accounts.')).toBeInTheDocument();
  });

  it('keeps the review on screen and says so when a refresh fails', async () => {
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');
    choose(1, 'Keep');
    apiGet.mockResolvedValue({ success: false, code: 'SERVER_ERROR' });

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText("The review could not be loaded again. What you see is from before.")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load the access review just now")).not.toBeInTheDocument();
    expect(within(screen.getByTestId('review-account-1')).getByRole('radio', { name: 'Keep' })).toBeChecked();
  });

  it('asks that nobody is named in the note', async () => {
    render(<AccessReviewPage />);
    await screen.findByTestId('review-account-1');

    expect(screen.getByText('Do not name people in the note. It is kept with the record.')).toBeInTheDocument();
  });

  it('shows the error card, never an empty list, when the review cannot be loaded', async () => {
    apiGet.mockResolvedValue({ success: false, code: 'SERVER_ERROR' });
    render(<AccessReviewPage />);

    expect(await screen.findByText("We couldn't load the access review just now")).toBeInTheDocument();
    expect(screen.queryByText('No review has been recorded yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
