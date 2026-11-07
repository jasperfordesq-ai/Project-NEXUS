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
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { GlassCard } from '@/components/ui/GlassCard';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { faqAnswerText } from '@/pages/help/guides/faqText';

interface CommunityFaq {
  id: number | string;
  question: string;
  answer: string;
}

interface CommunityFaqGroup {
  category: string;
  faqs: CommunityFaq[];
}

function FaqAnswer({ faq, category }: { faq: CommunityFaq; category: string }) {
  const [translated, setTranslated] = useState('');
  return (
    <>
      {translated
        ? <p className="text-sm leading-relaxed text-theme-muted whitespace-pre-wrap" dir="auto">{translated}</p>
        : <SafeHtml content={faq.answer} className="text-sm leading-relaxed text-theme-muted" />}
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

export function CommunityFaqs() {
  const { t } = useTranslation('help_centre');
  const { branding } = useTenant();
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

  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="community-faqs-heading" className="space-y-3">
      <div>
        <h2 id="community-faqs-heading" className="text-xl font-semibold text-theme-primary">{t('community_faqs_heading')}</h2>
        <p className="mt-1 text-sm text-theme-muted">{t('community_faqs_description', { name: branding.name })}</p>
      </div>
      <GlassCard className="p-2 sm:p-4">
        <Accordion variant="light" selectionMode="multiple">
          {groups.flatMap((group) => group.faqs.map((faq) => (
            <AccordionItem key={String(faq.id)} id={String(faq.id)} aria-label={faq.question} title={faq.question} subtitle={group.category}>
              <FaqAnswer faq={faq} category={group.category} />
            </AccordionItem>
          )))}
        </Accordion>
      </GlassCard>
    </section>
  );
}

export default CommunityFaqs;
