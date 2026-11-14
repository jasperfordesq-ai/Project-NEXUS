// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's own questions and answers (Admin → Help FAQs), shown on the
 * FAQ page the main menu links to. AWID focus group, Oct 2026: "Can we
 * customise the text in places like FAQ?" The admin-written FAQs appeared only
 * in the Help Centre, so a community's own words never reached the menu's FAQ
 * page, which is fixed platform text. Renders nothing when there are none.
 *
 * The page loads the questions itself (`useCommunityFaqs`) and hands this
 * component the ones to show, so the page's search box covers the community's
 * questions as well as the standard ones (14 Nov 2026; until then it searched
 * the standard ones only).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MessagesSquare from 'lucide-react/icons/messages-square';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { faqAnswerText } from '@/pages/help/guides/faqText';
import { FaqSection } from './FaqSection';

export interface CommunityFaq {
  id: number | string;
  question: string;
  answer: string;
}

export interface CommunityFaqGroup {
  category: string;
  faqs: CommunityFaq[];
}

/**
 * The community's own questions, loaded once. Empty until they arrive, when
 * there are none, and when they could not be loaded — the standard questions
 * are still there, so a failure here is not worth an error on the page.
 */
export function useCommunityFaqs(): CommunityFaqGroup[] {
  const [groups, setGroups] = useState<CommunityFaqGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api.get<CommunityFaqGroup[]>('/v2/help/faqs').then((result) => {
      if (!cancelled && result.success && Array.isArray(result.data)) {
        setGroups(result.data.filter((group) => Array.isArray(group.faqs) && group.faqs.length > 0));
      }
    });
    return () => { cancelled = true; };
  }, []);

  return groups;
}

/** Every word a reader can see in one community question, for the page's search. */
export function communityFaqText(faq: CommunityFaq, category: string): string {
  return `${faq.question} ${faqAnswerText(faq.answer)} ${category}`;
}

function FaqAnswer({ faq, category }: { faq: CommunityFaq; category: string }) {
  const [translated, setTranslated] = useState('');
  return (
    <>
      {translated
        ? <p className="whitespace-pre-wrap leading-7 text-theme-secondary" dir="auto">{translated}</p>
        : <SafeHtml content={faq.answer} className="leading-7 text-theme-secondary" />}
      <TranslateButton
        contentType="faq"
        contentId={faq.id}
        sourceText={faqAnswerText(faq.answer)}
        extraFields={{ question: faq.question, category }}
        onTextChange={(text, isTranslated) => setTranslated(isTranslated ? text : '')}
      />
    </>
  );
}

export interface CommunityFaqsProps {
  /** The groups to show, already narrowed by the page's search. */
  groups: CommunityFaqGroup[];
}

export function CommunityFaqs({ groups }: CommunityFaqsProps) {
  const { t } = useTranslation('help_centre');
  const { branding } = useTenant();

  if (groups.length === 0) return null;

  return (
    <FaqSection
      id="faq-community"
      icon={<MessagesSquare className="size-6" aria-hidden="true" />}
      tint="bg-accent-soft text-accent-soft-foreground"
      title={t('community_faqs_heading')}
      description={t('community_faqs_description', { name: branding.name })}
    >
      <Accordion
        variant="splitted"
        selectionMode="multiple"
        itemClasses={{ title: 'text-base font-medium text-foreground' }}
        data-testid="faq-community-questions"
      >
        {groups.flatMap((group) => group.faqs.map((faq) => (
          <AccordionItem
            key={String(faq.id)}
            id={String(faq.id)}
            aria-label={faq.question}
            title={faq.question}
            subtitle={group.category}
          >
            <FaqAnswer faq={faq} category={group.category} />
          </AccordionItem>
        )))}
      </Accordion>
    </FaqSection>
  );
}

export default CommunityFaqs;
