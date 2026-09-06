// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * The community's help answers — `GET /api/v2/help/faqs`.
 *
 * 🔴 The support screen used to hand "Help centre" to a browser. Everything the
 * web help page shows comes from this one public endpoint, so there was never a
 * reason to leave the app; see `app/(modals)/help-faqs.tsx`.
 *
 * The server groups by category and answers with
 * `{ data: [{ category, faqs: [{ id, question, answer }] }] }`
 * (`App\Services\HelpService::getFaqs`). An empty `data` is a real answer — the
 * community has published nothing — not a failure.
 */

export interface HelpFaq {
  id: number;
  question: string;
  /** May contain HTML: admins compose answers in a rich editor. Render with `toPlainText`. */
  answer: string;
}

export interface HelpFaqCategory {
  category: string;
  faqs: HelpFaq[];
}

interface HelpFaqsEnvelope {
  data?: HelpFaqCategory[] | null;
}

/**
 * Every published answer, grouped by category.
 *
 * 🔴 Deliberately sends no `q`. The endpoint DOES accept one, but its
 * "fall back to the platform-wide defaults when this community has published
 * nothing" branch only runs when there is no search term — so a community with
 * no FAQs of its own shows the shared ones until the member types, at which
 * point the list empties and reads as "no results". Filtering happens on the
 * device instead, over the list the member can already see.
 */
export async function getHelpFaqs(): Promise<HelpFaqCategory[]> {
  const response = await api.get<HelpFaqsEnvelope | HelpFaqCategory[]>(`${API_V2}/help/faqs`);
  const payload = Array.isArray(response) ? response : response?.data;
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((group): group is HelpFaqCategory => !!group && Array.isArray(group.faqs))
    .map((group) => ({
      category: typeof group.category === 'string' && group.category.trim() ? group.category : '',
      faqs: group.faqs.filter((faq) => !!faq && typeof faq.question === 'string'),
    }))
    .filter((group) => group.faqs.length > 0);
}
