// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Help Centre section — /help/:audience/:sectionId — lists the section's guides. */

import { useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
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

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        title={title}
        description={guideText(audience, sectionKey(section.id, 'summary'))}
        icon={<HelpIcon name={section.icon} className="h-7 w-7" />}
        accent="indigo"
      />

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
