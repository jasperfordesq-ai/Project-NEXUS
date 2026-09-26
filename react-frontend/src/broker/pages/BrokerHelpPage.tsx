// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The broker and coordinator guide, inside the Broker Panel.
 *
 * The guide itself is the Help Centre's "brokers" audience (registry in
 * `src/pages/help/guides/data/brokers.registry.json`, text in the
 * `help_brokers` namespace), so the Broker Panel and the public Help Centre
 * show the same checked, translated articles. This file only frames them in
 * the Broker Panel:
 *
 *   /broker/help                          every topic, with search
 *   /broker/help/:sectionId/:articleId    one article
 *
 * `BrokerControlsHelp` is the short "guide" card on the broker dashboard.
 */

import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import BookOpen from 'lucide-react/icons/book-open';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import Search from 'lucide-react/icons/search';
import SearchX from 'lucide-react/icons/search-x';
import { Button, Card, CardBody, CardHeader, Input, Separator } from '@/components/ui';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { HelpBody } from '@/pages/help/guides/HelpBody';
import { HelpIcon } from '@/pages/help/guides/HelpParts';
import { articleKey, helpPath, sectionKey } from '@/pages/help/guides/registry';
import { useHelpGuides } from '@/pages/help/guides/useHelpGuides';
import { BrokerEmptyState, BrokerPageShell } from '../components';

function brokerHelpPath(sectionId?: string, articleId?: string): string {
  return ['/broker/help', sectionId, articleId].filter(Boolean).join('/');
}

function ArticleLink({ sectionId, articleId, title, summary }: { sectionId: string; articleId: string; title: string; summary?: string }) {
  const { tenantPath } = useTenant();
  return (
    <Link
      to={tenantPath(brokerHelpPath(sectionId, articleId))}
      className="group flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="min-w-0">
        <span className="block font-medium text-foreground group-hover:text-accent">{title}</span>
        {summary && <span className="mt-0.5 block text-sm text-muted">{summary}</span>}
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

/** Dashboard card: the most-needed broker guides and a link to the rest. */
export function BrokerControlsHelp() {
  const { t, guideText, sectionsFor } = useHelpGuides();
  const { tenantPath } = useTenant();
  const popular = sectionsFor('brokers')
    .flatMap((section) => section.articles.filter((a) => a.popular).map((article) => ({ section, article })))
    .slice(0, 4);

  return (
    <section aria-labelledby="broker-guide-card-heading">
      <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader className="flex flex-col items-start gap-1">
          <h2 id="broker-guide-card-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <BookOpen size={18} className="text-accent" aria-hidden="true" />
            {t('broker_panel.title')}
          </h2>
          <p className="text-sm text-muted">{t('broker_panel.subtitle')}</p>
        </CardHeader>
        <Separator />
        <CardBody className="space-y-1 pt-3">
          {popular.map(({ section, article }) => (
            <ArticleLink
              key={`${section.id}.${article.id}`}
              sectionId={section.id}
              articleId={article.id}
              title={guideText('brokers', articleKey(section.id, article.id, 'title'))}
            />
          ))}
          <div className="px-3 pt-2">
            <Button as={Link} to={tenantPath('/broker/help')} size="sm" variant="secondary">
              {t('broker_panel.open_full')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}

function BrokerHelpArticle({ sectionId, articleId }: { sectionId: string; articleId: string }) {
  const { t, guideText, sectionsFor } = useHelpGuides();
  const { tenantPath } = useTenant();
  const section = sectionsFor('brokers').find((s) => s.id === sectionId);
  const index = section ? section.articles.findIndex((a) => a.id === articleId) : -1;
  const article = section && index >= 0 ? section.articles[index] : undefined;
  const title = section && article ? guideText('brokers', articleKey(section.id, article.id, 'title')) : t('not_found_title');
  usePageTitle(title);

  if (!section || !article) {
    return (
      <BrokerPageShell title={t('broker_panel.title')} icon={BookOpen} color="neutral">
        <BrokerEmptyState
          icon={SearchX}
          color="neutral"
          title={t('not_found_title')}
          hint={t('not_found_body')}
          action={<Button as={Link} to={tenantPath('/broker/help')} size="sm" variant="tertiary">{t('broker_panel.back')}</Button>}
        />
      </BrokerPageShell>
    );
  }

  const previous = index > 0 ? section.articles[index - 1] : undefined;
  const next = index < section.articles.length - 1 ? section.articles[index + 1] : undefined;

  return (
    <BrokerPageShell
      title={title}
      description={guideText('brokers', articleKey(section.id, article.id, 'summary'))}
      icon={<HelpIcon name={section.icon} className="h-5 w-5" />}
      color="accent"
      actions={
        <Button as={Link} to={tenantPath('/broker/help')} size="sm" variant="tertiary" startContent={<ArrowLeft size={14} className="rtl:rotate-180" aria-hidden="true" />}>
          {t('broker_panel.back')}
        </Button>
      }
    >
      <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardBody className="p-5 sm:p-8">
          <p className="mb-4 text-sm font-medium text-accent">{guideText('brokers', sectionKey(section.id, 'title'))}</p>
          <HelpBody body={guideText('brokers', articleKey(section.id, article.id, 'body'))} />
          <div className="mt-8 flex flex-wrap gap-2">
            {article.link && (
              <Button as={Link} to={tenantPath(article.link)} color="primary" size="sm">
                {t('open_page')}
              </Button>
            )}
            <Button
              as={Link}
              to={tenantPath(helpPath('brokers', section.id, article.id))}
              size="sm"
              variant="tertiary"
              endContent={<ArrowUpRight size={14} aria-hidden="true" />}
            >
              {t('broker_panel.view_in_help_centre')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {(previous || next) && (
        <nav aria-label={t('pager_label')} className="mt-4 grid gap-3 sm:grid-cols-2">
          {previous ? (
            <ArticleLink
              sectionId={section.id}
              articleId={previous.id}
              title={guideText('brokers', articleKey(section.id, previous.id, 'title'))}
              summary={t('previous_article')}
            />
          ) : <span />}
          {next && (
            <ArticleLink
              sectionId={section.id}
              articleId={next.id}
              title={guideText('brokers', articleKey(section.id, next.id, 'title'))}
              summary={t('next_article')}
            />
          )}
        </nav>
      )}
    </BrokerPageShell>
  );
}

export default function BrokerHelpPage() {
  const { sectionId, articleId } = useParams<{ sectionId?: string; articleId?: string }>();
  const { t, guideText, sectionsFor, search } = useHelpGuides();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const setQuery = (next: string) => setSearchParams(next ? { q: next } : {}, { replace: true });

  const sections = sectionsFor('brokers');
  const results = useMemo(
    () => search(query).filter((result) => result.audience === 'brokers'),
    [search, query],
  );
  const searching = query.trim().length >= 2;

  usePageTitle(t('broker_panel.title'));

  if (sectionId && articleId) return <BrokerHelpArticle sectionId={sectionId} articleId={articleId} />;

  return (
    <BrokerPageShell
      title={t('broker_panel.title')}
      description={t('broker_panel.subtitle')}
      icon={BookOpen}
      color="neutral"
      toolbar={
        <div className="flex flex-col gap-2 p-1 sm:flex-row sm:items-center sm:justify-between">
          <Input
            className="w-full sm:max-w-sm"
            placeholder={t('search_placeholder')}
            aria-label={t('search_label')}
            startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
            value={query}
            onValueChange={setQuery}
            size="sm"
            variant="secondary"
            isClearable
            onClear={() => setQuery('')}
          />
          {searching && (
            <p className="px-1 text-xs tabular-nums text-muted" aria-live="polite">
              {t('search_results_count', { count: results.length })}
            </p>
          )}
        </div>
      }
    >
      {searching ? (
        results.length === 0 ? (
          <BrokerEmptyState
            icon={SearchX}
            color="neutral"
            title={t('search_no_results_title')}
            hint={t('search_no_results_body')}
            action={<Button size="sm" variant="tertiary" onPress={() => setQuery('')}>{t('broker_panel.back')}</Button>}
          />
        ) : (
          <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
            <CardBody className="space-y-1 p-2 sm:p-3">
              {results.map((result) => (
                <ArticleLink
                  key={`${result.sectionId}.${result.articleId}`}
                  sectionId={result.sectionId}
                  articleId={result.articleId}
                  title={result.title}
                  summary={result.summary}
                />
              ))}
            </CardBody>
          </Card>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((section) => (
            <Card key={section.id} className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
              <CardHeader className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <HelpIcon name={section.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-foreground">{guideText('brokers', sectionKey(section.id, 'title'))}</h2>
                  <p className="mt-0.5 text-sm text-muted">{guideText('brokers', sectionKey(section.id, 'summary'))}</p>
                </div>
              </CardHeader>
              <Separator />
              <CardBody className="space-y-0.5 p-2">
                {section.articles.map((article) => (
                  <ArticleLink
                    key={article.id}
                    sectionId={section.id}
                    articleId={article.id}
                    title={guideText('brokers', articleKey(section.id, article.id, 'title'))}
                  />
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </BrokerPageShell>
  );
}
