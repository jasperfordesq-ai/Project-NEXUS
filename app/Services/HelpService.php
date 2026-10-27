<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * HelpService — Eloquent-based service for help/FAQ operations.
 *
 * FAQs are stored in help_faqs with tenant fallback to global (tenant_id = 0).
 */
class HelpService
{
    /**
     * Get published FAQs for a tenant, grouped by category.
     * Falls back to global defaults (tenant_id = 0) if tenant has none.
     *
     * @return array Array of { category: string, faqs: { id, question, answer }[] }
     */
    public function getFaqs(int $tenantId, ?int $categoryId = null, ?string $search = null): array
    {
        $query = DB::table('help_faqs')
            ->where('tenant_id', $tenantId)
            ->where('is_published', 1);

        if ($categoryId) {
            // help_faqs has no category_id column — category is a varchar
            $query->where('category', $categoryId);
        }

        // 🔴 Answers are admin-authored HTML. A SQL LIKE on the column matched
        // the markup, so "strong" or "href" found every formatted answer and a
        // link's target matched words the member never sees (React dbf875e5
        // fixed this client-side). The search is therefore applied in PHP to
        // the visible text of the tenant's published rows, which are few. The
        // tenant and category scoping above is unchanged.
        $faqs = $query->orderBy('category')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->all();

        $needle = $search !== null ? $this->visibleText($search) : '';
        if ($needle !== '') {
            $faqs = array_values(array_filter($faqs, fn ($faq): bool =>
                mb_stripos($this->visibleText((string) ($faq->question ?? '')), $needle) !== false
                || mb_stripos($this->visibleText((string) ($faq->answer ?? '')), $needle) !== false));
        }

        // Fallback to global defaults
        if (empty($faqs) && ! $categoryId && ! $search) {
            $faqs = DB::table('help_faqs')
                ->where('tenant_id', 0)
                ->where('is_published', 1)
                ->orderBy('category')
                ->orderBy('sort_order')
                ->orderBy('id')
                ->get()
                ->all();
        }

        // Group by category
        $grouped = [];
        foreach ($faqs as $faq) {
            $cat = $faq->category ?? 'General';
            if (! isset($grouped[$cat])) {
                $grouped[$cat] = ['category' => $cat, 'faqs' => []];
            }
            $grouped[$cat]['faqs'][] = [
                'id'       => (int) $faq->id,
                'question' => $faq->question,
                'answer'   => $faq->answer,
            ];
        }

        return array_values($grouped);
    }

    /**
     * What a reader sees of an HTML fragment: tags removed (each one treated as
     * a word break, so "<li>a</li><li>b</li>" never reads "ab"), entities
     * decoded, whitespace collapsed.
     */
    private function visibleText(string $html): string
    {
        $text = strip_tags(str_replace('<', ' <', $html));
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        return trim((string) preg_replace('/\s+/u', ' ', $text));
    }
}
