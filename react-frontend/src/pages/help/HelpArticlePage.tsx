// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Help Centre article — /help/:audience/:sectionId/:articleId */

import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ExternalLink from 'lucide-react/icons/arrow-up-right';
import { Breadcrumbs } from '@/components/navigation';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { HelpBody } from './guides/HelpBody';
import { HelpContactPanel, HelpIcon } from './guides/HelpParts';
import { HelpNotFound } from './guides/HelpNotFound';
import { articleKey, helpPath, sectionKey } from './guides/registry';
import { HELP_AUDIENCES, type HelpAudience } from './guides/types';
import { useHelpGuides } from './guides/useHelpGuides';

export function HelpArticlePage() {
  const { audience: audienceParam, sectionId, articleId } = useParams<{
    audience: string;
    sectionId: string;
    articleId: string;
  }>();
  const { tenantPath } = useTenant();
  const { t, guideText, sectionsFor } = useHelpGuides();

  const audience = (HELP_AUDIENCES as readonly string[]).includes(audienceParam ?? '')
    ? (audienceParam as HelpAudience)
    : null;
  const section = audience ? sectionsFor(audience).find((s) => s.id === sectionId) : undefined;
  const index = section ? section.articles.findIndex((a) => a.id === articleId) : -1;
  const article = section && index >= 0 ? section.articles[index] : undefined;

  const title = audience && section && article
    ? guideText(audience, articleKey(section.id, article.id, 'title'))
    : t('not_found_title');
  usePageTitle(title);

  // A new guide opens at the top, like any other page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [articleId]);

  if (!audience || !section || !article) return <HelpNotFound />;

  const sectionTitle = guideText(audience, sectionKey(section.id, 'title'));
  const previous = index > 0 ? section.articles[index - 1] : undefined;
  const next = index < section.articles.length - 1 ? section.articles[index + 1] : undefined;
  const others = section.articles.filter((a) => a.id !== article.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1 sm:px-0">
      <PageMeta title={title} description={guideText(audience, articleKey(section.id, article.id, 'summary'))} />
      <Breadcrumbs
        items={[
          { label: t('page_title'), href: '/help' },
          { label: t(`audience.${audience}.title`), href: audience === 'members' ? '/help' : helpPath(audience) },
          { label: sectionTitle, href: helpPath(audience, section.id) },
          { label: title },
        ]}
      />

      <GlassCard className="p-6 sm:p-10">
        <article>
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <HelpIcon name={section.icon} className="h-4 w-4" />
            {sectionTitle}
          </p>
          <h1 className="mt-3 text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">{title}</h1>
          <p className="mt-3 text-lg leading-8 text-theme-muted">
            {guideText(audience, articleKey(section.id, article.id, 'summary'))}
          </p>
          <hr className="my-6 border-theme-default" />
          <HelpBody body={guideText(audience, articleKey(section.id, article.id, 'body'))} />

          {article.link && (
            <div className="mt-8">
              <Button
                as={Link}
                to={tenantPath(article.link)}
                color="primary"
                endContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
              >
                {t('open_page')}
              </Button>
            </div>
          )}
        </article>
      </GlassCard>

      {(previous || next) && (
        <nav aria-label={t('pager_label')} className="grid gap-3 sm:grid-cols-2">
          {previous ? (
            <Link
              to={tenantPath(helpPath(audience, section.id, previous.id))}
              className="rounded-2xl border border-theme-default bg-theme-elevated/60 p-4 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-theme-subtle">
                <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
                {t('previous_article')}
              </span>
              <span className="mt-1 block font-semibold text-theme-primary">
                {guideText(audience, articleKey(section.id, previous.id, 'title'))}
              </span>
            </Link>
          ) : <span />}
          {next && (
            <Link
              to={tenantPath(helpPath(audience, section.id, next.id))}
              className="rounded-2xl border border-theme-default bg-theme-elevated/60 p-4 text-end hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="flex items-center justify-end gap-1 text-xs font-medium text-theme-subtle">
                {t('next_article')}
                <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
              </span>
              <span className="mt-1 block font-semibold text-theme-primary">
                {guideText(audience, articleKey(section.id, next.id, 'title'))}
              </span>
            </Link>
          )}
        </nav>
      )}

      {others.length > 0 && (
        <section aria-labelledby="help-more-heading">
          <h2 id="help-more-heading" className="mb-3 text-lg font-semibold text-theme-primary">{t('in_this_section')}</h2>
          <GlassCard className="divide-y divide-theme-default/60 p-2">
            {others.map((other) => (
              <Link
                key={other.id}
                to={tenantPath(helpPath(audience, section.id, other.id))}
                className="block rounded-lg px-4 py-3 text-theme-primary hover:bg-theme-hover/30 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {guideText(audience, articleKey(section.id, other.id, 'title'))}
              </Link>
            ))}
          </GlassCard>
        </section>
      )}

      <HelpContactPanel />
    </div>
  );
}

export default HelpArticlePage;
