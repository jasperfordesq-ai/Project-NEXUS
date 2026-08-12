// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ChangelogPage
 *
 * Renders the project CHANGELOG.md in-app. The markdown source is copied
 * from the repo root into `public/changelog.md` by `scripts/copy-changelog.mjs`
 * at prebuild/predev time. We fetch it at runtime — no markdown content
 * lives in the JS bundle, so the page stays trim and the changelog stays
 * in sync with the file in git.
 */

import { useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';
import ScrollText from 'lucide-react/icons/scroll-text';
import ExternalLink from 'lucide-react/icons/external-link';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';
import { MarkdownRenderer } from '@/components/content/MarkdownRenderer';

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; content: string }
  | { status: 'error'; message: string };

export function ChangelogPage() {
  const { t } = useTranslation('public');
  usePageTitle(t('changelog_page.title'));
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/changelog.md', { headers: { Accept: 'text/markdown, text/plain' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) setState({ status: 'ok', content: text });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('unknown_error');
          setState({ status: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-6 px-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('changelog_page.meta_title')}
        description={t('changelog_page.meta_description')}
      />

      {/* Header */}
      <header className="space-y-4 border-b border-theme-default pb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <ScrollText className="w-7 h-7 text-accent shrink-0" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {t('changelog_page.heading')}
          </h1>
          <Chip color="success" variant="tertiary" size="sm">
            {t('release_stage')}
          </Chip>
        </div>
        <p className="text-sm text-theme-muted">
          {t('changelog_page.subheading')}
        </p>
        <p>
          <a
            href="https://github.com/jasperfordesq-ai/Project-NEXUS/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-theme-default bg-theme-elevated px-3 py-2 text-sm font-medium text-accent transition-colors hover:border-theme-hover hover:bg-theme-hover focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {t('changelog_page.view_on_github')}
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </a>
        </p>
      </header>

      {/* Body */}
      {state.status === 'loading' && (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('changelog_page.loading')}
          className="flex items-center justify-center gap-3 rounded-md border border-theme-default bg-theme-card py-12 text-theme-muted"
        >
          <Spinner size="sm" />
          <span className="text-sm">
            {t('changelog_page.loading')}
          </span>
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" className="rounded-md border border-theme-default bg-theme-card py-8 text-center text-sm text-danger">
          {t('changelog_page.error')}
          <p className="mt-2 text-xs text-theme-muted font-mono">{state.message}</p>
        </div>
      )}
      {state.status === 'ok' && (
        <article aria-label={t('changelog_page.heading')} className="pb-4">
          <MarkdownRenderer
            content={state.content}
            variant="changelog"
          />
        </article>
      )}
    </div>
  );
}

export default ChangelogPage;
