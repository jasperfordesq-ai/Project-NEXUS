// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Everything on the features page written for someone weighing up the
 * software rather than using it: how entries are labelled, what it is built
 * with, the open-source links and how to report a security problem. One
 * closed section at the foot of the page (owner, 14 Nov 2026), so a member
 * is not asked to read it first.
 *
 * Closed, not removed: the contents stay in the DOM (see the note in
 * `FeatureCatalogue.tsx`), so the links are still there for search engines.
 *
 * 🔴 The release chip reads the `release_stage` key, which carries the
 * version. `features_page.subheading` carries it too and is no longer shown
 * here (it says "every module below", and the modules are now above; the
 * label key says the rest) — but the accessible site still shows it, so bump
 * both together, with the version files listed in AGENTS.md ("Version and
 * Changelog Hygiene"), in the same commit.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Wrench from 'lucide-react/icons/wrench';
import Github from 'lucide-react/icons/github';
import Bug from 'lucide-react/icons/bug';
import ExternalLink from 'lucide-react/icons/external-link';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';
import { useTenant } from '@/contexts';

const TEXT_LINK =
  'inline-flex items-center gap-1.5 rounded font-medium text-accent underline focus:outline-none focus:ring-2 focus:ring-accent';

const TECH_STACK = [
  'frontend', 'accessible', 'backend', 'database', 'search', 'ai', 'realtime', 'mobile', 'infrastructure',
] as const;

export function TechnicalNotes() {
  const { t } = useTranslation('public');
  const { tenantPath } = useTenant();

  return (
    <section data-technical-notes>
      <Card className="border border-border shadow-sm">
        <Card.Content className="p-0">
          <Disclosure>
            <DisclosureHeading level={2}>
              <DisclosureTrigger className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start sm:px-5">
                <Wrench className="size-5 shrink-0 text-theme-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-foreground">
                    {t('features_page.welcome.technical_heading')}
                  </span>
                  <span className="block text-sm font-normal text-theme-muted">
                    {t('features_page.welcome.technical_body')}
                  </span>
                </span>
                <DisclosureIndicator className="shrink-0 text-theme-muted" />
              </DisclosureTrigger>
            </DisclosureHeading>
            <DisclosureContent>
              <DisclosureBody className="space-y-6 px-4 pb-6 text-sm text-theme-muted sm:px-5">
                <Chip color="success" variant="tertiary" size="sm">
                  {t('release_stage')}
                </Chip>

                {/* Maturity key */}
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {t('features_page.maturity_key_title')}
                  </h3>
                  <ul className="list-none space-y-1.5">
                    <li className="flex items-start gap-2">
                      <Chip color="success" variant="tertiary" size="sm" className="shrink-0">GA</Chip>
                      <span>{t('features_page.maturity_ga')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Chip color="warning" variant="tertiary" size="sm" className="shrink-0">
                        {t('features_page.chips.beta')}
                      </Chip>
                      <span>{t('features_page.maturity_beta')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Chip color="accent" variant="tertiary" size="sm" className="shrink-0">
                        {t('features_page.chips.preview')}
                      </Chip>
                      <span>{t('features_page.maturity_preview')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Chip color="default" variant="tertiary" size="sm" className="shrink-0">
                        {t('features_page.chips.dormant')}
                      </Chip>
                      <span>{t('features_page.maturity_dormant')}</span>
                    </li>
                  </ul>
                </div>

                {/* Tech stack */}
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {t('features_page.tech_stack_title')}
                  </h3>
                  <ul className="grid list-none gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {TECH_STACK.map((row) => (
                      <li key={row}>
                        <strong>{t(`features_page.tech_stack.${row}_label`)}:</strong>{' '}
                        {t(`features_page.tech_stack.${row}_value`)}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Open source + how to help */}
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {t('features_page.open_source_title')}
                  </h3>
                  <p>{t('features_page.open_source_body')}</p>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="https://github.com/jasperfordesq-ai/Project-NEXUS"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={TEXT_LINK}
                    >
                      <Github className="size-3.5" aria-hidden="true" />
                      {t('features_page.link_repo')}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                    <Link to={tenantPath('/changelog')} className={TEXT_LINK}>
                      {t('features_page.link_changelog')}
                    </Link>
                    <a
                      href="https://project-nexus.canny.io/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={TEXT_LINK}
                    >
                      <Bug className="size-3.5" aria-hidden="true" />
                      {t('features_page.link_report_bug')}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                    <Link to={tenantPath('/about')} className={TEXT_LINK}>
                      {t('features_page.link_about')}
                    </Link>
                  </div>
                </div>

                {/* Security disclosure */}
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {t('features_page.security_title')}
                  </h3>
                  <p>
                    {t('features_page.security_body_before')}
                    <a href="mailto:jasper@hour-timebank.ie" className={TEXT_LINK}>
                      {t('features_page.security_email')}
                    </a>
                    {t('features_page.security_body_after')}
                  </p>
                </div>
              </DisclosureBody>
            </DisclosureContent>
          </Disclosure>
        </Card.Content>
      </Card>
    </section>
  );
}

export default TechnicalNotes;
