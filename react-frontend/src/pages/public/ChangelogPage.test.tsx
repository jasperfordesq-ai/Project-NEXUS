// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, userEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

import type { ChangelogIndex, ChangelogRelease } from './changelog/types';

// PageMeta is globally mocked to a no-op in src/test/setup.ts.
// MarkdownRenderer is a real component; mock it to avoid markdown-parsing overhead.
vi.mock('@/components/content/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content, variant }: { content: string; variant?: string }) => (
    <div data-testid="markdown-renderer" data-variant={variant}>
      {content}
    </div>
  ),
}));

vi.mock('@/contexts', () => createMockContexts());

// usePageTitle sets document.title — mock the hook to keep tests simple.
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

import { ChangelogPage } from './ChangelogPage';

// ── A small changelog: three releases, the middle one long enough to page ────

const fixedIn2 = Array.from({ length: 30 }, (_, index) => ({
  title: `Fix number ${index + 1}`,
  body: `Detail of fix ${index + 1}.`,
}));

const RELEASES: Record<string, ChangelogRelease> = {
  unreleased: {
    version: 'Unreleased',
    slug: 'unreleased',
    date: '',
    isUnreleased: true,
    compareUrl: 'https://github.com/example/repo/compare/v2.0.0...HEAD',
    intro: '',
    sections: [
      {
        type: 'added',
        label: 'Added',
        entries: [
          { title: 'A new changelog page', body: 'It opens one release at a time.' },
          { title: 'A one-line change with nothing to open', body: '' },
        ],
      },
      { type: 'fixed', label: 'Fixed', entries: [{ title: 'The wallet total adds up', body: 'It was off by one.' }] },
    ],
  },
  '2.0.0': {
    version: '2.0.0',
    slug: '2.0.0',
    date: '2026-09-16',
    isUnreleased: false,
    compareUrl: 'https://github.com/example/repo/compare/v1.0.0...v2.0.0',
    intro: 'Version two is here.',
    sections: [{ type: 'fixed', label: 'Fixed', entries: fixedIn2 }],
  },
  '1.0.0': {
    version: '1.0.0',
    slug: '1.0.0',
    date: '2026-03-27',
    isUnreleased: false,
    compareUrl: null,
    intro: '',
    sections: [
      {
        type: 'changed',
        label: 'Changed',
        entries: [
          { title: 'The old endpoint is gone', body: 'Wallet apps must use the new one.', breaking: true },
        ],
      },
    ],
  },
};

const INDEX: ChangelogIndex = {
  releases: Object.values(RELEASES).map((release) => ({
    version: release.version,
    slug: release.slug,
    date: release.date,
    isUnreleased: release.isUnreleased,
    compareUrl: release.compareUrl,
    total: release.sections.reduce((sum, section) => sum + section.entries.length, 0),
    counts: release.sections.map((section) => ({
      type: section.type,
      label: section.label,
      count: section.entries.length,
    })),
  })),
};

type Answer = { ok?: boolean; status?: number; json?: () => Promise<unknown> } | Error;

/** Serve the changelog files; `overrides` replaces the answer for a file name. */
function serveChangelog(overrides: Record<string, Answer | (() => Answer)> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const file = String(input).replace('/changelog-data/', '');
    const override = overrides[file];
    const answer = typeof override === 'function' ? override() : override;
    if (answer instanceof Error) throw answer;
    if (answer) return { ok: true, status: 200, json: async () => ({}), ...answer } as Response;

    const data = file === 'index.json' ? INDEX : RELEASES[file.replace(/\.json$/, '')];
    if (!data) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => data } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const requested = (fetchMock: ReturnType<typeof serveChangelog>) =>
  fetchMock.mock.calls.map(([input]) => String(input).replace('/changelog-data/', ''));

const releaseRow = (name: RegExp) => screen.getByRole('button', { name });

/** The changes drawn inside one release's row. */
function changesIn(slug: string) {
  const row = document.querySelector(`[data-release="${slug}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${slug}`);
  return within(row);
}

async function arrive() {
  render(<ChangelogPage />);
  await screen.findByRole('button', { name: /Latest changes/ });
}

describe('ChangelogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', window.location.pathname);
  });

  describe('before the list arrives', () => {
    it('shows a loading status while the list of releases is pending', () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      const { container } = render(<ChangelogPage />);
      // ToastProvider and the Spinner also render role="status"; the page's
      // own loading box is the one that is aria-busy.
      expect(container.querySelector('[role="status"][aria-busy="true"]')).toBeInTheDocument();
      expect(screen.getByText(/loading changelog/i)).toBeInTheDocument();
    });

    it('renders the page heading and the GitHub link', () => {
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
      render(<ChangelogPage />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/changelog/i);
      const githubLink = screen.getByRole('link', { name: /view on github/i });
      expect(githubLink).toHaveAttribute('href', expect.stringContaining('github.com'));
      expect(githubLink).toHaveAttribute('target', '_blank');
    });

    it('asks for the list of releases, not for the whole changelog', async () => {
      const fetchMock = serveChangelog();
      await arrive();
      expect(requested(fetchMock)[0]).toBe('index.json');
      expect(requested(fetchMock)).not.toContain('changelog.md');
    });
  });

  describe('when the list cannot be read', () => {
    it('says so when the server answers with an error', async () => {
      serveChangelog({ 'index.json': { ok: false, status: 404 } });
      render(<ChangelogPage />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the changelog/i);
      expect(screen.getByText('HTTP 404')).toBeInTheDocument();
    });

    it('says so when the request fails', async () => {
      serveChangelog({ 'index.json': new Error('Network error') });
      render(<ChangelogPage />);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('does not accept the app shell answered in place of the file', async () => {
      // What a server without the /changelog-data/ rule does: 200, with HTML.
      serveChangelog({
        'index.json': {
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
        },
      });
      render(<ChangelogPage />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the changelog/i);
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('sends people to GitHub when the build had no changelog to split', async () => {
      serveChangelog({ 'index.json': { ok: true, json: async () => ({ releases: [] }) } });
      render(<ChangelogPage />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the changelog/i);
    });
  });

  describe('the list of releases', () => {
    it('shows a row per release with its date and number of changes', async () => {
      serveChangelog();
      await arrive();

      expect(releaseRow(/Latest changes/)).toHaveTextContent('Changes: 3');
      const two = releaseRow(/Version 2\.0\.0/);
      expect(two).toHaveTextContent(/Released .*September.*2026/);
      expect(two).toHaveTextContent('Changes: 30');
      expect(releaseRow(/Version 1\.0\.0/)).toHaveTextContent('Changes: 1');
    });

    it('opens the newest release on arrival and fetches only that one', async () => {
      const fetchMock = serveChangelog();
      await arrive();

      expect(await screen.findByText('A new changelog page')).toBeInTheDocument();
      expect(requested(fetchMock)).toEqual(['index.json', 'unreleased.json']);
      expect(screen.queryByText('Fix number 1')).not.toBeInTheDocument();
    });

    it('fetches a release when it is opened, and only once', async () => {
      const fetchMock = serveChangelog();
      const user = userEvent.setup();
      await arrive();

      await user.click(releaseRow(/Version 2\.0\.0/));
      expect(await screen.findByText('Fix number 1')).toBeInTheDocument();
      expect(screen.getByText('Version two is here.')).toBeInTheDocument();

      await user.click(releaseRow(/Version 2\.0\.0/));
      await user.click(releaseRow(/Version 2\.0\.0/));
      expect(await screen.findByText('Fix number 1')).toBeInTheDocument();
      expect(requested(fetchMock).filter((file) => file === '2.0.0.json')).toHaveLength(1);
    });

    it('gives the address the release that was just opened', async () => {
      serveChangelog();
      const user = userEvent.setup();
      await arrive();

      await user.click(releaseRow(/Version 2\.0\.0/));
      expect(window.location.hash).toBe('#v2.0.0');
    });

    it('opens the release named in the address instead of the newest', async () => {
      window.history.replaceState(null, '', `${window.location.pathname}#v1.0.0`);
      const fetchMock = serveChangelog();
      await arrive();

      expect(await screen.findByText('The old endpoint is gone')).toBeInTheDocument();
      expect(requested(fetchMock)).toEqual(['index.json', '1.0.0.json']);
    });

    it('opens a release when only the address fragment changes, without a reload', async () => {
      const fetchMock = serveChangelog();
      await arrive();
      await screen.findByText('A new changelog page');

      // What following a link to /changelog#v1.0.0 does while the page is open.
      window.history.replaceState(null, '', `${window.location.pathname}#v1.0.0`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      expect(await screen.findByText('The old endpoint is gone')).toBeInTheDocument();
      // The release that was already open stays open.
      expect(screen.getByText('A new changelog page')).toBeInTheDocument();
      expect(requested(fetchMock)).toContain('1.0.0.json');
    });

    it('offers to try again when a release cannot be loaded', async () => {
      let attempts = 0;
      serveChangelog({
        '2.0.0.json': () => {
          attempts += 1;
          return attempts === 1 ? { ok: false, status: 500 } : { ok: true, json: async () => RELEASES['2.0.0'] };
        },
      });
      const user = userEvent.setup();
      await arrive();

      await user.click(releaseRow(/Version 2\.0\.0/));
      expect(await screen.findByText('Could not load this release.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Fix number 1')).toBeInTheDocument();
      expect(screen.queryByText('Could not load this release.')).not.toBeInTheDocument();
    });
  });

  describe('inside an open release', () => {
    it('shows titles first and the detail only when a change is opened', async () => {
      serveChangelog();
      const user = userEvent.setup();
      await arrive();

      await screen.findByText('A new changelog page');
      expect(screen.queryByText('It opens one release at a time.')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /A new changelog page/ }));
      const detail = await screen.findByText('It opens one release at a time.');
      expect(detail).toHaveAttribute('data-variant', 'changelogEntry');
    });

    it('draws a one-line change as a plain line, with nothing to open', async () => {
      serveChangelog();
      await arrive();

      expect(await screen.findByText('A one-line change with nothing to open')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /A one-line change/ })).not.toBeInTheDocument();
    });

    it('shows one kind of change when its button is pressed', async () => {
      serveChangelog();
      const user = userEvent.setup();
      await arrive();
      await screen.findByText('A new changelog page');

      const kinds = changesIn('unreleased').getByRole('radiogroup', { name: 'Show one kind of change' });
      expect(within(kinds).getByRole('radio', { name: /^All\s*3$/ })).toBeInTheDocument();
      expect(within(kinds).getByRole('radio', { name: /^New\s*2$/ })).toBeInTheDocument();

      // With every kind on show, each kind has its own small heading.
      expect(changesIn('unreleased').getByRole('heading', { name: /^New\s*2$/ })).toBeInTheDocument();
      expect(changesIn('unreleased').getByRole('heading', { name: /^Fixed\s*1$/ })).toBeInTheDocument();

      await user.click(within(kinds).getByRole('radio', { name: /^Fixed\s*1$/ }));
      expect(screen.getByText('The wallet total adds up')).toBeInTheDocument();
      expect(screen.queryByText('A new changelog page')).not.toBeInTheDocument();
      expect(changesIn('unreleased').queryByRole('heading', { name: /^Fixed/ })).not.toBeInTheDocument();
    });

    it('does not offer kind buttons or headings for a release with one kind of change', async () => {
      serveChangelog();
      const user = userEvent.setup();
      await arrive();

      await user.click(releaseRow(/Version 2\.0\.0/));
      await screen.findByText('Fix number 1');
      expect(changesIn('2.0.0').queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(changesIn('2.0.0').queryByRole('heading', { name: /^Fixed/ })).not.toBeInTheDocument();
    });

    it('shows 25 changes at a time', async () => {
      serveChangelog();
      const user = userEvent.setup();
      await arrive();

      await user.click(releaseRow(/Version 2\.0\.0/));
      await screen.findByText('Fix number 1');
      expect(screen.getByText('Fix number 25')).toBeInTheDocument();
      expect(screen.queryByText('Fix number 26')).not.toBeInTheDocument();

      await user.click(changesIn('2.0.0').getByRole('button', { name: /Show more/ }));
      expect(screen.getByText('Fix number 30')).toBeInTheDocument();
      expect(changesIn('2.0.0').queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
    });

    it('links to the release on GitHub', async () => {
      serveChangelog();
      await arrive();
      await screen.findByText('A new changelog page');

      expect(screen.getByRole('link', { name: /See this release on GitHub/ })).toHaveAttribute(
        'href',
        'https://github.com/example/repo/compare/v2.0.0...HEAD',
      );
    });
  });

  describe('searching', () => {
    const search = async (words: string) => {
      const user = userEvent.setup();
      await user.type(screen.getByRole('searchbox', { name: 'Search every release' }), words);
      return user;
    };

    it('looks through every release, titles and detail, and groups what it finds', async () => {
      const fetchMock = serveChangelog();
      await arrive();
      await search('wallet');

      // "wallet" is in a title in the unreleased block and in the detail of a 1.0.0 change.
      const results = await screen.findByTestId('changelog-search-results');
      await waitFor(() => expect(screen.getByTestId('changelog-match-count')).toHaveTextContent('Changes found: 2'));

      expect(within(results).getByRole('heading', { name: /Latest changes/ })).toBeInTheDocument();
      expect(within(results).getByRole('heading', { name: /Version 1\.0\.0/ })).toBeInTheDocument();
      expect(within(results).getByText('The wallet total adds up')).toBeInTheDocument();
      expect(within(results).getByText('The old endpoint is gone')).toBeInTheDocument();
      expect(within(results).getByText('Breaking change')).toBeInTheDocument();

      expect(requested(fetchMock).sort()).toEqual(['1.0.0.json', '2.0.0.json', 'index.json', 'unreleased.json']);
      expect(screen.queryByTestId('changelog-releases')).not.toBeInTheDocument();
    });

    it('says when nothing matches, and goes back to the releases when cleared', async () => {
      serveChangelog();
      await arrive();
      const user = await search('zebra');

      expect(await screen.findByText('No change matches that search. Try a different word.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear the search' }));
      expect(await screen.findByRole('button', { name: /Version 2\.0\.0/ })).toBeInTheDocument();
    });

    it('says the results may be incomplete when a release could not be loaded', async () => {
      serveChangelog({ '2.0.0.json': { ok: false, status: 500 } });
      await arrive();
      await search('wallet');

      expect(
        await screen.findByText('Some releases could not be loaded, so these results may be incomplete.'),
      ).toBeInTheDocument();
      expect(await screen.findByText('The wallet total adds up')).toBeInTheDocument();
    });
  });
});
