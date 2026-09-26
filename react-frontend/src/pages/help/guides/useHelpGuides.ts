// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import type { TenantFeatures, TenantModules } from '@/types/api';
import { HELP_AUDIENCES, HELP_AUDIENCE_NAMESPACE, type HelpAudience, type HelpGateContext } from './types';
import { articleKey, sectionKey, visibleSections, type VisibleSection } from './registry';
import { helpBodyToPlainText } from './HelpBody';

export const HELP_NAMESPACES = ['help_centre', ...HELP_AUDIENCES.map((a) => HELP_AUDIENCE_NAMESPACE[a])];

export interface HelpSearchResult {
  audience: HelpAudience;
  sectionId: string;
  articleId: string;
  title: string;
  summary: string;
  sectionTitle: string;
  score: number;
}

interface IndexEntry extends Omit<HelpSearchResult, 'score'> {
  titleText: string;
  summaryText: string;
  sectionText: string;
  bodyText: string;
}

/** Lower-case and strip accents so "pagamento" matches "Pagamento" and "é" matches "e". */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Scripts written without spaces between words, where any substring can be a word. */
const NO_WORD_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Whether `word` starts a word somewhere in `text`: "pot" finds "pot" and
 * "pots" but not "spot". Japanese has no spaces, so any match counts there.
 */
function hasWord(text: string, word: string): boolean {
  if (NO_WORD_SPACES.test(word)) return text.includes(word);
  let from = text.indexOf(word);
  while (from !== -1) {
    if (from === 0 || !LETTER_OR_DIGIT.test(text.charAt(from - 1))) return true;
    from = text.indexOf(word, from + 1);
  }
  return false;
}

export function useHelpGuides() {
  const { t, i18n } = useTranslation(HELP_NAMESPACES);
  const { hasFeature, hasModule } = useTenant();

  const gateContext = useMemo<HelpGateContext>(() => ({
    hasFeature: (feature) => hasFeature(feature as keyof TenantFeatures),
    hasModule: (module) => hasModule(module as keyof TenantModules),
  }), [hasFeature, hasModule]);

  /** Text from an audience's guide namespace. */
  const guideText = useCallback(
    (audience: HelpAudience, key: string) => t(key, { ns: HELP_AUDIENCE_NAMESPACE[audience] }),
    [t],
  );

  const sectionsFor = useCallback(
    (audience: HelpAudience): VisibleSection[] => visibleSections(audience, gateContext),
    [gateContext],
  );

  const index = useMemo<IndexEntry[]>(() => {
    const entries: IndexEntry[] = [];
    for (const audience of HELP_AUDIENCES) {
      for (const section of visibleSections(audience, gateContext)) {
        const sectionTitle = guideText(audience, sectionKey(section.id, 'title'));
        for (const article of section.articles) {
          const title = guideText(audience, articleKey(section.id, article.id, 'title'));
          const summary = guideText(audience, articleKey(section.id, article.id, 'summary'));
          const body = guideText(audience, articleKey(section.id, article.id, 'body'));
          entries.push({
            audience,
            sectionId: section.id,
            articleId: article.id,
            title,
            summary,
            sectionTitle,
            titleText: fold(title),
            summaryText: fold(summary),
            sectionText: fold(sectionTitle),
            bodyText: fold(helpBodyToPlainText(body)),
          });
        }
      }
    }
    return entries;
    // i18n.language: rebuild the index when the reader switches language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateContext, guideText, i18n.language]);

  /** Every guide containing all the words searched for, best matches first. */
  const search = useCallback((query: string): HelpSearchResult[] => {
    const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2 || NO_WORD_SPACES.test(word));
    if (words.length === 0) return [];

    const results: HelpSearchResult[] = [];
    for (const entry of index) {
      let score = 0;
      let allFound = true;
      for (const word of words) {
        let wordScore = 0;
        if (hasWord(entry.titleText, word)) wordScore += 6;
        if (hasWord(entry.summaryText, word)) wordScore += 3;
        if (hasWord(entry.sectionText, word)) wordScore += 2;
        if (hasWord(entry.bodyText, word)) wordScore += 1;
        if (wordScore === 0) {
          allFound = false;
          break;
        }
        score += wordScore;
      }
      if (allFound) {
        const { titleText: _t, summaryText: _s, sectionText: _c, bodyText: _b, ...result } = entry;
        results.push({ ...result, score });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }, [index]);

  return { t, guideText, sectionsFor, search };
}
