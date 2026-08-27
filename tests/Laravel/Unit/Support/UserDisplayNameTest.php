<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Support\UserDisplayName;
use PHPUnit\Framework\TestCase;

/**
 * The one place the platform decides what a user account is CALLED.
 *
 * An organisation account (`profile_type = 'organisation'`) must be identified
 * by `organization_name`; `first_name`/`last_name` hold its CONTACT PERSON and
 * must never surface as the account's identity. Before 2026-08-27 that leaked
 * into every React surface through hundreds of hand-rolled concatenations.
 *
 * The precedence rules below are load-order safety, not preference: dozens of
 * queries select `name` WITHOUT the organisation columns, and just as many
 * select the name parts without `name`. Both must degrade to the best name they
 * actually have rather than to half a name or an empty string.
 */
final class UserDisplayNameTest extends TestCase
{
    public function test_organisation_account_uses_its_organisation_name(): void
    {
        $row = (object) [
            'profile_type'      => 'organisation',
            'organization_name' => 'Northside Community Trust',
            'first_name'        => 'Zephyrine',
            'last_name'         => 'Quilbrook',
            'name'              => 'Zephyrine Quilbrook',
        ];

        self::assertSame('Northside Community Trust', UserDisplayName::resolve($row));
    }

    public function test_organisation_name_beats_a_stale_stored_name(): void
    {
        // This is the exact production shape: `users.name` was written as
        // first+last on insert and never recomputed when the member switched
        // their profile to an organisation.
        $row = ['profile_type' => 'organisation', 'organization_name' => 'Acme Co-op', 'name' => 'John Smith'];

        self::assertSame('Acme Co-op', UserDisplayName::resolve($row));
    }

    public function test_individual_account_uses_the_person_name(): void
    {
        $row = (object) ['profile_type' => 'individual', 'first_name' => 'Ada', 'last_name' => 'Lovelace'];

        self::assertSame('Ada Lovelace', UserDisplayName::resolve($row));
    }

    public function test_organisation_flag_without_a_name_falls_back_to_the_person(): void
    {
        // A half-completed switch must not blank the account out.
        $row = (object) ['profile_type' => 'organisation', 'organization_name' => '  ', 'first_name' => 'Ada', 'last_name' => 'Lovelace'];

        self::assertSame('Ada Lovelace', UserDisplayName::resolve($row));
    }

    public function test_stored_name_is_preferred_over_a_partial_person_name(): void
    {
        // Surname-withholding endpoints drop `last_name` entirely. Rebuilding
        // from the parts would return "Ada" and lose half the name.
        $row = (object) ['first_name' => 'Ada', 'name' => 'Ada Lovelace'];

        self::assertSame('Ada Lovelace', UserDisplayName::resolve($row));
    }

    public function test_name_only_row_keeps_its_name(): void
    {
        // SSO and CSV imports produce accounts with a single-field name.
        self::assertSame('Hub Super Admin', UserDisplayName::resolve(['name' => 'Hub Super Admin']));
    }

    public function test_fallback_is_used_when_nothing_is_present(): void
    {
        self::assertSame('A member', UserDisplayName::resolve([], 'A member'));
        self::assertSame('A member', UserDisplayName::resolve(null, 'A member'));
        self::assertSame('', UserDisplayName::resolve(null));
    }

    public function test_american_spelling_is_not_treated_as_an_organisation(): void
    {
        // 'organization' never appears in users.profile_type. Two services
        // compared against it and so never took their organisation branch;
        // the constant exists so that cannot recur silently.
        self::assertSame('organisation', UserDisplayName::ORGANISATION);

        $row = ['profile_type' => 'organization', 'organization_name' => 'Acme', 'first_name' => 'Ada', 'last_name' => 'L'];

        self::assertSame('Ada L', UserDisplayName::resolve($row));
    }

    public function test_for_storage_ignores_any_existing_stored_name(): void
    {
        // forStorage() answers "what SHOULD the column hold", so it must not
        // echo back the wrong value it is being called to correct.
        self::assertSame(
            'Acme Co-op',
            UserDisplayName::forStorage('organisation', 'Acme Co-op', 'John', 'Smith'),
        );
        self::assertSame(
            'John Smith',
            UserDisplayName::forStorage('individual', null, 'John', 'Smith'),
        );
        self::assertSame('', UserDisplayName::forStorage(null, null, null, null));
    }

    public function test_resolve_prefixed_reads_joined_alias_columns(): void
    {
        $row = (object) [
            'author_profile_type'      => 'organisation',
            'author_organization_name' => 'Riverside Care Collective',
            'author_first_name'        => 'Thurman',
            'author_last_name'         => 'Schroeder',
        ];

        self::assertSame('Riverside Care Collective', UserDisplayName::resolvePrefixed($row, 'author_'));
    }

    public function test_resolve_prefixed_falls_back_to_the_prefixed_person(): void
    {
        $row = ['sender_first_name' => 'Ada', 'sender_last_name' => 'Lovelace'];

        self::assertSame('Ada Lovelace', UserDisplayName::resolvePrefixed($row, 'sender_'));
        self::assertSame('nobody', UserDisplayName::resolvePrefixed($row, 'receiver_', 'nobody'));
    }

    public function test_sql_expression_is_organisation_aware_and_aliasable(): void
    {
        $sql = UserDisplayName::sql('u', 'author_name');

        self::assertStringContainsString("u.profile_type = 'organisation'", $sql);
        self::assertStringContainsString('u.organization_name', $sql);
        self::assertStringContainsString('u.first_name', $sql);
        self::assertStringEndsWith(' as author_name', $sql);

        // An unqualified query and an alias-free embedding must both work — the
        // latter is used inside ORDER BY and WHERE, where a trailing `as` is a
        // syntax error.
        $bare = UserDisplayName::sql('', '');
        self::assertStringContainsString("profile_type = 'organisation'", $bare);
        self::assertStringNotContainsString(' as ', $bare);
        self::assertStringNotContainsString('..', $bare);
    }

    public function test_is_organisation_requires_both_the_flag_and_a_name(): void
    {
        self::assertTrue(UserDisplayName::isOrganisation(['profile_type' => 'organisation', 'organization_name' => 'Acme']));
        self::assertFalse(UserDisplayName::isOrganisation(['profile_type' => 'organisation', 'organization_name' => '']));
        self::assertFalse(UserDisplayName::isOrganisation(['profile_type' => 'individual', 'organization_name' => 'Acme']));
        self::assertFalse(UserDisplayName::isOrganisation(null));
    }

    public function test_initials_come_from_the_organisation_name(): void
    {
        self::assertSame(
            'NT',
            UserDisplayName::initials(['profile_type' => 'organisation', 'organization_name' => 'Northside Community Trust']),
        );
        self::assertSame('AL', UserDisplayName::initials(['first_name' => 'Ada', 'last_name' => 'Lovelace']));
        self::assertSame('A', UserDisplayName::initials(['first_name' => 'Ada']));
        self::assertSame('', UserDisplayName::initials([]));
    }
}
