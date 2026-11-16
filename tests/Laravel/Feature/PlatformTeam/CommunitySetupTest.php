<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\CommunitySetupService;
use App\Services\PlatformTeam\CommunitySetupChecklistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Community setup: for each community, which of the
 * first steps of setting one up are done (its "Make it yours" steps, its own
 * address, an accessible address, a published privacy notice and terms, an
 * administrator who has signed in, and whose email sender it uses).
 *
 * Yes/no facts only: no names, no addresses of people, no email settings.
 */
class CommunitySetupTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/community-setup';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['communities', 'max_communities', 'total_communities', 'truncated', 'unavailable'];

    private const ROW_KEYS = [
        'id', 'name', 'slug', 'is_active', 'created_at', 'make_it_yours', 'own_address', 'accessible_address',
        'privacy_notice_published', 'terms_published', 'first_admin_signed_in', 'email_sender',
    ];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Setup Test ' . $suffix,
            'slug' => 'setup-' . $suffix,
            'is_active' => 1,
            'created_at' => now()->addMinute(), // newest first: always inside the cap
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function account(int $communityId, array $attributes = []): int
    {
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $communityId,
            'name' => 'Setupfirst Setupsurname',
            'first_name' => 'Setupfirst',
            'last_name' => 'Setupsurname',
            'email' => 'setup-' . Str::lower(Str::random(12)) . '@example.test',
            'status' => 'active',
            'is_approved' => 1,
            'role' => 'member',
        ], $attributes));
    }

    private function legal(int $communityId, string $type, ?bool $draft, bool $active = true): void
    {
        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $communityId,
            'document_type' => $type,
            'title' => 'Setup test ' . $type,
            'slug' => $type . '-' . Str::lower(Str::random(6)),
            'is_active' => $active ? 1 : 0,
        ]);
        if ($draft === null) {
            return; // a document with no version at all
        }
        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '1.0',
            'content' => '<p>Setup test</p>',
            'effective_date' => now()->toDateString(),
            'is_draft' => $draft ? 1 : 0,
            'is_current' => $draft ? 0 : 1,
            'published_at' => $draft ? null : now(),
            'created_by' => 1,
        ]);
        DB::table('legal_documents')->where('id', $documentId)->update(['current_version_id' => $versionId]);
    }

    private function emailSetting(int $communityId, string $key, ?string $value): void
    {
        DB::table('email_settings')->insert([
            'tenant_id' => $communityId,
            'setting_key' => $key,
            'setting_value' => $value,
            'is_encrypted' => 0,
        ]);
    }

    /** @return array<string, mixed> */
    private function data(): array
    {
        return $this->apiGet(self::URI)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function row(array $data, int $communityId): array
    {
        foreach ($data['communities'] as $row) {
            if ((int) $row['id'] === $communityId) {
                return $row;
            }
        }
        $this->fail("community {$communityId} is not listed");
    }

    /** @return list<string> */
    private static function sorted(array $keys): array
    {
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_carries_exactly_what_the_page_shows(): void
    {
        $id = $this->community();
        $this->account($id, ['role' => 'admin', 'last_login_at' => now()]);
        $this->emailSetting($id, 'email_provider', 'smtp');
        $this->emailSetting($id, 'smtp_host', 'smtp.setup-secret-host.example');
        $this->emailSetting($id, 'smtp_from_email', 'sender@setup-secret-host.example');
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::sorted(self::TOP_KEYS), self::sorted(array_keys($data)));
        foreach ($data['communities'] as $row) {
            $this->assertSame(self::sorted(self::ROW_KEYS), self::sorted(array_keys($row)));
            if ($row['make_it_yours'] !== null) {
                $this->assertSame(['done', 'total'], self::sorted(array_keys($row['make_it_yours'])));
            }
        }
        $this->assertSame([], $data['unavailable']);
        $this->assertSame(200, $data['max_communities']);
        // Yes/no facts only: no person and no mail setting can ride along.
        $body = (string) $response->getContent();
        foreach (['Setupfirst', 'Setupsurname', '@example.test', 'setup-secret-host'] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_it_lists_the_newest_communities_first_and_says_which_are_switched_off(): void
    {
        $older = $this->community(['created_at' => now()->addMinutes(1)]);
        $newer = $this->community(['created_at' => now()->addMinutes(2), 'is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();
        $ids = array_map(static fn (array $r): int => (int) $r['id'], $data['communities']);

        $this->assertLessThan(array_search($older, $ids, true), array_search($newer, $ids, true));
        $this->assertFalse($this->row($data, $newer)['is_active']);
        $this->assertTrue($this->row($data, $older)['is_active']);
        $this->assertSame(DB::table('tenants')->count(), $data['total_communities']);
    }

    public function test_make_it_yours_is_the_community_admins_own_count(): void
    {
        $id = $this->community(['tagline' => 'A tagline', 'configuration' => json_encode(['primary_color' => '#336699'])]);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);
        $own = app(CommunitySetupService::class)->status($id, false);

        $this->assertSame(['done' => $own['done'], 'total' => $own['total']], $row['make_it_yours']);
        $this->assertSame(2, $row['make_it_yours']['done']);
        $this->assertSame(6, $row['make_it_yours']['total']);
    }

    public function test_an_own_address_is_one_that_is_not_the_platforms(): void
    {
        config(['tenancy.platform_hosts' => ['platform-setup-test.example']]);
        $none = $this->community();
        $blank = $this->community(['domain' => '']);
        $platformSub = $this->community(['domain' => 'newone-' . Str::lower(Str::random(6)) . '.platform-setup-test.example']);
        $platformItself = $this->community(['domain' => 'https://WWW.platform-setup-test.example/']);
        $own = $this->community(['domain' => 'timebank-' . Str::lower(Str::random(6)) . '.example.org']);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertFalse($this->row($data, $none)['own_address']);
        $this->assertFalse($this->row($data, $blank)['own_address']);
        $this->assertFalse($this->row($data, $platformSub)['own_address']);
        $this->assertFalse($this->row($data, $platformItself)['own_address']);
        $this->assertTrue($this->row($data, $own)['own_address']);
    }

    public function test_the_platforms_app_and_accessible_addresses_are_not_own_addresses(): void
    {
        config([
            'tenancy.platform_hosts' => [],
            'tenancy.platform_app_hosts' => ['app.setup-test.example'],
            'tenancy.platform_accessible_hosts' => ['accessible.setup-test.example'],
        ]);
        $app = $this->community(['domain' => 'app.setup-test.example']);
        $accessible = $this->community(['domain' => 'x' . Str::lower(Str::random(5)) . '.accessible.setup-test.example']);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertFalse($this->row($data, $app)['own_address']);
        $this->assertFalse($this->row($data, $accessible)['own_address']);
    }

    public function test_it_says_whether_there_is_an_accessible_address(): void
    {
        $with = $this->community(['accessible_domain' => 'accessible-' . Str::lower(Str::random(6)) . '.example.org']);
        $without = $this->community();
        $blank = $this->community(['accessible_domain' => '  ']);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertTrue($this->row($data, $with)['accessible_address']);
        $this->assertFalse($this->row($data, $without)['accessible_address']);
        $this->assertFalse($this->row($data, $blank)['accessible_address']);
    }

    public function test_a_legal_document_counts_only_when_its_current_version_is_published(): void
    {
        $published = $this->community();
        $this->legal($published, 'privacy', false);
        $this->legal($published, 'terms', false);
        $draft = $this->community();
        $this->legal($draft, 'privacy', true);
        $this->legal($draft, 'terms', true);
        $noVersion = $this->community();
        $this->legal($noVersion, 'privacy', null);
        $switchedOff = $this->community();
        $this->legal($switchedOff, 'privacy', false, false);
        $none = $this->community();
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertTrue($this->row($data, $published)['privacy_notice_published']);
        $this->assertTrue($this->row($data, $published)['terms_published']);
        $this->assertFalse($this->row($data, $draft)['privacy_notice_published']);
        $this->assertFalse($this->row($data, $draft)['terms_published']);
        $this->assertFalse($this->row($data, $noVersion)['privacy_notice_published']);
        $this->assertFalse($this->row($data, $switchedOff)['privacy_notice_published']);
        $this->assertFalse($this->row($data, $none)['privacy_notice_published']);
        $this->assertFalse($this->row($data, $none)['terms_published']);
    }

    public function test_the_first_admin_has_signed_in_only_when_a_real_administrator_has(): void
    {
        $neverSignedIn = $this->community();
        $this->account($neverSignedIn, ['role' => 'admin', 'last_login_at' => null]);
        $this->account($neverSignedIn, ['role' => 'member', 'last_login_at' => now()]);
        $this->account($neverSignedIn, ['role' => 'broker', 'last_login_at' => now()]);
        $this->account($neverSignedIn, ['role' => 'admin', 'status' => 'delegate', 'last_login_at' => now()]);
        $this->account($neverSignedIn, ['role' => 'admin', 'deleted_at' => now(), 'last_login_at' => now()]);
        $this->account($neverSignedIn, ['role' => 'admin', 'anonymized_at' => now(), 'last_login_at' => now()]);
        $this->account($neverSignedIn, ['role' => 'super_admin', 'is_super_admin' => 1, 'is_god' => 1, 'last_login_at' => now()]);

        $admin = $this->community();
        $this->account($admin, ['role' => 'admin', 'last_login_at' => now()->subYear()]);
        $legacy = $this->community();
        $this->account($legacy, ['role' => 'member', 'is_admin' => 1, 'last_login_at' => now()]);
        $tenantSuper = $this->community();
        $this->account($tenantSuper, ['role' => 'member', 'is_tenant_super_admin' => 1, 'last_login_at' => now()]);
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertFalse($this->row($data, $neverSignedIn)['first_admin_signed_in']);
        $this->assertTrue($this->row($data, $admin)['first_admin_signed_in']);
        $this->assertTrue($this->row($data, $legacy)['first_admin_signed_in']);
        $this->assertTrue($this->row($data, $tenantSuper)['first_admin_signed_in']);
    }

    public function test_the_email_sender_is_own_only_when_the_mailer_would_really_use_it(): void
    {
        $nothing = $this->community();
        $platformDefault = $this->community();
        $this->emailSetting($platformDefault, 'email_provider', 'platform_default');
        $smtp = $this->community();
        $this->emailSetting($smtp, 'email_provider', 'smtp');
        $this->emailSetting($smtp, 'smtp_host', 'smtp.example.org');
        $smtpNoHost = $this->community();
        $this->emailSetting($smtpNoHost, 'email_provider', 'smtp');
        $this->emailSetting($smtpNoHost, 'smtp_host', '');
        $gmail = $this->community();
        $this->emailSetting($gmail, 'email_provider', 'gmail_api');
        foreach (['gmail_client_id', 'gmail_client_secret', 'gmail_refresh_token'] as $key) {
            $this->emailSetting($gmail, $key, 'something');
        }
        $gmailHalf = $this->community();
        $this->emailSetting($gmailHalf, 'email_provider', 'gmail_api');
        $this->emailSetting($gmailHalf, 'gmail_client_id', 'something');
        $retired = $this->community();
        $this->emailSetting($retired, 'email_provider', 'sendgrid');
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame('platform', $this->row($data, $nothing)['email_sender']);
        $this->assertSame('platform', $this->row($data, $platformDefault)['email_sender']);
        $this->assertSame('own', $this->row($data, $smtp)['email_sender']);
        $this->assertSame('platform', $this->row($data, $smtpNoHost)['email_sender']);
        $this->assertSame('own', $this->row($data, $gmail)['email_sender']);
        $this->assertSame('platform', $this->row($data, $gmailHalf)['email_sender']);
        $this->assertSame('platform', $this->row($data, $retired)['email_sender']);
    }

    public function test_it_stops_at_the_cap_and_says_so(): void
    {
        $this->community();
        $this->community();

        $result = (new CommunitySetupChecklistService(app(CommunitySetupService::class), 1))->overview();

        $this->assertCount(1, $result['communities']);
        $this->assertTrue($result['truncated']);
        $this->assertSame(1, $result['max_communities']);
        $this->assertSame(DB::table('tenants')->count(), $result['total_communities']);
    }

    public function test_under_the_cap_it_is_not_truncated(): void
    {
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame($data['total_communities'] > 200, $data['truncated']);
        $this->assertCount(min(200, $data['total_communities']), $data['communities']);
    }

    public function test_a_step_that_cannot_be_read_is_not_available_never_not_done(): void
    {
        $id = $this->community();
        // CommunitySetupService is final, so the failing read is handed in.
        $this->app->instance(CommunitySetupChecklistService::class, new CommunitySetupChecklistService(
            app(CommunitySetupService::class),
            200,
            static function (int $communityId): array {
                throw new \RuntimeException('setup unreadable');
            },
        ));
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertNull($this->row($data, $id)['make_it_yours']);
        $this->assertSame(['make_it_yours'], $data['unavailable']);
        // The other steps are still read.
        $this->assertFalse($this->row($data, $id)['own_address']);
    }
}
