<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Http\Controllers\Api\SubAccountController;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * The supporter message-view purpose survives being a TRANSLATED string.
 *
 * The purpose a supporter must state before reading a supported member's
 * messages travels in the `X-Message-View-Purpose` header, and is written to an
 * immutable audit row. HTTP header values are bytes: `fetch()` and `Headers`
 * both refuse any code point above 255 ("Cannot convert argument to a
 * ByteString").
 *
 * The purpose is drawn from the translation catalogue and joined to the
 * supporter's free text with an em dash, so it is routinely non-ASCII — the
 * ENGLISH reason "Checking they're okay" already carries a curly apostrophe,
 * before Irish, Arabic, Japanese or Polish are considered. Both frontends
 * therefore threw before the request left them; the member saw a generic
 * refusal, and no audit row was ever written.
 *
 * The header now accepts RFC 8187 (`UTF-8''<percent-encoded>`). Accepting it is
 * ADDITIVE — a caller sending plain ASCII is unaffected — which is what these
 * assertions pin from both directions.
 */
class SubAccountMessageViewPurposeHeaderTest extends TestCase
{
    private function decode(string $value): string
    {
        $method = new ReflectionMethod(SubAccountController::class, 'decodeHeaderValue');
        $method->setAccessible(true);

        return $method->invoke(
            $this->app->make(SubAccountController::class),
            $value
        );
    }

    public function test_plain_ascii_purpose_is_passed_through_untouched(): void
    {
        // Backward compatibility: any existing caller must keep working, and a
        // stated purpose must never be silently rewritten on its way to an
        // audit row.
        $this->assertSame('A safety concern', $this->decode('A safety concern'));
    }

    public function test_a_plain_purpose_containing_a_percent_sign_is_not_decoded(): void
    {
        // Only the RFC 8187 prefix opts a value into decoding. Without that
        // guard, "Spent 50% of the budget" would become mangled text in a
        // permanent record.
        $this->assertSame('Spent 50% of the budget', $this->decode('Spent 50% of the budget'));
    }

    public function test_the_english_reason_survives_its_curly_apostrophe(): void
    {
        $purpose = 'Checking they’re okay';
        $encoded = "UTF-8''" . rawurlencode($purpose);

        $this->assertSame($purpose, $this->decode($encoded));
    }

    public function test_a_reason_joined_to_detail_with_an_em_dash_survives(): void
    {
        // This is the exact shape both frontends build.
        $purpose = 'A safety concern — she has not replied since Tuesday';

        $this->assertSame($purpose, $this->decode("UTF-8''" . rawurlencode($purpose)));
    }

    /**
     * @dataProvider translatedReasons
     */
    public function test_a_translated_reason_survives(string $purpose): void
    {
        $this->assertSame($purpose, $this->decode("UTF-8''" . rawurlencode($purpose)));
    }

    /** @return array<string, array{0: string}> */
    public static function translatedReasons(): array
    {
        return [
            'Irish'    => ['Ag seiceáil go bhfuil siad ceart go leor'],
            'Arabic'   => ['التحقق من أنهم بخير'],
            'Japanese' => ['無事かどうかの確認'],
            'Polish'   => ['Sprawdzenie, czy wszystko w porządku'],
        ];
    }

    public function test_the_prefix_is_matched_case_insensitively(): void
    {
        $this->assertSame('okay', $this->decode("utf-8''okay"));
    }

    public function test_invalid_utf8_is_refused_rather_than_stored_as_replacement_characters(): void
    {
        // %FF is not valid UTF-8. An audit trail is better empty than wrong.
        $this->assertSame('', $this->decode("UTF-8''%FF%FE"));
    }

    public function test_an_empty_encoded_value_decodes_to_empty(): void
    {
        // The service already rejects an empty purpose; this must not become a
        // literal "UTF-8''" in the audit row.
        $this->assertSame('', $this->decode("UTF-8''"));
    }
}
