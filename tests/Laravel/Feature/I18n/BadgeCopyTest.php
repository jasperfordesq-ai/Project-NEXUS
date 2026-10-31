<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
declare(strict_types=1);

namespace Tests\Laravel\Feature\I18n;

use App\I18n\LocaleContext;
use App\Services\BadgeCopy;
use Tests\Laravel\TestCase;

class BadgeCopyTest extends TestCase
{
    use \Tests\Laravel\Concerns\LoadsCurrentJsonTranslations;

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadCurrentJsonTranslations();
    }

    public function test_built_in_copy_follows_recipient_language_and_does_not_mutate_cached_input(): void
    {
        $badge = ['name' => 'First Exchange', 'name_code' => 'badges.transaction_1.name'];
        $spanish = LocaleContext::withLocale('es', fn () => BadgeCopy::localize($badge));
        $french = LocaleContext::withLocale('fr', fn () => BadgeCopy::localize($badge));
        $this->assertNotSame($badge['name'], $spanish['name']);
        $this->assertNotSame($spanish['name'], $french['name']);
        $this->assertSame('First Exchange', $badge['name']);
    }

    public function test_custom_overrides_and_unknown_codes_retain_their_original_copy(): void
    {
        foreach ([null, 'badges.unknown.name'] as $code) {
            $badge = ['name' => 'Our Community Star', 'name_code' => $code];
            $this->assertSame($badge, LocaleContext::withLocale('es', fn () => BadgeCopy::localize($badge)));
        }
    }
}
