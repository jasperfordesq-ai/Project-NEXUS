<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Users;

use App\Models\User;
use App\Services\UserService;
use App\Support\UserDisplayName;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * An ORGANISATION account must be identified by its organisation name.
 *
 * `users.profile_type = 'organisation'` puts the trading name in
 * `users.organization_name`; `first_name`/`last_name` then hold the CONTACT
 * PERSON. Showing that person anywhere a member can see is the bug this covers.
 *
 * The write path is what makes this hard to see. `users.name` is a real NOT NULL
 * column that more than a hundred call sites read directly, and until 2026-08-27:
 *
 *   - `RegistrationService` never set it, so self-registered accounts stored '';
 *   - `User::createWithTenant()` stored first+last regardless of profile_type;
 *   - `UserService::update()` let profile_type / organization_name / first_name /
 *     last_name all change without ever recomputing it, so switching an existing
 *     account to an organisation in profile settings left the personal name
 *     behind for ever.
 *
 * Each of those is asserted below against a real database, because the failure
 * mode was a plausible-looking value rather than an error.
 */
class OrganisationDisplayNameTest extends TestCase
{
    use DatabaseTransactions;

    private function organisation(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'first_name'        => 'Zephyrine',
            'last_name'         => 'Quilbrook',
            'profile_type'      => UserDisplayName::ORGANISATION,
            'organization_name' => 'Northside Community Trust',
            'status'            => 'active',
            'is_approved'       => true,
        ], $overrides));
    }

    // =====================================================================
    // The stored column
    // =====================================================================

    public function test_creating_an_organisation_stores_the_organisation_name(): void
    {
        $user = $this->organisation();

        $stored = DB::table('users')->where('id', $user->id)->value('name');

        self::assertSame('Northside Community Trust', $stored);
    }

    public function test_creating_an_individual_stores_the_person_name(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name'   => 'Ada',
            'last_name'    => 'Lovelace',
            'profile_type' => 'individual',
        ]);

        self::assertSame('Ada Lovelace', DB::table('users')->where('id', $user->id)->value('name'));
    }

    public function test_switching_an_existing_account_to_an_organisation_rewrites_the_stored_name(): void
    {
        // THE original bug: this transition left `users.name` on the personal
        // name, and every endpoint reading that column showed the wrong thing.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name'   => 'John',
            'last_name'    => 'Smith',
            'profile_type' => 'individual',
        ]);

        self::assertSame('John Smith', DB::table('users')->where('id', $user->id)->value('name'));

        UserService::update($user->id, [
            'profile_type'      => UserDisplayName::ORGANISATION,
            'organization_name' => 'Acme Co-operative',
        ]);

        self::assertSame(
            'Acme Co-operative',
            DB::table('users')->where('id', $user->id)->value('name'),
            'Switching to an organisation must rewrite the stored display name.',
        );
    }

    public function test_switching_back_to_an_individual_restores_the_person_name(): void
    {
        $user = $this->organisation();

        UserService::update($user->id, ['profile_type' => 'individual']);

        self::assertSame(
            'Zephyrine Quilbrook',
            DB::table('users')->where('id', $user->id)->value('name'),
        );
    }

    public function test_renaming_the_organisation_rewrites_the_stored_name(): void
    {
        $user = $this->organisation();

        UserService::update($user->id, ['organization_name' => 'Northside Trust CIC']);

        self::assertSame('Northside Trust CIC', DB::table('users')->where('id', $user->id)->value('name'));
    }

    public function test_an_unrelated_save_does_not_disturb_the_stored_name(): void
    {
        // `saving` only recomputes when a name field is dirty. last_active_at is
        // written on virtually every request, so this must stay cheap and inert.
        $user = $this->organisation();

        $user->location = 'Community Hall';
        $user->save();

        self::assertSame('Northside Community Trust', DB::table('users')->where('id', $user->id)->value('name'));
    }

    public function test_a_partially_selected_model_does_not_blank_the_stored_name(): void
    {
        // A model loaded without profile_type/organization_name must top the
        // picture up from the row rather than resolve against half the fields.
        $user = $this->organisation();

        $partial = User::query()
            ->withoutGlobalScopes()
            ->whereKey($user->id)
            ->first(['id', 'first_name', 'last_name']);

        $partial->first_name = 'Someone';
        $partial->save();

        self::assertSame(
            'Northside Community Trust',
            DB::table('users')->where('id', $user->id)->value('name'),
            'A partial select must not let the contact person overwrite the organisation name.',
        );
    }

    public function test_a_name_only_account_keeps_its_name_when_saved_from_a_partial_model(): void
    {
        // SSO and CSV imports create accounts with a single-field `name` and no
        // first/last. If such an account is saved from a model selected WITHOUT
        // `name`, the recompute resolves to '' — and the guard can only protect
        // the stored value if it topped `name` up from the row first.
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name'   => null,
            'last_name'    => null,
            'profile_type' => 'individual',
        ]);
        DB::table('users')->where('id', $user->id)->update(['name' => 'Agoris Member']);

        $partial = User::query()
            ->withoutGlobalScopes()
            ->whereKey($user->id)
            ->first(['id', 'first_name', 'last_name']);

        $partial->first_name = null;
        $partial->profile_type = 'individual';
        $partial->save();

        self::assertSame(
            'Agoris Member',
            DB::table('users')->where('id', $user->id)->value('name'),
            'A recompute that resolves to empty must never blank a real stored name.',
        );
    }

    // =====================================================================
    // The read paths
    // =====================================================================

    public function test_model_accessor_returns_the_organisation_name(): void
    {
        $user = $this->organisation();

        self::assertSame('Northside Community Trust', $user->fresh()->name);
    }

    public function test_accessor_repairs_a_row_whose_stored_name_is_stale(): void
    {
        // Rows written before the sync existed. The accessor is the
        // defence-in-depth layer for exactly these.
        $user = $this->organisation();
        DB::table('users')->where('id', $user->id)->update(['name' => 'Zephyrine Quilbrook']);

        self::assertSame('Northside Community Trust', User::query()->withoutGlobalScopes()->find($user->id)->name);
    }

    public function test_serialised_model_carries_the_organisation_name(): void
    {
        $user = $this->organisation();

        self::assertSame('Northside Community Trust', $user->fresh()->toArray()['name'] ?? null);
    }

    public function test_relation_loaded_without_the_name_column_still_serialises_it(): void
    {
        // Constrained eager loads (`with(['creator:id,first_name,...'])`) do not
        // select `name`; appending it is what stops a client concatenating the
        // contact person instead.
        $user = $this->organisation();

        $partial = User::query()
            ->withoutGlobalScopes()
            ->whereKey($user->id)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name']);

        self::assertSame('Northside Community Trust', $partial->toArray()['name'] ?? null);
    }

    public function test_user_service_lookups_return_the_organisation_name(): void
    {
        $user = $this->organisation();

        self::assertSame('Northside Community Trust', UserService::getById($user->id)['name'] ?? null);
        self::assertSame('Northside Community Trust', User::findById($user->id, false)['name'] ?? null);
    }

    public function test_sql_expression_resolves_the_organisation_name_in_the_database(): void
    {
        // Proves the CASE expression itself against the real engine — a SELECT
        // alias is where most endpoints get their name from.
        $user = $this->organisation();

        $row = DB::table('users')
            ->where('id', $user->id)
            ->selectRaw(UserDisplayName::sql('users', 'resolved_name'))
            ->first();

        self::assertSame('Northside Community Trust', $row->resolved_name);
    }

    public function test_sql_expression_resolves_a_person_name_for_individuals(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name'   => 'Ada',
            'last_name'    => 'Lovelace',
            'profile_type' => 'individual',
        ]);

        $row = DB::table('users')
            ->where('id', $user->id)
            ->selectRaw(UserDisplayName::sql('users', 'resolved_name'))
            ->first();

        self::assertSame('Ada Lovelace', $row->resolved_name);
    }
}
