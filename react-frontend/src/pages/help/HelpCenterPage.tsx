// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Help Centre home — /help and /help/:audience
 *
 * Built-in, translated guides for three audiences (members, brokers and
 * coordinators, community admins), filtered to the features this community
 * has switched on, plus the community's own questions and answers written by
 * its admins (Admin → Help FAQs, loaded from /v2/help/faqs).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import HelpCircle from 'lucide-react/icons/circle-help';
import Star from 'lucide-react/icons/star';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { GlassCard } from '@/components/ui/GlassCard';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { SearchField } from '@/components/ui/SearchField';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { AUDIENCE_ICON, HelpCardLink, HelpContactPanel, HelpIcon } from './guides/HelpParts';
import { articleKey, helpPath, sectionKey } from './guides/registry';
import { HELP_AUDIENCES, type HelpAudience } from './guides/types';
import { useHelpGuides } from './guides/useHelpGuides';

interface Faq {
  id: number;
  question: string;
  answer: string;
}

interface FaqGroup {
  category: string;
  faqs: Faq[];
}

function isAudience(value: string | undefined): value is HelpAudience {
  return !!value && (HELP_AUDIENCES as readonly string[]).includes(value);
}

export function HelpCenterPage() {
  const params = useParams<{ audience?: string }>();
  const { branding, tenantPath } = useTenant();
  const { t, guideText, sectionsFor, search } = useHelpGuides();
  usePageTitle(t('page_title'));

  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const audience: HelpAudience = isAudience(params.audience) ? params.audience : 'members';
  const sections = sectionsFor(audience);
  const results = useMemo(() => search(query), [search, query]);

  const popular = sections.flatMap((section) =>
    section.articles.filter((article) => article.popular).map((article) => ({ section, article })),
  ).slice(0, 6);

  // The community's own questions, written by its admins.
  const [faqGroups, setFaqGroups] = useState<FaqGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api.get<FaqGroup[]>('/v2/help/faqs').then((result) => {
      if (!cancelled && result.success && Array.isArray(result.data)) setFaqGroups(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const matchingFaqGroups = query.trim()
    ? faqGroups
        .map((group) => ({
          ...group,
          faqs: group.faqs.filter((faq) =>
            `${faq.question} ${faq.answer}`.toLowerCase().includes(query.trim().toLowerCase()),
          ),
        }))
        .filter((group) => group.faqs.length > 0)
    : faqGroups;

  if (params.audience !== undefined && !isAudience(params.audience)) {
    return <Navigate to={tenantPath('/help')} replace />;
  }

  const searching = query.trim().length >= 2;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-1 sm:px-0">
      <PageMeta title={t('page_title')} description={t('meta_description', { name: branding.name })} />
      <PublicPageHero
        eyebrow={t('hero_eyebrow')}
        title={t('heading')}
        description={t('subtitle', { name: branding.name })}
        icon={<HelpCircle className="h-6 w-6" aria-hidden="true" />}
        accent="blue"
      />

      <div className="mx-auto max-w-2xl">
        <SearchField
          placeholder={t('search_placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('search_label')}
          size="lg"
          classNames={{
            input: 'bg-transparent text-theme-primary',
            inputWrapper: 'bg-theme-elevated border-theme-default',
          }}
        />
      </div>

      {searching ? (
        <section aria-labelledby="help-search-heading" className="space-y-4">
          <div>
            <h2 id="help-search-heading" className="text-xl font-semibold text-theme-primary">
              {t('search_results_heading', { query: query.trim() })}
            </h2>
            <p className="mt-1 text-sm text-theme-muted" role="status">
              {t('search_results_count', { count: results.length })}
            </p>
          </div>
          {results.length > 0 ? (
            <div className="grid gap-3">
              {results.slice(0, 30).map((result) => (
                <HelpCardLink
                  key={`${result.audience}.${result.sectionId}.${result.articleId}`}
                  to={helpPath(result.audience, result.sectionId, result.articleId)}
                  title={result.title}
                  description={result.summary}
                  meta={`${t(`audience.${result.audience}.title`)} · ${result.sectionTitle}`}
                />
              ))}
            </div>
          ) : (
            <GlassCard className="p-8 text-center">
              <h3 className="text-lg font-semibold text-theme-primary">{t('search_no_results_title')}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-theme-muted">{t('search_no_results_body')}</p>
            </GlassCard>
          )}
        </section>
      ) : (
        <>
          <nav aria-label={t('audience_nav_label')}>
            <ul className="grid gap-3 sm:grid-cols-3">
              {HELP_AUDIENCES.map((option) => {
                const active = option === audience;
                return (
                  <li key={option}>
                    <Link
                      to={tenantPath(option === 'members' ? '/help' : helpPath(option))}
                      aria-current={active ? 'page' : undefined}
                      className={`flex h-full items-start gap-3 rounded-2xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        active
                          ? 'border-accent bg-accent/10'
                          : 'border-theme-default bg-theme-elevated/60 hover:border-accent/40'
                      }`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-accent text-white' : 'bg-accent/12 text-accent'}`}>
                        <HelpIcon name={AUDIENCE_ICON[option]} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-theme-primary">{t(`audience.${option}.title`)}</span>
                        <span className="mt-1 block text-sm leading-5 text-theme-muted">{t(`audience.${option}.description`)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {popular.length > 0 && (
            <section aria-labelledby="help-popular-heading" className="space-y-3">
              <h2 id="help-popular-heading" className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
                <Star className="h-5 w-5 text-amber-500" aria-hidden="true" />
                {t('popular_heading')}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {popular.map(({ section, article }) => (
                  <HelpCardLink
                    key={`${section.id}.${article.id}`}
                    to={helpPath(audience, section.id, article.id)}
                    title={guideText(audience, articleKey(section.id, article.id, 'title'))}
                    description={guideText(audience, articleKey(section.id, article.id, 'summary'))}
                  />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="help-sections-heading" className="space-y-3">
            <h2 id="help-sections-heading" className="text-xl font-semibold text-theme-primary">
              {t('sections_heading')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((section) => (
                <HelpCardLink
                  key={section.id}
                  to={helpPath(audience, section.id)}
                  icon={section.icon}
                  title={guideText(audience, sectionKey(section.id, 'title'))}
                  description={guideText(audience, sectionKey(section.id, 'summary'))}
                  meta={t('articles_count', { count: section.articles.length })}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {matchingFaqGroups.length > 0 && (audience === 'members' || searching) && (
        <section aria-labelledby="help-faqs-heading" className="space-y-3">
          <div>
            <h2 id="help-faqs-heading" className="text-xl font-semibold text-theme-primary">{t('community_faqs_heading')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('community_faqs_description', { name: branding.name })}</p>
          </div>
          <GlassCard className="p-2 sm:p-4">
            <Accordion variant="light" selectionMode="multiple">
              {matchingFaqGroups.flatMap((group) =>
                group.faqs.map((faq) => (
                  <AccordionItem key={String(faq.id)} id={String(faq.id)} aria-label={faq.question} title={faq.question} subtitle={group.category}>
                    <SafeHtml content={faq.answer} className="text-sm leading-relaxed text-theme-muted" />
                  </AccordionItem>
                )),
              )}
            </Accordion>
          </GlassCard>
        </section>
      )}

      <HelpContactPanel />
    </div>
  );
}

export default HelpCenterPage;
