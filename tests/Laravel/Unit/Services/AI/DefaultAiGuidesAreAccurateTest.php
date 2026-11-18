<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\AI;

use App\Services\AI\AiModuleDocsService;
use PHPUnit\Framework\TestCase;

/**
 * Owner report, 18 Nov 2026: the AI assistant gave members false information,
 * for example that admins can only see messages reported for abuse. Every
 * claim in the built-in guides was re-checked against the code that day.
 *
 * These checks pin the corrections that matter most and keep the guides fit
 * to hand to the model: whole (not cut off), and free of internal names.
 */
final class DefaultAiGuidesAreAccurateTest extends TestCase
{
    /** Words a member should never be shown. */
    private const INTERNAL_WORDS = [
        'tenant', 'mobile/', 'Expo', 'React Native', 'Meilisearch', 'Laravel',
        'govuk', 'PWA', 'sw-reset', 'module_slug', 'feature flag',
    ];

    public function test_every_guide_fits_without_being_cut_off(): void
    {
        foreach (AiModuleDocsService::defaultSeed() as $slug => $guide) {
            $this->assertLessThanOrEqual(
                AiModuleDocsService::MAX_BODY_INJECT_CHARS,
                mb_strlen($guide['body']),
                "The '$slug' guide is longer than the assistant is shown, so it would be cut off"
            );
        }
    }

    public function test_no_live_guide_uses_internal_names(): void
    {
        foreach (AiModuleDocsService::defaultSeed() as $slug => $guide) {
            if (in_array($slug, AiModuleDocsService::RETIRED_SLUGS, true)) {
                continue;
            }
            foreach (self::INTERNAL_WORDS as $word) {
                // Whole words only: 'Expo' must not trip on 'Export'.
                $pattern = '/(?<![a-z])' . preg_quote($word, '/') . '(?![a-z])/i';
                $this->assertDoesNotMatchRegularExpression($pattern, $guide['body'], "The '$slug' guide mentions '$word'");
            }
        }
    }

    public function test_the_messages_guide_says_who_can_review_messages(): void
    {
        $body = AiModuleDocsService::defaultSeed()['messages']['body'];

        $this->assertStringNotContainsString('only see messages reported', $body);
        $this->assertStringContainsString('coordinators and administrators', $body);
        $this->assertStringContainsString('first messages', $body);
        $this->assertStringContainsString('review of every message', $body);
    }

    public function test_no_guide_says_a_balance_can_go_negative(): void
    {
        foreach (AiModuleDocsService::defaultSeed() as $slug => $guide) {
            $this->assertDoesNotMatchRegularExpression('/negative balances? (are|is) fine/i', $guide['body'], "The '$slug' guide says balances can go negative");
        }
        $this->assertStringContainsString("can't go below zero", AiModuleDocsService::defaultSeed()['wallet']['body']);
    }

    public function test_two_step_sign_in_is_described_as_an_authenticator_app_only(): void
    {
        $body = AiModuleDocsService::defaultSeed()['account_security']['body'];

        $this->assertStringContainsString('authenticator app', $body);
        $this->assertDoesNotMatchRegularExpression('/\b(SMS|text message)\b/i', $body);
        $this->assertStringContainsString('12 characters', $body);
    }
}
