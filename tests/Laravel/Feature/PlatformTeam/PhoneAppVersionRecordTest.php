<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Phone app → "App versions in use".
 *
 * A phone-app sign-in keeps the app's version (`refresh_session_activity.app_version`),
 * taken from the `X-Nexus-Mobile-Version` header. 🔴 This is the sign-in path: a
 * missing, malformed or hostile header must never fail a sign-in. It is simply
 * not recorded.
 */
class PhoneAppVersionRecordTest extends TestCase
{
    use DatabaseTransactions;

    private const PASSWORD = 'correct-password-123';

    private const APP = ['X-Nexus-Mobile' => '1'];

    protected function setUp(): void
    {
        parent::setUp();
        // The minimum-version check is not what is under test here.
        config(['mobile.expo.minimum_version' => '']);
    }

    private function newMember(): string
    {
        $email = 'pt-app-version-' . uniqid() . '@example.test';
        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make(self::PASSWORD),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        return $email;
    }

    /** @param array<string, string> $headers */
    private function signIn(array $headers): TestResponse
    {
        $email = $this->newMember();
        DB::table('refresh_session_activity')->where('tenant_id', $this->testTenantId)->delete();

        return $this->withHeaders($headers)
            ->apiPost('/auth/login', ['email' => $email, 'password' => self::PASSWORD]);
    }

    /** The one activity row this test's sign-in made. */
    private function activityRow(): object
    {
        $rows = DB::table('refresh_session_activity')->where('tenant_id', $this->testTenantId)->get();
        $this->assertCount(1, $rows, 'the sign-in must have made exactly one activity record');

        return $rows->first();
    }

    public function test_a_phone_sign_in_keeps_the_app_version(): void
    {
        $this->signIn(self::APP + ['X-Nexus-Mobile-Version' => '1.13.0'])->assertStatus(200);

        $row = $this->activityRow();
        $this->assertSame(1, (int) $row->from_phone_app);
        $this->assertSame('1.13.0', $row->app_version);
    }

    /**
     * @return array<string, array{0: array<string, string>}>
     */
    public static function headersThatAreNotRecorded(): array
    {
        return [
            'no version header' => [[]],
            'junk' => [['X-Nexus-Mobile-Version' => 'banana']],
            'a 300-character value' => [['X-Nexus-Mobile-Version' => str_repeat('1.2.3', 60)]],
            'SQL-looking text' => [['X-Nexus-Mobile-Version' => "1.2.3'; DROP TABLE users; --"]],
            'a version with a suffix' => [['X-Nexus-Mobile-Version' => '1.2.3-beta']],
            'four parts' => [['X-Nexus-Mobile-Version' => '1.2.3.4']],
            'a part longer than three digits' => [['X-Nexus-Mobile-Version' => '1000.2.3']],
            'two parts' => [['X-Nexus-Mobile-Version' => '1.2']],
            'empty' => [['X-Nexus-Mobile-Version' => '']],
        ];
    }

    /**
     * Each value in headersThatAreNotRecorded().
     * @param array<string, string> $versionHeader
     */
    #[DataProvider('headersThatAreNotRecorded')]
    public function test_a_phone_sign_in_without_a_plain_version_signs_in_normally_and_records_nothing(array $versionHeader): void
    {
        $response = $this->signIn(self::APP + $versionHeader);

        $response->assertStatus(200);
        $this->assertNotSame('', (string) $response->json('access_token'));
        $this->assertNotSame('', (string) $response->json('refresh_token'));
        $row = $this->activityRow();
        $this->assertSame(1, (int) $row->from_phone_app);
        $this->assertNull($row->app_version);
        $this->assertTrue(DB::table('users')->where('tenant_id', $this->testTenantId)->exists(),
            'the users table is still there');
    }

    public function test_a_sign_in_that_is_not_from_the_phone_app_records_no_version(): void
    {
        // A browser that sends the version header but is not the app.
        $this->signIn(['X-Nexus-Mobile-Version' => '1.13.0'])->assertStatus(200);

        $row = $this->activityRow();
        $this->assertSame(0, (int) $row->from_phone_app);
        $this->assertNull($row->app_version);
    }

    /**
     * The app can be updated without signing in again. The row's activity time
     * is refreshed by the signed-in requests the app makes (TokenService::
     * recordSessionActivity); the version is refreshed by that same write.
     */
    public function test_an_app_updated_without_signing_in_again_is_counted_under_its_new_version(): void
    {
        $tokens = $this->signIn(self::APP + ['X-Nexus-Mobile-Version' => '1.12.0'])->assertStatus(200);
        $this->ageActivity();

        $this->withHeaders(self::APP + [
            'X-Nexus-Mobile-Version' => '1.13.0',
            'Authorization' => 'Bearer ' . $tokens->json('access_token'),
        ])->apiGet('/v2/users/me')->assertStatus(200);

        $this->assertSame('1.13.0', $this->activityRow()->app_version);
    }

    /**
     * Each value in headersThatAreNotRecorded().
     * @param array<string, string> $versionHeader
     */
    #[DataProvider('headersThatAreNotRecorded')]
    public function test_a_later_request_without_a_plain_version_leaves_the_stored_version_alone(array $versionHeader): void
    {
        $tokens = $this->signIn(self::APP + ['X-Nexus-Mobile-Version' => '1.12.0'])->assertStatus(200);
        $this->ageActivity();

        $this->withHeaders(self::APP + $versionHeader + [
            'Authorization' => 'Bearer ' . $tokens->json('access_token'),
        ])->apiGet('/v2/users/me')->assertStatus(200);

        $row = $this->activityRow();
        $this->assertSame('1.12.0', $row->app_version);
        // The activity itself was still recorded.
        $this->assertTrue(now()->diffInSeconds($row->last_activity_at, true) < 60);
    }

    public function test_a_browser_request_never_puts_a_version_on_its_sign_in(): void
    {
        $tokens = $this->signIn([])->assertStatus(200);
        $this->ageActivity();

        $this->withHeaders([
            'X-Nexus-Mobile-Version' => '1.13.0',
            'Authorization' => 'Bearer ' . $tokens->json('access_token'),
        ])->apiGet('/v2/users/me')->assertStatus(200);

        $this->assertNull($this->activityRow()->app_version);
    }

    /** Activity is written at most once a minute; move the last write out of that window. */
    private function ageActivity(): void
    {
        DB::table('refresh_session_activity')
            ->where('tenant_id', $this->testTenantId)
            ->update(['last_activity_at' => now()->subMinutes(5)]);
    }
}
