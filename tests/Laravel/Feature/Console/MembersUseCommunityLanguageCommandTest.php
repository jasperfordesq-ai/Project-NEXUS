<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Console;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * members:use-community-language moves members who were saved as English by
 * default, and who have never signed in, to their community's language. A
 * member who has signed in has been using the site in the language they saw
 * and may have chosen it, so they are left alone.
 */
final class MembersUseCommunityLanguageCommandTest extends TestCase
{
    use DatabaseTransactions;

    private int $otherTenantId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setCommunityLanguage($this->testTenantId, 'es');
        $this->otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id');
        $this->setCommunityLanguage($this->otherTenantId, 'es');
    }

    private function setCommunityLanguage(int $tenantId, ?string $language): void
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $config['default_language'] = $language;
        DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($config)]);
    }

    private function member(int $tenantId, string $language, bool $signedIn, string $status = 'active'): int
    {
        $id = User::factory()->forTenant($tenantId)->create()->id;
        DB::table('users')->where('id', $id)->update([
            'preferred_language' => $language,
            'last_login_at' => $signedIn ? now()->subDay() : null,
            'status' => $status,
        ]);

        return (int) $id;
    }

    private function languageOf(int $userId): string
    {
        return (string) DB::table('users')->where('id', $userId)->value('preferred_language');
    }

    public function test_a_dry_run_changes_nothing(): void
    {
        $never = $this->member($this->testTenantId, 'en', false);

        $this->artisan('members:use-community-language', ['tenant' => (string) $this->testTenantId])
            ->assertExitCode(0);

        $this->assertSame('en', $this->languageOf($never));
    }

    public function test_apply_moves_only_never_signed_in_english_members_of_that_community(): void
    {
        $never = $this->member($this->testTenantId, 'en', false);
        $pending = $this->member($this->testTenantId, 'en', false, 'pending');
        $signedIn = $this->member($this->testTenantId, 'en', true);
        $french = $this->member($this->testTenantId, 'fr', false);
        $otherCommunity = $this->member($this->otherTenantId, 'en', false);

        $this->artisan('members:use-community-language', ['tenant' => (string) $this->testTenantId, '--apply' => true])
            ->assertExitCode(0);

        $this->assertSame('es', $this->languageOf($never));
        $this->assertSame('es', $this->languageOf($pending));
        $this->assertSame('en', $this->languageOf($signedIn));
        $this->assertSame('fr', $this->languageOf($french));
        $this->assertSame('en', $this->languageOf($otherCommunity));
    }

    public function test_a_tenant_can_be_named_by_its_slug(): void
    {
        $never = $this->member($this->testTenantId, 'en', false);
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');

        $this->artisan('members:use-community-language', ['tenant' => $slug, '--apply' => true])
            ->assertExitCode(0);

        $this->assertSame('es', $this->languageOf($never));
    }

    public function test_an_english_community_has_nothing_to_move(): void
    {
        $this->setCommunityLanguage($this->testTenantId, 'en');
        $never = $this->member($this->testTenantId, 'en', false);

        $this->artisan('members:use-community-language', ['tenant' => (string) $this->testTenantId, '--apply' => true])
            ->assertExitCode(0);

        $this->assertSame('en', $this->languageOf($never));
    }

    public function test_an_unknown_tenant_is_refused(): void
    {
        $this->artisan('members:use-community-language', ['tenant' => 'no-such-community-xyz', '--apply' => true])
            ->assertExitCode(2);
    }

    public function test_delegate_accounts_are_never_touched(): void
    {
        // Inserted the way ManagerDelegate creates one; the database refuses to
        // turn an existing member into a delegate.
        $delegate = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Manager',
            'email' => 'manager-lang-' . bin2hex(random_bytes(4)) . '@delegate.invalid',
            'password_hash' => null,
            'role' => 'admin',
            'status' => 'delegate',
            'is_approved' => 1,
            'preferred_language' => 'en',
            'onboarding_completed' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->artisan('members:use-community-language', ['tenant' => (string) $this->testTenantId, '--apply' => true])
            ->assertExitCode(0);

        $this->assertSame('en', $this->languageOf($delegate));
    }
}
