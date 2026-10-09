// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { CheckResult, ImportIssue, RunnerState } from './types';
import { buildCsv } from './csvFiles';

// ─── Mocks ───────────────────────────────────────────────────────────────────
const { mockApi, mockRunner, mockToast, downloadText, fileToBase64 } = vi.hoisted(() => ({
  mockApi: { check: vi.fn(), downloadTemplate: vi.fn(), batch: vi.fn() },
  mockRunner: { state: {} as RunnerState, start: vi.fn(), stop: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
  downloadText: vi.fn(),
  fileToBase64: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({ adminMemberImport: mockApi }));
vi.mock('./useMemberImportRunner', () => ({ useMemberImportRunner: () => mockRunner }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));
vi.mock('./csvFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./csvFiles')>();
  return { ...actual, downloadText, fileToBase64 };
});

import { MemberImportModal } from './MemberImportModal';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const HEADER = ['first_name', 'last_name', 'email', 'phone', 'location', 'balance'];

function sourceRows(n: number) {
  // Spreadsheet row 1 is the headings, so the first member is on row 2.
  return Array.from({ length: n }, (_, i) => ({ row: i + 2, raw: [`F${i}`, `L${i}`, `m${i}@example.com`, '', '', ''] }));
}

function runnerState(overrides: Partial<RunnerState> = {}): RunnerState {
  return {
    phase: 'running', total: 125, nextIndex: 25, batchNumber: 1, batchSize: 25,
    created: 25, balance: '300.00', zeroed: 0, admissionIncomplete: 0, admissionIncompleteRows: [],
    held: false, stop: null, errorCode: null, startedAt: 0, secondsRemaining: 120,
    ...overrides,
  };
}

function ready(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'ready',
    header: HEADER,
    source_rows: sourceRows(5),
    summary: { rows: 5, blank_rows_ignored: 2, total_balance: '42.50', negative_count: 1, with_location: 3, without_location: 2 },
    warnings: [{ row: 4, column: 'balance', code: 'negative_balance_zeroed', params: { original: '-3.50' } }],
    import_id: 'abcdef12-3456-7890-abcd-ef1234567890',
    admission: { requires_identity_check: false },
    ...overrides,
  };
}

function problems(list: ImportIssue[], overrides: Partial<CheckResult> = {}): CheckResult {
  return { status: 'problems', header: HEADER, source_rows: sourceRows(5), problems: list, existing_member_rows: [], ...overrides };
}

const fileError = (code: string, params: Record<string, string | number | string[]> = {}): CheckResult => (
  { status: 'file_error', file_error: { code, params } }
);

const issue = (row: number, code: string, column: ImportIssue['column'] = 'email', params: ImportIssue['params'] = {}): ImportIssue => (
  { row, column, code, params }
);

// "Import 5 members", or "Import 1 member" for a file of one.
const IMPORT_BUTTON = /^Import \d+ members?$/;

/** The statistic tile whose small heading is `label`: its heading, figure and note. */
function tile(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement;
}

const onClose = vi.fn();
const onImported = vi.fn();

function open() {
  return render(<MemberImportModal isOpen onClose={onClose} onImported={onImported} />);
}

/** Choose a file and press "Check file"; the API answers with `result`. */
async function checkWith(result: CheckResult) {
  mockApi.check.mockResolvedValue({ success: true, data: result });
  const user = userEvent.setup();
  open();
  await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv', { type: 'text/csv' }));
  await user.click(screen.getByRole('button', { name: 'Check file' }));
  return user;
}

describe('MemberImportModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.downloadTemplate.mockResolvedValue(undefined);
    fileToBase64.mockResolvedValue('QUJD');
    mockRunner.state = runnerState();
  });

  describe('choosing a file', () => {
    it('explains the columns and keeps Check file disabled until a file is chosen', async () => {
      const user = userEvent.setup();
      open();
      expect(await screen.findByText(/The whole file is checked first/)).toBeInTheDocument();
      expect(screen.getByText('First name')).toBeInTheDocument();
      expect(screen.getByText(/Hours from the previous timebank/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();

      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv', { type: 'text/csv' }));
      expect(screen.getByRole('button', { name: 'Check file' })).toBeEnabled();
    });

    it('is closed by a click outside the window (control for the ready-screen test)', async () => {
      const user = userEvent.setup();
      open();
      await user.click(document.querySelector('[data-slot="modal-backdrop"]') as HTMLElement);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('says members can add their town later, and promises no sign-in prompt', async () => {
      open();
      expect(await screen.findByText(/Members can add it later from their profile\./)).toBeInTheDocument();
      expect(screen.queryByText(/asked when they first sign in/)).not.toBeInTheDocument();
    });

    it('centres the icon above the title at every width: they are separate centred items, not one run of inline text', async () => {
      open();
      const heading = await screen.findByRole('heading', { name: 'Import members' });
      const header = heading.parentElement as HTMLElement;
      expect(header).toHaveClass('flex', 'flex-col', 'items-center', 'text-center');
      expect(header.querySelector('svg')).not.toBeNull();
      expect(heading.querySelector('svg')).toBeNull();
    });

    it('only offers CSV files', () => {
      open();
      expect(screen.getByLabelText('Choose a CSV file')).toHaveAttribute('accept', '.csv,text/csv');
    });

    it('downloads the template, and says so when that fails', async () => {
      const user = userEvent.setup();
      open();
      await user.click(screen.getByRole('button', { name: 'Download the template' }));
      expect(mockApi.downloadTemplate).toHaveBeenCalledTimes(1);

      mockApi.downloadTemplate.mockRejectedValueOnce(new Error('no'));
      await user.click(screen.getByRole('button', { name: 'Download the template' }));
      await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('template could not be downloaded')));
    });

    it('checks the chosen file and shows a spinner message while waiting', async () => {
      let resolve!: (v: unknown) => void;
      mockApi.check.mockReturnValue(new Promise((r) => { resolve = r; }));
      const user = userEvent.setup();
      open();
      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv', { type: 'text/csv' }));
      await user.click(screen.getByRole('button', { name: 'Check file' }));

      expect(await screen.findByText('Checking every row…')).toBeInTheDocument();
      expect(mockApi.check).toHaveBeenCalledWith('members.csv', 'QUJD');
      resolve({ success: true, data: ready() });
      expect(await screen.findByText('Every row passed the check')).toBeInTheDocument();
    });

    it('tells the admin inline when the check could not run, and forgets the file', async () => {
      mockApi.check.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
      const user = userEvent.setup();
      open();
      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv'));
      expect(screen.getByText('Chosen file: members.csv')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Check file' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The file could not be checked. Please try again.');
      // The file input came back empty, so Check file must not still be submittable.
      expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
      expect(screen.queryByText(/Chosen file:/)).not.toBeInTheDocument();
      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'again.csv'));
      expect(screen.getByRole('button', { name: 'Check file' })).toBeEnabled();
    });

    it('says to wait a minute, inline, when too many files were checked', async () => {
      mockApi.check.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED' });
      const user = userEvent.setup();
      open();
      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv'));
      await user.click(screen.getByRole('button', { name: 'Check file' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Wait a minute, then try again');
      expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled();
    });

    it('moves focus to the failure message so it is announced', async () => {
      mockApi.check.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
      const user = userEvent.setup();
      open();
      await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'members.csv'));
      await user.click(screen.getByRole('button', { name: 'Check file' }));
      const alert = await screen.findByRole('alert');
      await waitFor(() => expect(document.activeElement).toContainElement(alert));
    });

    it('does not read or upload a file over 2 MB: it shows the too-large screen straight away', async () => {
      const user = userEvent.setup();
      open();
      const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' });
      await user.upload(screen.getByLabelText('Choose a CSV file'), big);
      await user.click(screen.getByRole('button', { name: 'Check file' }));
      expect(await screen.findByText('The file is too large')).toBeInTheDocument();
      expect(screen.getByText('Files can be up to 2 MB. Split it into smaller files.')).toBeInTheDocument();
      expect(fileToBase64).not.toHaveBeenCalled();
      expect(mockApi.check).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Download the correct template' })).toBeInTheDocument();
    });
  });

  describe('a file error', () => {
    it('names the problem, shows how to fix it and offers the correct template', async () => {
      const user = await checkWith(fileError('spreadsheet_workbook'));
      expect(await screen.findByText('This is an Excel workbook, not a CSV file')).toBeInTheDocument();
      expect(screen.getByText(/Save it as "CSV UTF-8 \(Comma delimited\)"/)).toBeInTheDocument();
      expect(screen.getByText('How to fix it')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);

      await user.click(screen.getByRole('button', { name: 'Download the correct template' }));
      expect(mockApi.downloadTemplate).toHaveBeenCalledTimes(1);
    });

    it('announces a file error as an alert and moves focus to it', async () => {
      await checkWith(fileError('empty_file'));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The file is empty');
      await waitFor(() => expect(document.activeElement).toContainElement(alert));
    });

    it('lists the columns for a missing-columns error', async () => {
      await checkWith(fileError('missing_columns', { columns: ['email', 'balance'] }));
      expect(await screen.findByText('Add these columns: email, balance. They can be left empty where optional.')).toBeInTheDocument();
    });

    it('words the two newer file errors', async () => {
      await checkWith(fileError('empty_column_heading', { positions: '3, 5' }));
      expect(await screen.findByText(/Column 3, 5 has no heading/)).toBeInTheDocument();
    });

    it('words a header that is not on the first line', async () => {
      await checkWith(fileError('header_not_on_first_line'));
      expect(await screen.findByText('The headings are not on the first line')).toBeInTheDocument();
    });

    it('still gives a useful message for a code it does not know', async () => {
      await checkWith(fileError('something_new'));
      expect(await screen.findByText('The file cannot be used')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download the correct template' })).toBeInTheDocument();
    });

    it('goes back to the file choice with "Choose another file"', async () => {
      const user = await checkWith(fileError('empty_file'));
      await user.click(await screen.findByRole('button', { name: 'Choose another file' }));
      expect(screen.getByLabelText('Choose a CSV file')).toBeInTheDocument();
    });
  });

  describe('problems', () => {
    it('announces the result: a danger alert, with focus moved onto it', async () => {
      await checkWith(problems([issue(3, 'invalid_email')]));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Nothing has been imported');
      await waitFor(() => expect(document.activeElement).toContainElement(alert));
    });

    it('says nothing was imported and lists each problem with its row', async () => {
      await checkWith(problems([issue(3, 'invalid_email'), issue(4, 'wrong_cell_count', null, { found: 4, expected: 6 })]));
      expect(await screen.findByText('Nothing has been imported')).toBeInTheDocument();
      expect(screen.getByText('Problems found: 2. Rows with problems: 2. Fix them in your spreadsheet, then check the file again.')).toBeInTheDocument();
      const table = screen.getByRole('table');
      expect(within(table).getByText('3')).toBeInTheDocument();
      expect(within(table).getByText(/This is not a valid email address/)).toBeInTheDocument();
      expect(within(table).getByText('This row has 4 cells; the headings have 6.')).toBeInTheDocument();
      expect(within(table).getByText('Whole row')).toBeInTheDocument();
    });

    it('does not claim any rows when the only problem is about the whole file', async () => {
      await checkWith(problems([issue(0, 'already_member_unmatched', null)]));
      expect(await screen.findByText('Problems found: 1. Fix them in your spreadsheet, then check the file again.')).toBeInTheDocument();
    });

    it('labels a whole-file problem "Whole file", never row 0', async () => {
      await checkWith(problems([issue(0, 'already_member_unmatched', null)]));
      const table = await screen.findByRole('table');
      expect(within(table).getByText('Whole file')).toBeInTheDocument();
      expect(within(table).queryByText('0')).not.toBeInTheDocument();
      expect(within(table).getByText(/differs from an email in this file only by accents or spacing/)).toBeInTheDocument();
    });

    it('words an unreadable-characters problem and an unknown code', async () => {
      await checkWith(problems([issue(2, 'invalid_encoding', 'first_name'), issue(3, 'brand_new_code')]));
      const table = await screen.findByRole('table');
      expect(within(table).getByText(/First name contains characters that could not be read/)).toBeInTheDocument();
      expect(within(table).getByText('This value is not accepted.')).toBeInTheDocument();
    });

    it('keeps the row and column cells on one line so only the problem text wraps', async () => {
      await checkWith(problems([issue(3, 'invalid_number', 'balance')]));
      const table = await screen.findByRole('table');
      expect(within(table).getByRole('columnheader', { name: 'Row' })).toHaveClass('whitespace-nowrap');
      expect(within(table).getByRole('columnheader', { name: 'Column' })).toHaveClass('whitespace-nowrap');
      expect(within(table).getByText('3')).toHaveClass('whitespace-nowrap');
      expect(within(table).getByText('Balance')).toHaveClass('whitespace-nowrap');
      expect(within(table).getByText(/This is not a number/)).not.toHaveClass('whitespace-nowrap');
    });

    it('shows the first 200 problems and says how many more there are', async () => {
      const many = Array.from({ length: 230 }, (_, i) => issue(i + 2, 'invalid_email'));
      await checkWith(problems(many));
      const table = await screen.findByRole('table');
      expect(within(table).getAllByRole('row')).toHaveLength(201); // heading + 200
      expect(screen.getByText('…and 30 more. Download the list to see them all.')).toBeInTheDocument();
    });

    it('downloads the full list of problems, not just the 200 shown', async () => {
      const many = Array.from({ length: 230 }, (_, i) => issue(i + 2, 'invalid_email'));
      const user = await checkWith(problems(many));
      await user.click(await screen.findByRole('button', { name: 'Download the list of problems' }));
      const csv = downloadText.mock.calls[0]![0] as string;
      expect(csv.split('\r\n').filter(Boolean)).toHaveLength(231); // heading + 230
      expect(csv).toContain('Row,Column,Problem');
    });

    it('writes a whole-file problem as "Whole file" in the downloaded list, never 0', async () => {
      const user = await checkWith(problems([issue(0, 'already_member_unmatched', null), issue(3, 'invalid_email')]));
      await user.click(await screen.findByRole('button', { name: 'Download the list of problems' }));
      const lines = (downloadText.mock.calls[0]![0] as string).split('\r\n').filter(Boolean);
      expect(lines[1]).toMatch(/^Whole file,Whole row,/);
      expect(lines[2]).toMatch(/^3,Email,/);
      expect(lines.some((l) => l.startsWith('0,'))).toBe(false);
    });

    it('offers the corrected file only when some problems are existing members', async () => {
      await checkWith(problems([issue(3, 'invalid_email')]));
      await screen.findByText('Nothing has been imported');
      expect(screen.queryByRole('button', { name: /corrected file/ })).not.toBeInTheDocument();
    });

    it('offers a corrected file without the existing members, and says other problems remain', async () => {
      const result = problems([issue(3, 'already_member'), issue(5, 'invalid_email')], { existing_member_rows: [3] });
      const user = await checkWith(result);
      const button = await screen.findByRole('button', { name: 'Download a corrected file without the people who are already members' });
      expect(screen.getByText('The corrected file still contains the other problems listed here.')).toBeInTheDocument();
      await user.click(button);
      const rows = sourceRows(5).filter((r) => r.row !== 3).map((r) => r.raw);
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, rows), expect.stringMatching(/\.csv$/));
    });

    it('does not warn about other problems when every problem is an existing member', async () => {
      await checkWith(problems([issue(3, 'already_member')], { existing_member_rows: [3] }));
      await screen.findByRole('button', { name: /corrected file/ });
      expect(screen.queryByText(/still contains the other problems/)).not.toBeInTheDocument();
    });
  });

  describe('ready', () => {
    it('summarises what will be imported', async () => {
      await checkWith(ready());
      expect(await screen.findByText('Every row passed the check')).toBeInTheDocument();
      expect(screen.getByText(/Members to import: 5/)).toBeInTheDocument();
      expect(screen.getByText(/Hours in total: 42\.50/)).toBeInTheDocument();
      expect(screen.getByText(/With a town: 3/)).toBeInTheDocument();
      expect(screen.getByText('Without a town: 2 (they can add it from their profile)')).toBeInTheDocument();
      expect(screen.getByText(/Negative balances that will start at 0: 1/)).toBeInTheDocument();
      expect(screen.getByText(/Empty lines ignored: 2/)).toBeInTheDocument();
      expect(screen.getByText(/does not email anyone yet/)).toBeInTheDocument();
      expect(screen.getByText(/Row 4: a balance of -3\.50 hours will start at 0\./)).toBeInTheDocument();
    });

    it('announces readiness and moves focus onto the result', async () => {
      await checkWith(ready());
      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('Every row passed the check');
      await waitFor(() => expect(document.activeElement).toContainElement(status));
    });

    it('formats the counts with the locale formatter', async () => {
      await checkWith(ready({ summary: { rows: 1234, blank_rows_ignored: 0, total_balance: '1234.50', negative_count: 0, with_location: 1234, without_location: 0 }, warnings: [] }));
      expect(await screen.findByRole('button', { name: 'Import 1,234 members' })).toBeInTheDocument();
      expect(screen.getByText('Members to import: 1,234')).toBeInTheDocument();
    });

    it('is not closed by a click outside the window, but Cancel still closes it', async () => {
      const user = await checkWith(ready());
      await screen.findByText('Every row passed the check');
      await user.click(document.querySelector('[data-slot="modal-backdrop"]') as HTMLElement);
      expect(onClose).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not show the identity checkbox when the community does not require it', async () => {
      await checkWith(ready());
      await screen.findByText('Every row passed the check');
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('starts the import with the identity box ticked', async () => {
      const user = await checkWith(ready({ admission: { requires_identity_check: true } }));
      const box = await screen.findByRole('checkbox', { name: /I have checked each person's identity myself/ });
      expect(screen.getByText(/wait for that check before they can sign in/)).toBeInTheDocument();
      await user.click(box);
      await user.click(screen.getByRole('button', { name: 'Import 5 members' }));
      expect(mockRunner.start).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890', 5, true);
    });

    it('starts the import with the identity box left unticked', async () => {
      const user = await checkWith(ready({ admission: { requires_identity_check: true } }));
      await user.click(await screen.findByRole('button', { name: IMPORT_BUTTON }));
      expect(mockRunner.start).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890', 5, false);
    });

    it('says "member" in the singular for a one-member file', async () => {
      await checkWith(ready({ summary: { rows: 1, blank_rows_ignored: 0, total_balance: '0.00', negative_count: 0, with_location: 1, without_location: 0 }, warnings: [] }));
      expect(await screen.findByRole('button', { name: 'Import 1 member' })).toBeInTheDocument();
    });

    it('starts without an attestation when none is required', async () => {
      const user = await checkWith(ready());
      await user.click(await screen.findByRole('button', { name: IMPORT_BUTTON }));
      expect(mockRunner.start).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890', 5, false);
    });

    it('Cancel closes the window without importing', async () => {
      const user = await checkWith(ready());
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
      expect(onImported).not.toHaveBeenCalled();
      expect(mockRunner.start).not.toHaveBeenCalled();
    });
  });

  describe('running', () => {
    async function startRunning(state: Partial<RunnerState>) {
      mockRunner.state = runnerState(state);
      const user = await checkWith(ready());
      await user.click(await screen.findByRole('button', { name: IMPORT_BUTTON }));
      return user;
    }

    it('shows batch, counts, hours and time left, and a progress bar', async () => {
      await startRunning({ phase: 'running' });
      expect(await screen.findByText('Batch')).toBeInTheDocument();
      expect(tile('Batch')).toHaveTextContent(/2.*of about 5/);
      expect(tile('Members imported')).toHaveTextContent(/25.*of 125/);
      expect(tile('Hours imported')).toHaveTextContent('300.00');
      expect(tile('Time left')).toHaveTextContent(/2.*minutes/);
      expect(screen.getByText('20%')).toBeInTheDocument();
      expect(screen.getByText('Keep this window open until the import finishes.')).toBeInTheDocument();
      const bar = screen.getByRole('progressbar', { name: 'Import progress' });
      expect(bar).toHaveAttribute('aria-valuenow', '20');
    });

    it('cannot be closed while it runs', async () => {
      await startRunning({ phase: 'running' });
      await screen.findByText('Batch');
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('stops after the current batch when asked, and says so', async () => {
      const user = await startRunning({ phase: 'running' });
      await user.click(await screen.findByRole('button', { name: 'Stop after this batch' }));
      expect(mockRunner.stop).toHaveBeenCalledTimes(1);
    });

    it('shows "Stopping…" while the runner is stopping', async () => {
      await startRunning({ phase: 'stopping' });
      expect(await screen.findByRole('button', { name: 'Stopping after this batch…' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Stop after this batch' })).not.toBeInTheDocument();
    });

    it('never says "Batch 0" at the very start', async () => {
      await startRunning({ phase: 'running', nextIndex: 0, batchNumber: 0, created: 0, balance: '0.00', secondsRemaining: null });
      expect(await screen.findByText('Batch')).toBeInTheDocument();
      expect(tile('Batch')).toHaveTextContent(/1.*of about 5/);
      expect(tile('Time left')).toHaveTextContent('Working out the time left');
    });
  });

  describe('finished', () => {
    async function finishWith(state: Partial<RunnerState>, result: CheckResult = ready()) {
      mockRunner.state = runnerState(state);
      const user = await checkWith(result);
      await user.click(await screen.findByRole('button', { name: IMPORT_BUTTON }));
      return user;
    }

    it('celebrates a completed import and shows the import reference', async () => {
      await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5, balance: '42.50' });
      expect(await screen.findByText('5 members imported, with 42.50 hours')).toBeInTheDocument();
      expect(screen.getByText('Import reference: ABCDEF12')).toBeInTheDocument();
    });

    it('moves focus onto the result when the run finishes, and announces failures as alerts', async () => {
      await finishWith({ phase: 'failed', nextIndex: 1, created: 1, total: 5, errorCode: 'NETWORK_ERROR' });
      const alerts = await screen.findAllByRole('alert');
      expect(alerts[0]).toHaveTextContent('The connection to the server was lost');
      await waitFor(() => expect(document.activeElement).toContainElement(alerts[0]!));
    });

    it('formats the imported count with the locale formatter', async () => {
      await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 1234, balance: '5.00' });
      expect(await screen.findByText('1,234 members imported, with 5.00 hours')).toBeInTheDocument();
    });

    it('does not offer a download when every row was already processed', async () => {
      await finishWith({ phase: 'failed', nextIndex: 5, created: 5, total: 5, errorCode: 'NETWORK_ERROR' });
      await screen.findByText('The connection to the server was lost');
      expect(screen.queryByRole('button', { name: 'Download the rows that were not imported' })).not.toBeInTheDocument();
      expect(screen.getByText(/Every row in the file was processed/)).toBeInTheDocument();
    });

    it('says "member" in the singular when only one was imported', async () => {
      await finishWith({ phase: 'completed', nextIndex: 1, total: 1, created: 1, balance: '1.00' });
      expect(await screen.findByText('1 member imported, with 1.00 hours')).toBeInTheDocument();
    });

    it('offers the list of members whose balance started at 0, with their rows', async () => {
      const user = await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5, zeroed: 1 });
      await user.click(await screen.findByRole('button', { name: 'Download the list of members whose balance started at 0' }));
      const csv = downloadText.mock.calls[0]![0] as string;
      expect(csv).toContain('Row,first_name');
      expect(csv).toContain('4,F2,L2,m2@example.com');
    });

    it('does not offer that list when nobody was zeroed', async () => {
      await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5, zeroed: 0 });
      await screen.findByText(/members imported/);
      expect(screen.queryByRole('button', { name: /balance started at 0/ })).not.toBeInTheDocument();
    });

    it('says when members are waiting for the identity check', async () => {
      await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5, held: true });
      expect(await screen.findByText(/waiting for your community's identity check/)).toBeInTheDocument();
    });

    it('warns, with the rows, when some identity steps did not complete', async () => {
      await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5, admissionIncomplete: 2, admissionIncompleteRows: [3, 7] });
      const alert = await screen.findByText(/2 members were created but their identity step did not complete \(rows 3, 7\)/);
      expect(alert).toBeInTheDocument();
      expect(screen.getByText(/resend their identity check, or contact support/)).toBeInTheDocument();
    });

    it('Close tells the member list to refresh when members were created', async () => {
      const user = await finishWith({ phase: 'completed', nextIndex: 5, total: 5, created: 5 });
      await user.click(await screen.findByRole('button', { name: 'Close' }));
      expect(onImported).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Close does not refresh the list when nothing was created', async () => {
      const user = await finishWith({ phase: 'stopped', nextIndex: 0, created: 0 });
      await user.click(await screen.findByRole('button', { name: 'Close' }));
      expect(onImported).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('explains a server stop on a row, and offers the rows that were not imported', async () => {
      const user = await finishWith({
        phase: 'stopped', nextIndex: 2, created: 2, total: 5,
        stop: { row: 4, code: 'email_now_taken', params: {} },
      });
      expect(await screen.findByText('The import stopped. Members imported: 2 of 5.')).toBeInTheDocument();
      expect(screen.getByText('Row 4: someone with this email joined while the import was running.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the rows that were not imported' }));
      const rest = sourceRows(5).slice(2).map((r) => r.raw);
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, rest), expect.stringMatching(/\.csv$/));
    });

    it('offers the rest by position even when earlier rows were skipped in the numbering', async () => {
      // Spreadsheet rows 2, 3, 6, 9: the third held row is spreadsheet row 6.
      const rows = [2, 3, 6, 9].map((row) => ({ row, raw: [`F${row}`, 'L', `m${row}@example.com`, '', '', ''] }));
      const user = await finishWith(
        { phase: 'stopped', nextIndex: 2, created: 2, total: 4, stop: { row: 6, code: 'write_failed', params: {} } },
        ready({ source_rows: rows, summary: { rows: 4, blank_rows_ignored: 0, total_balance: '0.00', negative_count: 0, with_location: 0, without_location: 4 } }),
      );
      expect(await screen.findByText('Row 6 could not be saved. Nothing of that row was saved.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the rows that were not imported' }));
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, rows.slice(2).map((r) => r.raw)), expect.any(String));
    });

    it('says the admin stopped it, and offers the rest, when there is no server stop', async () => {
      const user = await finishWith({ phase: 'stopped', nextIndex: 3, created: 3, total: 5, stop: null });
      expect(await screen.findByText('The import stopped. Members imported: 3 of 5.')).toBeInTheDocument();
      expect(screen.getByText('You stopped the import.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the rows that were not imported' }));
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, sourceRows(5).slice(3).map((r) => r.raw)), expect.any(String));
    });

    it('words the server record of an admin stop exactly as an admin stop', async () => {
      const user = await finishWith({
        phase: 'stopped', nextIndex: 3, created: 3, total: 5,
        stop: { row: 5, code: 'stopped_by_admin', params: {} },
      });
      expect(await screen.findByText('You stopped the import.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the rows that were not imported' }));
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, sourceRows(5).slice(3).map((r) => r.raw)), expect.any(String));
    });

    it('explains a lost connection and offers the rest', async () => {
      const user = await finishWith({ phase: 'failed', nextIndex: 1, created: 1, total: 5, errorCode: 'NETWORK_ERROR' });
      expect(await screen.findByText('The connection to the server was lost')).toBeInTheDocument();
      expect(screen.getByText(/Members imported so far are saved/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download the rows that were not imported' }));
      expect(downloadText).toHaveBeenCalledWith(buildCsv(HEADER, sourceRows(5).slice(1).map((r) => r.raw)), expect.any(String));
    });

    it('explains an import that expired or was replaced', async () => {
      await finishWith({ phase: 'failed', nextIndex: 1, created: 1, total: 5, errorCode: 'IMPORT_NOT_FOUND' });
      expect(await screen.findByText(/This import has expired or was replaced by a newer check/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download the rows that were not imported' })).toBeInTheDocument();
    });

    it('explains an import that continued in another window', async () => {
      await finishWith({ phase: 'failed', nextIndex: 1, created: 1, total: 5, errorCode: 'IMPORT_OUT_OF_ORDER' });
      expect(await screen.findByText(/This import continued in another window/)).toBeInTheDocument();
    });
  });
});
