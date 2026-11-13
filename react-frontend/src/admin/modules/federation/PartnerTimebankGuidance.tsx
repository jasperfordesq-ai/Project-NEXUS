// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CircleHelp from 'lucide-react/icons/circle-help';

import { Accordion, AccordionItem } from '@/components/ui';
import { useTenant } from '@/contexts';

export type PartnerTimebankGuidePage =
  | 'settings'
  | 'partnerships'
  | 'directory'
  | 'creditAgreements'
  | 'externalPartners'
  | 'apiKeys'
  | 'apiDocs'
  | 'webhooks'
  | 'creditCommons'
  | 'apiPartners'
  | 'dataManagement'
  | 'activityFeed'
  | 'analytics'
  | 'aggregates';

interface RelatedLink {
  labelKey: string;
  href: string;
}

const RELATED_LINKS: Record<PartnerTimebankGuidePage, RelatedLink[]> = {
  settings: [
    { labelKey: 'partnerships', href: '/partner-timebanks/partnerships' },
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'apiPartners', href: '/partner-timebanks/inbound-api' },
  ],
  partnerships: [
    { labelKey: 'settings', href: '/partner-timebanks/settings' },
    { labelKey: 'creditAgreements', href: '/partner-timebanks/credit-agreements' },
    { labelKey: 'activityFeed', href: '/partner-timebanks/activity' },
  ],
  directory: [
    { labelKey: 'partnerships', href: '/partner-timebanks/partnerships' },
    { labelKey: 'settings', href: '/partner-timebanks/settings' },
  ],
  creditAgreements: [
    { labelKey: 'partnerships', href: '/partner-timebanks/partnerships' },
    { labelKey: 'creditCommons', href: '/partner-timebanks/credit-commons' },
    { labelKey: 'activityFeed', href: '/partner-timebanks/activity' },
  ],
  externalPartners: [
    { labelKey: 'apiKeys', href: '/partner-timebanks/api-keys' },
    { labelKey: 'webhooks', href: '/partner-timebanks/webhooks' },
    { labelKey: 'apiDocs', href: '/partner-timebanks/api-docs' },
  ],
  apiKeys: [
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'apiDocs', href: '/partner-timebanks/api-docs' },
    { labelKey: 'webhooks', href: '/partner-timebanks/webhooks' },
  ],
  apiDocs: [
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'apiKeys', href: '/partner-timebanks/api-keys' },
    { labelKey: 'apiPartners', href: '/partner-timebanks/inbound-api' },
  ],
  webhooks: [
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'apiKeys', href: '/partner-timebanks/api-keys' },
    { labelKey: 'apiDocs', href: '/partner-timebanks/api-docs' },
  ],
  creditCommons: [
    { labelKey: 'creditAgreements', href: '/partner-timebanks/credit-agreements' },
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
  ],
  apiPartners: [
    { labelKey: 'apiDocs', href: '/partner-timebanks/api-docs' },
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'webhooks', href: '/partner-timebanks/webhooks' },
  ],
  dataManagement: [
    { labelKey: 'activityFeed', href: '/partner-timebanks/activity' },
    { labelKey: 'externalPartners', href: '/partner-timebanks/external-partners' },
    { labelKey: 'partnerships', href: '/partner-timebanks/partnerships' },
  ],
  activityFeed: [
    { labelKey: 'analytics', href: '/partner-timebanks/analytics' },
    { labelKey: 'dataManagement', href: '/partner-timebanks/data' },
  ],
  analytics: [
    { labelKey: 'activityFeed', href: '/partner-timebanks/activity' },
    { labelKey: 'aggregates', href: '/partner-timebanks/aggregates' },
  ],
  aggregates: [
    { labelKey: 'analytics', href: '/partner-timebanks/analytics' },
    { labelKey: 'dataManagement', href: '/partner-timebanks/data' },
  ],
};

const guidanceAccordionItemClasses = {
  base: 'rounded-lg border border-divider bg-surface',
  trigger: 'px-3 py-2',
  title: 'text-sm font-medium text-muted',
  content: 'px-3 pb-3 pt-0 text-sm leading-6 text-muted',
};

/**
 * "Where this page fits" — background for the admin who wants it.
 *
 * One row, CLOSED until opened. Until November 2026 this was a card with a
 * title, a summary, a badge and two sections open by default; it sat above
 * the content of every partner page and, on a phone, pushed the actual list
 * about four screens down. The page header already says what the page is
 * for, so the title, summary and badge are gone and everything else moved
 * inside the one closed row. Nothing was removed from what it says.
 */
export function PartnerTimebankGuidance({ page }: { page: PartnerTimebankGuidePage }) {
  const { t } = useTranslation('admin_federation');
  const { tenantPath } = useTenant();
  const prefix = `federation_admin_guidance.pages.${page}`;
  const related = RELATED_LINKS[page];

  return (
    <section aria-label={t('federation_admin_guidance.shared.fit_title')}>
      <Accordion selectionMode="multiple" defaultExpandedKeys={[]} variant="splitted">
        <AccordionItem
          key="fit"
          id="fit"
          classNames={guidanceAccordionItemClasses}
          startContent={<CircleHelp aria-hidden="true" size={16} className="text-muted" />}
          title={t('federation_admin_guidance.shared.fit_title')}
        >
          <p className="font-medium text-foreground">{t(`${prefix}.title`)}</p>
          <p className="mt-1">{t(`${prefix}.summary`)}</p>
          <p className="mt-2">{t('federation_admin_guidance.shared.fit_intro')}</p>
          <p className="mt-2">{t(`${prefix}.fit`)}</p>
          <p className="mt-2 font-medium text-foreground">{t(`${prefix}.avoid`)}</p>

          <p className="mt-4 font-medium text-foreground">{t('federation_admin_guidance.shared.steps_title')}</p>
          <ol className="mt-1 list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">{t(`${prefix}.step_1_title`)}</span>
              <span className="block">{t(`${prefix}.step_1_body`)}</span>
            </li>
            <li>
              <span className="font-medium text-foreground">{t(`${prefix}.step_2_title`)}</span>
              <span className="block">{t(`${prefix}.step_2_body`)}</span>
            </li>
            <li>
              <span className="font-medium text-foreground">{t(`${prefix}.step_3_title`)}</span>
              <span className="block">{t(`${prefix}.step_3_body`)}</span>
            </li>
          </ol>

          <p className="mt-4 font-medium text-foreground">{t('federation_admin_guidance.shared.related_title')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {related.map((link) => (
              <RouterLink
                key={link.href}
                to={tenantPath(link.href)}
                className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
              >
                {t(`federation_admin_guidance.links.${link.labelKey}`)}
              </RouterLink>
            ))}
          </div>
        </AccordionItem>
      </Accordion>
    </section>
  );
}

export default PartnerTimebankGuidance;
