<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
declare(strict_types=1);

namespace Tests\Laravel\Feature\I18n;

use App\I18n\LocaleContext;
use App\Services\BadgeCopy;
use App\Models\User;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class BadgeCopyTest extends TestCase
{
    use \Tests\Laravel\Concerns\LoadsCurrentJsonTranslations;
    use DatabaseTransactions;

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

    /**
     * 31 Oct re-audit: awarding a badge stored its name in the language of
     * whoever triggered the award, so the admin badge report (GROUP BY name)
     * split one badge into a row per language. The stored name stays English,
     * or the community's own wording.
     */
    public function test_an_awarded_badge_is_stored_with_its_english_name_whoever_triggered_it(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'preferred_language' => 'fr']);
        $english = LocaleContext::withLocale('en', fn () => GamificationService::getBadgeByKey('transaction_1')['name'] ?? null);
        $this->assertNotNull($english);

        LocaleContext::withLocale('es', fn () => GamificationService::awardBadge((int) $user->id, 'transaction_1'));

        $stored = DB::table('user_badges')->where('user_id', $user->id)->where('badge_key', 'transaction_1')->value('name');
        $this->assertSame($english, $stored);
    }
}
