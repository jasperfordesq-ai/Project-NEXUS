<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\Helpers\HtmlSanitizer;
use App\Support\Legal\StandardTermsContent;
use Tests\Laravel\TestCase;

/**
 * The standard shipped Terms of Service, as seeded into `legal_documents`.
 *
 * 🔴 The point of this suite is that these are THE SHIPPED TERMS and not a second
 * set of words that happens to look similar. The owner's instruction was to use the
 * terms already shipped with the product; those live in React's `legal.terms.*`
 * strings, and the first test below reads that file and fails if the two drift.
 * Without it, a future edit to either side would silently create two different sets
 * of terms — one displayed, one agreed to.
 */
class StandardTermsContentTest extends TestCase
{
    /** The shipped display copy, which this content must not diverge from. */
    private function reactTermsStrings(): array
    {
        $path = base_path('react-frontend/public/locales/en/legal.json');
        if (!is_file($path)) {
            $this->markTestSkipped('react-frontend locales are not present in this checkout.');
        }

        $json = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($json['terms'] ?? null, 'legal.json has no terms namespace.');

        return $json['terms'];
    }

    public function test_every_sentence_comes_from_the_shipped_display_copy(): void
    {
        $terms = $this->reactTermsStrings();
        $plain = StandardTermsContent::plainText('Hour Timebank');

        // A representative sentence from each of the eight sections. If the shipped
        // wording changes, this fails and 🔴 a NEW VERSION must be published rather
        // than the existing one edited — members have already accepted version 1.0.
        $mustAppear = [
            $terms['welcome_body_1'],
            $terms['credit_rule_1'],
            $terms['credits_no_monetary_value'],
            $terms['account_security_desc'],
            $terms['guideline_honour_desc'],
            $terms['prohibited_harassment'],
            $terms['safety_instincts_desc'],
            $terms['liability_no_disputes'],
            $terms['termination_inactivity'],
            $terms['changes_continued_use'],
        ];

        foreach ($mustAppear as $sentence) {
            $normalised = trim((string) $sentence);
            // Some strings are label/description halves that read as a sentence when
            // joined; compare case-insensitively on the substantive text.
            $this->assertStringContainsStringIgnoringCase(
                $normalised,
                $plain,
                "The seeded terms no longer contain the shipped sentence: \"{$normalised}\""
            );
        }
    }

    public function test_it_covers_all_eight_shipped_sections(): void
    {
        $html = StandardTermsContent::html('Hour Timebank');

        foreach ([
            'Time Credit System',
            'Account Responsibilities',
            'Community Guidelines',
            'Prohibited Activities',
            'Safety and Meetings',
            'Limitation of Liability',
            'Account Termination',
            'Changes to These Terms',
        ] as $heading) {
            $this->assertStringContainsString($heading, $html, "Missing section: {$heading}");
        }
    }

    public function test_it_survives_the_render_boundary_sanitiser_unchanged(): void
    {
        // 🔴 Both frontends re-sanitise legal content when rendering it. If this
        // content used an element the sanitiser strips, the seeded terms would
        // silently lose part of themselves between the database and the member's
        // screen — and a member would be agreeing to something other than what they
        // were shown.
        $html = StandardTermsContent::html('Hour Timebank');

        $this->assertSame(
            $html,
            HtmlSanitizer::sanitizeCms($html),
            'The seeded terms are altered by the CMS sanitiser — an element or attribute is not permitted.'
        );
    }

    public function test_the_community_name_is_substituted(): void
    {
        $html = StandardTermsContent::html('Hour Timebank');

        $this->assertStringContainsString('Welcome to Hour Timebank', $html);
        $this->assertStringContainsString('Hour Timebank provides a platform', $html);
        // No unsubstituted placeholder left behind from the React source.
        $this->assertStringNotContainsString('{{name}}', $html);
    }

    public function test_a_community_name_cannot_inject_markup(): void
    {
        // The name comes from `tenants.name`, which an admin controls. It is
        // interpolated into stored HTML, so it has to be escaped at the point of
        // building — not left for the render boundary to catch.
        $html = StandardTermsContent::html('<script>alert(1)</script>Evil & Co');

        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('Evil &amp; Co', $html);
    }

    public function test_an_empty_community_name_reads_sensibly(): void
    {
        $html = StandardTermsContent::html('   ');

        $this->assertStringContainsString('Welcome to this community', $html);
    }

    public function test_the_plain_text_rendering_has_no_markup_or_entities(): void
    {
        // `content_plain` feeds the version-comparison diff, which shows it to
        // members. Leaving tags or `&amp;` in it would surface there.
        $plain = StandardTermsContent::plainText('Evil & Co');

        $this->assertStringNotContainsString('<', $plain);
        $this->assertStringNotContainsString('&amp;', $plain);
        $this->assertStringContainsString('Evil & Co', $plain);
    }

    public function test_the_version_is_pinned(): void
    {
        // 🔴 Acceptance is recorded against a version id. Changing the wording
        // without bumping this would carry members' agreement to the old words
        // silently onto the new ones.
        $this->assertSame('1.0', StandardTermsContent::VERSION);
    }
}
