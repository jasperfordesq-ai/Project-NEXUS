<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-069 F-417 — `User::$hidden` is the backstop that exists, by its own comment,
 * so that private fields "remain private even if a model is accidentally
 * serialized outside an explicit API resource" — which is precisely how F-085
 * and F-097 happened.
 *
 * It stripped `password_hash` but not the LEGACY duplicate credential column
 * `users.password`, nor the legacy reset-token pair, nor three internal columns
 * (`stripe_customer_id`, `max_permission_level`, `permissions_last_updated`) and
 * the staff-written `rejection_reason`.
 *
 * 🔴 Honest scope. This is a missing BACKSTOP, not a proven live disclosure:
 * E-069's route sweeps found no member-facing route that serialises a whole
 * `User`. Nothing writes `users.password` today either — `User::createWithTenant()`
 * writes only `password_hash` — but historical rows still hold real hashes.
 *
 * 🔴 The control matters as much as the harm here. Adding a column to `$hidden`
 * removes it from EVERY array/JSON serialisation of the model, so the second
 * test pins the columns that are deliberately NOT hidden, because live code
 * serialises them:
 *   - `email` is selected by four constrained eager loads that feed staff
 *     screens (AdminMarketplaceController:278, JobTeamService:150,
 *     VolunteerExpenseService:291 and :392);
 *   - `role` / `is_admin` are authorisation signals admin screens display;
 *   - `phone`, `date_of_birth`, `latitude`, `longitude` and `email` are all in
 *     `User::$fillable`, i.e. fields a member's own profile round-trips.
 * If a later change hides one of those, this test fails and says so.
 */
final class F417UserSerialisationBackstopCoversLegacyCredentialsTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Columns that must never survive a whole-model serialisation.
     *
     * @var list<string>
     */
    private const MUST_BE_HIDDEN = [
        'password',
        'reset_token',
        'reset_token_expiry',
        'stripe_customer_id',
        'max_permission_level',
        'permissions_last_updated',
        'rejection_reason',
    ];

    /**
     * Columns deliberately left serialisable — hiding any of these breaks a
     * live screen. See the class docblock.
     *
     * @var list<string>
     */
    private const MUST_STAY_VISIBLE = [
        'email',
        'phone',
        'date_of_birth',
        'latitude',
        'longitude',
        'role',
        'is_admin',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function sentinelUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('users')->where('id', $user->id)->update([
            // The harm: a second, legacy credential column alongside password_hash.
            'password' => '$2y$10$F417LEGACYPASSWORDHASHSENTINELAAAAAAAAAAAAAAAAAAAAAAAAA',
            // The control: the live credential column, already hidden, which is
            // what proves the mechanism works rather than the list being lucky.
            'password_hash' => '$2y$10$F417LIVEPASSWORDHASHCONTROLBBBBBBBBBBBBBBBBBBBBBBBBBBB',
            'reset_token' => 'F417-RESET-TOKEN-SENTINEL',
            'reset_token_expiry' => now()->addHour(),
            'stripe_customer_id' => 'cus_F417SENTINEL',
            'max_permission_level' => 7,
            'permissions_last_updated' => now(),
            'rejection_reason' => 'F417-REJECTION-REASON-SENTINEL',
            // Deliberately-visible fields, stamped so the control is specific.
            'email' => 'f417-control@example.test',
            'phone' => '+15559990417',
            'date_of_birth' => '1968-02-11',
            'latitude' => '53.3498417',
            'longitude' => '-6.2603417',
            'role' => 'broker',
        ]);

        return User::query()->withoutGlobalScopes()->findOrFail($user->id);
    }

    /**
     * HARM — serialising a whole `User` must not emit the legacy credential
     * columns or the internal permission/billing columns.
     */
    public function test_whole_user_serialisation_omits_the_legacy_credential_and_internal_columns(): void
    {
        $serialised = $this->sentinelUser()->toArray();
        $json = (string) json_encode($serialised);

        foreach (self::MUST_BE_HIDDEN as $column) {
            self::assertArrayNotHasKey(
                $column,
                $serialised,
                "F-417: users.{$column} must be in User::\$hidden so it cannot leak through an accidental whole-model serialisation"
            );
        }

        self::assertStringNotContainsString(
            'F417LEGACYPASSWORDHASHSENTINEL',
            $json,
            'F-417: the legacy users.password hash must not reach a serialised payload'
        );
        self::assertStringNotContainsString('F417-RESET-TOKEN-SENTINEL', $json);
        self::assertStringNotContainsString('cus_F417SENTINEL', $json);
        self::assertStringNotContainsString('F417-REJECTION-REASON-SENTINEL', $json);

        // Mechanism control: the live credential column was already stripped, so
        // the additions above are omissions from the list, not a new guard.
        self::assertArrayNotHasKey('password_hash', $serialised);
        self::assertStringNotContainsString('F417LIVEPASSWORDHASHCONTROL', $json);
    }

    /**
     * CONTROL — the rightful readers still get their fields. These differ from
     * the harm case only in being columns live code serialises on purpose.
     */
    public function test_control_the_columns_live_screens_serialise_are_still_present(): void
    {
        $serialised = $this->sentinelUser()->toArray();

        foreach (self::MUST_STAY_VISIBLE as $column) {
            self::assertArrayHasKey(
                $column,
                $serialised,
                "users.{$column} is serialised by live code and must NOT be added to User::\$hidden"
            );
        }

        self::assertSame('f417-control@example.test', $serialised['email']);
        self::assertSame('broker', $serialised['role']);
        self::assertArrayHasKey('id', $serialised);
        self::assertArrayHasKey('name', $serialised);
    }

    /**
     * CONTROL — the exact shape the four staff screens use. They eager-load the
     * `user` relation with an explicit column list that includes `email`
     * (AdminMarketplaceController:278, JobTeamService:150,
     * VolunteerExpenseService:291 and :392) and then serialise it, so a
     * column-constrained `User` must still carry its email.
     */
    public function test_control_a_column_constrained_user_still_serialises_its_email(): void
    {
        $user = $this->sentinelUser();

        $constrained = User::query()
            ->withoutGlobalScopes()
            ->select(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'email'])
            ->findOrFail($user->id)
            ->toArray();

        self::assertArrayHasKey(
            'email',
            $constrained,
            'the staff screens that eager-load user:...,email must still receive it'
        );
        self::assertSame('f417-control@example.test', $constrained['email']);
    }
}
