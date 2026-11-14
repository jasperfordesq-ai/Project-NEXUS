// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FAQ page — every community's questions and answers, in the site's warm style
 * (owner, 14 Nov 2026). Until then it was the last public page still built
 * from glass cards, with a search that read the questions but not the answers.
 *
 * Top to bottom:
 *
 * 1. The warm banner every other page opens with.
 * 2. A search box over the questions AND the answers, the community's own
 *    questions included. It ignores accents and capitals.
 * 3. The short answers: three facts most visitors come for.
 * 4. Browse by topic: one coloured tile per group, which jumps to it.
 * 5. The community's own questions (Admin → Help FAQs), when it has any.
 * 6. The standard questions, a group at a time.
 * 7. A closing invitation to get in touch.
 *
 * While someone is searching, 3 and 4 step aside so the matches sit directly
 * under the search box.
 *
 * 🔴 ONE SOURCE, TWO FRONTENDS. The accessible site's /faq is generated from
 * the same wording (`public.json` → `faq.categories`) by
 * `web-uk/scripts/build-faq.js`, which reads the answers' keys IN ORDER and
 * fails on a key shape it does not know. After changing a question here, run
 * `npm --prefix web-uk run build:faq` and commit the result; `FAQ` below must
 * list the same keys in the same order as the English file.
 *
 * 🔴 The safety, insurance and data-protection answers keep their exact
 * meaning (docs/VOICE-AND-TONE.md, "What does not change"). They were not
 * reworded when the rest of the page was.
 *
 * A group or question that points at something the community has switched off
 * is left out: the badges group without gamification, the wallet and settings
 * links without those modules.
 *
 * Nothing on the page waits for an animation to become visible: the old page
 * faded each card in, which left it blank for anything that reads the page
 * without running the animation.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import MessageCircleQuestion from 'lucide-react/icons/message-circle-question';
import Sprout from 'lucide-react/icons/sprout';
import Coins from 'lucide-react/icons/coins';
import Handshake from 'lucide-react/icons/handshake';
import Trophy from 'lucide-react/icons/trophy';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Gift from 'lucide-react/icons/gift';
import Clock from 'lucide-react/icons/clock';
import Sparkles from 'lucide-react/icons/sparkles';
import SearchX from 'lucide-react/icons/search-x';
import HelpCircle from 'lucide-react/icons/circle-help';
import BookOpen from 'lucide-react/icons/book-open';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useTenant, useAuth } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SearchField } from '@/components/ui/SearchField';
import { SignInLock } from '@/components/navigation/SignInLock';
import { showsSignInLock } from '@/components/navigation/signInRequired';
import { CommunityFaqs, communityFaqText, useCommunityFaqs } from '@/components/help/CommunityFaqs';
import { FaqSection } from '@/components/help/FaqSection';
import { categoryColour } from '@/lib/categoryColours';
import { toJsonLd } from '@/lib/json-ld';
import { foldText, matchesEveryWord, queryWords } from '@/pages/help/guides/searchText';

/* ─────────────── The questions ─────────────── */

/**
 * How one answer is put together. Each piece names the wording key it shows
 * (under `faq.categories.<group>.<question>`), in the order it is read.
 */
type AnswerPiece =
  /** A paragraph. */
  | { kind: 'text'; key: string }
  /**
   * A list of `<prefix>1` … `<prefix><count>`. With `lead`, each item opens
   * with a bold phrase (`_bold`) followed by the rest (`_text`): after a dash,
   * or straight on when the two read as one sentence. A list of steps
   * (`step…`) is numbered, because its order matters.
   */
  | { kind: 'list'; prefix: string; count: number; lead?: 'dash' | 'sentence' }
  /** A sentence with a link in it. Left out when its page is switched off. */
  | { kind: 'link'; before: string; link: string; after: string; to: string; module?: 'wallet' | 'settings' };

interface QuestionPlan {
  key: string;
  pieces: readonly AnswerPiece[];
}

interface GroupPlan {
  key: string;
  icon: ReactNode;
  /** The whole group is about this optional part of the site. */
  feature?: 'gamification';
  questions: readonly QuestionPlan[];
}

const text = (...keys: string[]): AnswerPiece[] => keys.map((key) => ({ kind: 'text', key }));
const list = (prefix: string, count: number, lead?: 'dash' | 'sentence'): AnswerPiece => ({
  kind: 'list',
  prefix,
  count,
  lead,
});

const GROUP_ICON = 'size-6';

const FAQ: readonly GroupPlan[] = [
  {
    key: 'getting_started',
    icon: <Sprout className={GROUP_ICON} aria-hidden="true" />,
    questions: [
      {
        key: 'q1',
        pieces: [
          ...text('answer_p1', 'answer_p2'),
          {
            kind: 'link',
            before: 'answer_link_before',
            link: 'guide_link',
            after: 'answer_link_after',
            to: '/timebanking-guide',
          },
        ],
      },
      { key: 'q2', pieces: text('answer_p1', 'answer_p2') },
      { key: 'q3', pieces: [...text('answer_intro'), list('step', 5, 'dash')] },
      { key: 'q4', pieces: [...text('answer_intro'), list('skill', 7), ...text('answer_outro')] },
    ],
  },
  {
    key: 'time_credits',
    icon: <Coins className={GROUP_ICON} aria-hidden="true" />,
    questions: [
      { key: 'q1', pieces: text('answer_p1', 'answer_p2') },
      { key: 'q2', pieces: [...text('answer_intro'), list('way', 4, 'sentence')] },
      {
        key: 'q3',
        pieces: [
          ...text('answer_intro'),
          list('option', 2),
          {
            kind: 'link',
            before: 'answer_link_before',
            link: 'wallet_link',
            after: 'answer_link_after',
            to: '/wallet',
            module: 'wallet',
          },
        ],
      },
      { key: 'q4', pieces: text('answer') },
      { key: 'q5', pieces: [...text('answer_intro'), list('step', 2), ...text('answer_outro')] },
    ],
  },
  {
    key: 'exchanges_safety',
    icon: <Handshake className={GROUP_ICON} aria-hidden="true" />,
    questions: [
      { key: 'q1', pieces: [...text('answer_intro'), list('step', 6)] },
      { key: 'q2', pieces: [...text('answer_intro'), list('tip', 5), ...text('answer_outro')] },
      { key: 'q3', pieces: [...text('answer_intro'), list('step', 3), ...text('answer_outro')] },
      { key: 'q4', pieces: text('answer') },
    ],
  },
  {
    key: 'badges_rewards',
    icon: <Trophy className={GROUP_ICON} aria-hidden="true" />,
    feature: 'gamification',
    questions: [
      { key: 'q1', pieces: [...text('answer_intro'), list('item', 4, 'dash')] },
      { key: 'q2', pieces: [...text('answer_intro'), list('activity', 7)] },
      {
        key: 'q3',
        pieces: [
          {
            kind: 'link',
            before: 'answer_before_link',
            link: 'settings_link',
            after: 'answer_after_link',
            to: '/settings',
            module: 'settings',
          },
        ],
      },
    ],
  },
  {
    key: 'account_privacy',
    icon: <ShieldCheck className={GROUP_ICON} aria-hidden="true" />,
    questions: [
      {
        key: 'q1',
        pieces: [
          {
            kind: 'link',
            before: 'answer_before_link',
            link: 'settings_link',
            after: 'answer_after_link',
            to: '/settings',
            module: 'settings',
          },
        ],
      },
      {
        key: 'q2',
        pieces: [
          ...text('answer_intro'),
          list('item', 3),
          {
            kind: 'link',
            before: 'answer_link_before',
            link: 'settings_link',
            after: 'answer_link_after',
            to: '/settings',
            module: 'settings',
          },
        ],
      },
      { key: 'q3', pieces: [...text('answer_intro'), list('step', 3), ...text('answer_outro')] },
      { key: 'q4', pieces: [...text('answer_intro'), list('item', 4)] },
    ],
  },
];

/** Wording lives at `faq.glance_<index>_value` / `_label`. */
const GLANCE_ICONS: readonly ReactNode[] = [
  <Gift key="free" className="size-5" aria-hidden="true" />,
  <Clock key="hour" className="size-5" aria-hidden="true" />,
  <Sparkles key="skill" className="size-5" aria-hidden="true" />,
];

/** A search that finds this few questions opens them, so the match can be read at once. */
const OPEN_WHEN_AT_MOST = 3;

const SECTION_HEADING = 'text-xl font-semibold text-foreground';
const TEXT_LINK =
  'font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2';

/* ─────────────── An answer, ready to show ─────────────── */

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'list'; numbered: boolean; items: { bold: string; joiner: string; text: string }[] }
  | { kind: 'link'; before: string; text: string; after: string; to: string };

interface Question {
  id: string;
  question: string;
  blocks: Block[];
  /** The whole answer as one plain sentence run, for search engines. */
  plain: string;
  /** Question and answer with accents and capitals removed, for the search box. */
  searchable: string;
}

interface Group {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  questions: Question[];
}

type OpenKeys = Set<string | number>;

function blockText(block: Block): string {
  if (block.kind === 'text') return block.text;
  if (block.kind === 'link') return `${block.before}${block.text}${block.after}`;
  return block.items.map((item) => `${item.bold}${item.joiner}${item.text}`).join('; ');
}

function Answer({ blocks, lockFor }: { blocks: Block[]; lockFor: (to: string) => boolean }) {
  const { tenantPath } = useTenant();

  return (
    <div className="space-y-3 leading-7 text-theme-secondary">
      {blocks.map((block, index) => {
        // An answer's pieces never reorder: the index IS the piece.
        if (block.kind === 'text') return <p key={index}>{block.text}</p>;

        if (block.kind === 'link') {
          return (
            <p key={index}>
              {block.before}
              <Link to={tenantPath(block.to)} className={TEXT_LINK}>
                {block.text}
                {lockFor(block.to) && <SignInLock className="ms-1 align-middle" />}
              </Link>
              {block.after}
            </p>
          );
        }

        const items = block.items.map((item, itemIndex) => (
          <li key={itemIndex} className="flex gap-3">
            {block.numbered ? (
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-foreground"
              >
                {itemIndex + 1}
              </span>
            ) : (
              <span aria-hidden="true" className="mt-[0.7rem] size-1.5 shrink-0 rounded-full bg-accent" />
            )}
            <span className="min-w-0">
              {item.bold && <strong className="font-semibold text-foreground">{item.bold}</strong>}
              {item.joiner}
              {item.text}
            </span>
          </li>
        ));

        // The markers are drawn by hand (list-none) so they can carry the
        // community's colour.
        return block.numbered ? (
          <ol key={index} className="list-none space-y-2">
            {items}
          </ol>
        ) : (
          <ul key={index} className="list-none space-y-1.5">
            {items}
          </ul>
        );
      })}
    </div>
  );
}

/* ─────────────── Component ─────────────── */

export function FaqPage() {
  const { t } = useTranslation('public');
  const { tenantPath, hasModule, hasFeature, branding } = useTenant();
  const { isAuthenticated, isLoading } = useAuth();
  const palette = useSitePalette();
  usePageTitle(t('faq.title'));

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<OpenKeys>(() => new Set());
  const communityGroups = useCommunityFaqs();

  // Only for someone we know is signed out. While the sign-in check is still
  // running a member reloading the page would otherwise be asked to join.
  const invitesToJoin = !isAuthenticated && !isLoading;

  // The questions this community is shown, in this language.
  const groups: Group[] = useMemo(
    () =>
      FAQ.filter((group) => !group.feature || hasFeature(group.feature))
        .map((group) => {
          const questions = group.questions
            .map((plan): Question => {
              const at = (key: string) => t(`faq.categories.${group.key}.${plan.key}.${key}`);
              const blocks = plan.pieces.flatMap((piece): Block[] => {
                if (piece.kind === 'text') return [{ kind: 'text', text: at(piece.key) }];
                if (piece.kind === 'link') {
                  if (piece.module && !hasModule(piece.module)) return [];
                  return [
                    { kind: 'link', before: at(piece.before), text: at(piece.link), after: at(piece.after), to: piece.to },
                  ];
                }
                return [
                  {
                    kind: 'list',
                    numbered: piece.prefix === 'step',
                    items: Array.from({ length: piece.count }, (_, index) => {
                      const item = `${piece.prefix}${index + 1}`;
                      return piece.lead
                        ? {
                            bold: at(`${item}_bold`),
                            joiner: piece.lead === 'dash' ? ' — ' : ' ',
                            text: at(`${item}_text`),
                          }
                        : { bold: '', joiner: '', text: at(item) };
                    }),
                  },
                ];
              });
              const question = at('question');
              const plain = blocks.map(blockText).join(' ');
              return {
                id: `${group.key}-${plan.key}`,
                question,
                blocks,
                plain,
                searchable: foldText(`${question} ${plain}`),
              };
            })
            // A question whose whole answer was a link to a page that is
            // switched off has nothing left to say.
            .filter((question) => question.blocks.length > 0);

          return {
            key: group.key,
            icon: group.icon,
            title: t(`faq.categories.${group.key}.title`),
            description: t(`faq.categories.${group.key}.description`),
            questions,
          };
        })
        .filter((group) => group.questions.length > 0),
    [hasFeature, hasModule, t],
  );

  // The same questions for search engines, each with its whole answer.
  const faqSchema = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: groups.flatMap((group) =>
        group.questions.map((question) => ({
          '@type': 'Question' as const,
          name: question.question,
          acceptedAnswer: { '@type': 'Answer' as const, text: question.plain },
        })),
      ),
    }),
    [groups],
  );

  const words = useMemo(() => queryWords(query), [query]);
  const isSearching = words.length > 0;

  const shownGroups = useMemo(
    () =>
      isSearching
        ? groups
            .map((group) => ({
              ...group,
              questions: group.questions.filter((question) => matchesEveryWord(question.searchable, words)),
            }))
            .filter((group) => group.questions.length > 0)
        : groups,
    [groups, isSearching, words],
  );

  const shownCommunityGroups = useMemo(
    () =>
      isSearching
        ? communityGroups
            .map((group) => ({
              ...group,
              faqs: group.faqs.filter((faq) =>
                matchesEveryWord(foldText(communityFaqText(faq, group.category)), words),
              ),
            }))
            .filter((group) => group.faqs.length > 0)
        : communityGroups,
    [communityGroups, isSearching, words],
  );

  const matches =
    shownGroups.reduce((sum, group) => sum + group.questions.length, 0) +
    shownCommunityGroups.reduce((sum, group) => sum + group.faqs.length, 0);

  const search = (value: string) => {
    setQuery(value);
    // A handful of matches: open them, because the word looked for may be in
    // the answer and not in the question.
    const typed = queryWords(value);
    if (typed.length === 0) return;
    const found = groups.flatMap((group) =>
      group.questions.filter((question) => matchesEveryWord(question.searchable, typed)).map((question) => question.id),
    );
    if (found.length > 0 && found.length <= OPEN_WHEN_AT_MOST) setOpen(new Set(found));
  };

  const lockFor = (to: string) => showsSignInLock(tenantPath(to), { isAuthenticated, isLoading }, tenantPath('/'));

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta title={t('faq.page_title')} description={t('faq.meta_description', { name: branding.name })} />
      <Helmet>
        <script type="application/ld+json">{toJsonLd(faqSchema)}</script>
      </Helmet>

      <div className="space-y-4">
        <PublicPageHero
          title={t('faq.title')}
          description={t('faq.hero_description', { name: branding.name })}
          icon={<MessageCircleQuestion className="h-7 w-7" aria-hidden="true" />}
          action={
            invitesToJoin ? (
              <Button as={Link} to={tenantPath('/register')} variant="primary" size="lg">
                {t('faq.join')}
              </Button>
            ) : undefined
          }
        />

        {/* ─── Search: the questions and the answers ─── */}
        <div role="search" className="space-y-2">
          <SearchField
            size="lg"
            className="w-full"
            placeholder={t('faq.search_placeholder')}
            aria-label={t('faq.search_placeholder')}
            value={query}
            onChange={(event) => search(event.target.value)}
          />
          {/* Always in the page, so a screen reader hears the count change. */}
          <p role="status" data-testid="faq-match-count" className="min-h-5 text-sm text-theme-muted">
            {isSearching && matches > 0 ? t('faq.results_count', { total: matches }) : ''}
          </p>
        </div>
      </div>

      {!isSearching && (
        <>
          {/* ─── The short answers ─── */}
          <section aria-labelledby="faq-glance-heading" className="space-y-4">
            <h2 id="faq-glance-heading" className={SECTION_HEADING}>
              {t('faq.glance_heading')}
            </h2>
            <ul data-testid="faq-glance" className="grid list-none gap-3 sm:grid-cols-3">
              {GLANCE_ICONS.map((icon, index) => (
                // A fixed list that never reorders.
                <li key={index} className="flex items-start gap-3 rounded-2xl bg-accent-soft p-4 sm:flex-col sm:p-5">
                  <span className="mt-1 shrink-0 text-accent sm:mt-0">{icon}</span>
                  <div className="min-w-0">
                    <p className="text-xl font-bold tracking-tight text-balance text-foreground">
                      {t(`faq.glance_${index}_value`)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-theme-secondary">{t(`faq.glance_${index}_label`)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ─── Browse by topic ─── */}
          <nav aria-labelledby="faq-topics-heading" className="space-y-4">
            <h2 id="faq-topics-heading" className={SECTION_HEADING}>
              {t('faq.topics_heading')}
            </h2>
            <ul data-testid="faq-topics" className="grid list-none grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {groups.map((group, index) => (
                // An odd tile left alone on a phone's last row takes the whole row.
                <li key={group.key} className="max-sm:last:odd:col-span-2">
                  {/* A plain in-page link: the browser does the jump, and the
                      address can be shared. The community's own colours, one
                      per group, in a fixed order. */}
                  <a
                    href={`#faq-${group.key}`}
                    className={`flex h-full flex-col gap-3 rounded-2xl p-4 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${categoryColour(palette[index % palette.length]).band}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      {group.icon}
                      {/* How many questions the group holds; the group's own
                          heading says the same to a screen reader. */}
                      <span aria-hidden="true" className="text-sm font-semibold tabular-nums">
                        {group.questions.length}
                      </span>
                    </span>
                    <span className="text-sm font-semibold leading-5">{group.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}

      {/* ─── The community's own questions first (Admin → Help FAQs; AWID, Oct 2026) ─── */}
      <CommunityFaqs groups={shownCommunityGroups} />

      {/* ─── The standard questions ─── */}
      {shownGroups.map((group) => {
        const index = groups.findIndex((candidate) => candidate.key === group.key);
        const ids = group.questions.map((question) => question.id);
        return (
          <FaqSection
            key={group.key}
            id={`faq-${group.key}`}
            icon={group.icon}
            tint={categoryColour(palette[index % palette.length]).band}
            title={group.title}
            description={group.description}
          >
            <Accordion
              variant="splitted"
              selectionMode="multiple"
              itemClasses={{ title: 'text-base font-medium text-foreground' }}
              expandedKeys={open}
              onExpandedChange={(keys) =>
                // One set serves every group. Keep the other groups' open
                // questions and take this group's from what it reports.
                setOpen((previous) => {
                  const next: OpenKeys = new Set([...previous].filter((key) => !ids.includes(String(key))));
                  for (const key of keys) if (ids.includes(String(key))) next.add(key);
                  return next;
                })
              }
            >
              {group.questions.map((question) => (
                <AccordionItem key={question.id} id={question.id} aria-label={question.question} title={question.question}>
                  <Answer blocks={question.blocks} lockFor={lockFor} />
                </AccordionItem>
              ))}
            </Accordion>
          </FaqSection>
        );
      })}

      {/* ─── Nothing matches ─── */}
      {isSearching && matches === 0 && (
        <Card className="border border-border shadow-sm">
          <Card.Content className="flex flex-col items-center gap-4 p-4 text-center sm:p-8">
            <span className="inline-flex rounded-2xl bg-accent-soft p-3 text-accent-soft-foreground">
              <SearchX className="size-6" aria-hidden="true" />
            </span>
            <p className="max-w-md text-theme-secondary">{t('faq.no_results')}</p>
            <Button variant="secondary" onPress={() => setQuery('')}>
              {t('faq.clear_search')}
            </Button>
          </Card.Content>
        </Card>
      )}

      {/* ─── A closing invitation ─── */}
      <section aria-labelledby="faq-cta-heading">
        <Card className="border border-border shadow-sm">
          <Card.Content className="flex flex-col gap-6 p-1 sm:p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 id="faq-cta-heading" className={SECTION_HEADING}>
                {t('faq.cta_title')}
              </h2>
              <p className="mt-1 max-w-xl text-theme-muted">{t('faq.cta_description', { name: branding.name })}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:shrink-0 lg:justify-end">
              <Button
                as={Link}
                to={tenantPath('/contact')}
                variant="primary"
                endContent={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />}
              >
                {t('faq.cta_button')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/help')}
                variant="secondary"
                startContent={<HelpCircle className="size-4" aria-hidden="true" />}
              >
                {t('faq.cta_help')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/timebanking-guide')}
                variant="secondary"
                startContent={<BookOpen className="size-4" aria-hidden="true" />}
              >
                {t('faq.cta_guide')}
              </Button>
            </div>
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

export default FaqPage;
