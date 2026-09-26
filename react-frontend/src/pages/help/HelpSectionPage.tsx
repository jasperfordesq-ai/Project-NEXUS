// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Help Centre section — /help/:audience/:sectionId — lists the section's guides. */

import { useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo/PageMeta';
import { usePageTitle } from '@/hooks';
import { HelpCardLink, HelpContactPanel, HelpIcon } from './guides/HelpParts';
import { HelpNotFound } from './guides/HelpNotFound';
import { articleKey, helpPath, sectionKey } from './guides/registry';
import { HELP_AUDIENCES, type HelpAudience } from './guides/types';
import { useHelpGuides } from './guides/useHelpGuides';

export function HelpSectionPage() {
  const { audience: audienceParam, sectionId } = useParams<{ audience: string; sectionId: string }>();
  const { t, guideText, sectionsFor } = useHelpGuides();

  const audience = (HELP_AUDIENCES as readonly string[]).includes(audienceParam ?? '')
    ? (audienceParam as HelpAudience)
    : null;
  const section = audience ? sectionsFor(audience).find((s) => s.id === sectionId) : undefined;
  const title = audience && section ? guideText(audience, sectionKey(section.id, 'title')) : t('not_found_title');
  usePageTitle(title);

  if (!audience || !section) return <HelpNotFound />;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-1 sm:px-0">
      <PageMeta title={title} description={guideText(audience, sectionKey(section.id, 'summary'))} />
      <Breadcrumbs
        items={[
          { label: t('page_title'), href: '/help' },
          { label: t(`audience.${audience}.title`), href: audience === 'members' ? '/help' : helpPath(audience) },
          { label: title },
        ]}
      />

      <header className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <HelpIcon name={section.icon} className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-theme-primary sm:text-3xl">{title}</h1>
          <p className="mt-2 text-base leading-7 text-theme-muted">{guideText(audience, sectionKey(section.id, 'summary'))}</p>
        </div>
      </header>

      <ol className="grid gap-3">
        {section.articles.map((article) => (
          <li key={article.id}>
            <HelpCardLink
              to={helpPath(audience, section.id, article.id)}
              title={guideText(audience, articleKey(section.id, article.id, 'title'))}
              description={guideText(audience, articleKey(section.id, article.id, 'summary'))}
            />
          </li>
        ))}
      </ol>

      <HelpContactPanel />
    </div>
  );
}

export default HelpSectionPage;
