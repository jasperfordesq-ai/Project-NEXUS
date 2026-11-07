<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\I18n;

use App\Models\User;
use App\Services\Identity\AdminCreatedAccountAdmission;
use App\Services\MemberImport\MemberImportWriter;
use App\Support\CommunityLanguage;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A member nobody asked about their language is saved in their community's
 * language, not the bare `users.preferred_language` column default ('en').
 *
 * AWID (7 Nov 2026): members imported into a Spanish-speaking community were
 * saved as English, so the site and every email reached them in English.
 */
final class NewMembersGetCommunityLanguageTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['mail.capture_recipient_domains' => ['nexus.test']]);
        $this->setCommunityLanguage($this->testTenantId, 'es');
    }

    private function setCommunityLanguage(int $tenantId, ?string $language): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        if ($language === null) {
            unset($config['default_language']);
        } else {
            $config['default_language'] = $language;
        }
        DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($config)]);
    }

    private function languageOf(int $userId): string
    {
        return (string) DB::table('users')->where('id', $userId)->value('preferred_language');
    }

    private function email(): string
    {
        return 'lang-' . bin2hex(random_bytes(5)) . '@nexus.test';
    }

    public function test_the_community_language_is_read_from_the_tenant(): void
    {
        $this->assertSame('es', CommunityLanguage::forTenant($this->testTenantId));
    }

    public function test_a_community_without_a_language_is_english(): void
    {
        $this->setCommunityLanguage($this->testTenantId, null);

        $this->assertSame('en', CommunityLanguage::forTenant($this->testTenantId));
    }

    public function test_an_unsupported_community_language_is_english(): void
    {
        $this->setCommunityLanguage($this->testTenantId, 'xx');

        $this->assertSame('en', CommunityLanguage::forTenant($this->testTenantId));
    }

    public function test_a_member_created_by_an_administrator_gets_the_community_language(): void
    {
        $id = User::createWithTenant([
            'first_name' => 'Ana', 'last_name' => 'Ruiz', 'email' => $this->email(),
            'password' => 'not-used-123!', 'is_approved' => 1, 'status' => 'active',
        ], $this->testTenantId);

        $this->assertSame('es', $this->languageOf((int) $id));
    }

    public function test_an_explicit_language_still_wins(): void
    {
        $id = User::createWithTenant([
            'first_name' => 'Ana', 'last_name' => 'Ruiz', 'email' => $this->email(),
            'password' => 'not-used-123!', 'is_approved' => 1, 'status' => 'active',
            'preferred_language' => 'fr',
        ], $this->testTenantId);

        $this->assertSame('fr', $this->languageOf((int) $id));
    }

    public function test_an_imported_member_gets_the_community_language(): void
    {
        $adminId = User::factory()->forTenant($this->testTenantId)->admin()->create()->id;
        $out = app(MemberImportWriter::class)->write(
            [
                'first_name' => 'Lucía', 'last_name' => 'Pérez', 'email' => $this->email(),
                'phone' => null, 'location' => 'Quito', 'balance_cents' => 0,
                'original_balance_cents' => null, 'source_row' => 2,
            ],
            $this->testTenantId,
            $adminId,
            AdminCreatedAccountAdmission::decide($this->testTenantId, false),
            '77777777-7777-4777-8777-777777777777',
            false
        );

        $this->assertSame('es', $this->languageOf((int) $out['user_id']));
    }

    public function test_a_self_signed_up_member_uses_their_browser_language_first(): void
    {
        $this->assertSame('fr', CommunityLanguage::forNewMember($this->testTenantId, null, 'fr-FR,fr;q=0.9,en;q=0.8'));
    }

    public function test_a_self_signed_up_member_without_a_usable_browser_language_gets_the_community_language(): void
    {
        $this->assertSame('es', CommunityLanguage::forNewMember($this->testTenantId, null, 'xx-YY'));
        $this->assertSame('es', CommunityLanguage::forNewMember($this->testTenantId, null, ''));
    }

    public function test_an_explicit_choice_beats_the_browser_language(): void
    {
        $this->assertSame('de', CommunityLanguage::forNewMember($this->testTenantId, 'de', 'fr-FR'));
    }
}
