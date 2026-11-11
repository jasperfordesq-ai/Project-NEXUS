<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support\Names;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Names\NameAudience;
use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * E-122 — the name helpers and a serialised User follow the audience, but only
 * once the switch is on.
 *
 * The switch (`names.surname_audience_enforced`) ships OFF. The first half of
 * this file proves that with it off nothing has changed for anyone; the
 * second half forces it on, in the test only, and proves what stage 4 will
 * turn on: first name for an ordinary member, the full name for staff, for
 * the member themself, and under an explicit, reasoned opt-in.
 */
class UserDisplayNameAudienceTest extends TestCase
{
    use DatabaseTransactions;

    private const FIRST = 'Bea';
    private const LAST = 'Zqxsurnamebea';
    private const FULL = 'Bea Zqxsurnamebea';
    private const ORGANISATION = 'Zqx Helping Hands';

    private User $bea;
    private User $organisation;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        UserDisplayName::forgetDegradedCallSites();

        $this->bea = $this->person([
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'name' => self::FULL,
        ]);
        $this->organisation = $this->person([
            'first_name' => 'Contact',
            'last_name' => 'Zqxsurnamecontact',
            'name' => self::ORGANISATION,
            'profile_type' => 'organisation',
            'organization_name' => self::ORGANISATION,
        ]);
    }

    // ------------------------------------------------------------------
    // Switch OFF: nothing changes, for anyone.
    //
    // E-122 stage 4 turned the switch ON as shipped, so these three tests
    // now force it OFF themselves. They stay because they are the proof that
    // reverting the one-line flip restores exactly the old behaviour.
    // ------------------------------------------------------------------

    /**
     * @return array<string, array{0: array<string, mixed>|null}>
     */
    public static function everyKindOfViewer(): array
    {
        return [
            'nobody signed in' => [null],
            'ordinary member' => [['role' => 'member']],
            'broker' => [['role' => 'broker']],
            'admin' => [['role' => 'admin']],
        ];
    }

    /** @param array<string, mixed>|null $viewer */
    #[DataProvider('everyKindOfViewer')]
    public function test_with_the_switch_off_every_helper_returns_the_full_name_as_before(?array $viewer): void
    {
        config([NameAudience::CONFIG_KEY => false]);
        $this->assertFalse(NameAudience::enforced());
        if ($viewer !== null) {
            $this->signInAs($this->person($viewer));
        }

        $row = $this->row($this->bea);
        $prefixed = ['author_first_name' => self::FIRST, 'author_last_name' => self::LAST];

        $this->assertSame(self::FULL, UserDisplayName::resolve($this->bea));
        $this->assertSame(self::FULL, UserDisplayName::resolve($row));
        $this->assertSame(self::FULL, UserDisplayName::resolve(['name' => self::FULL]));
        $this->assertSame(self::FULL, UserDisplayName::resolvePrefixed($prefixed, 'author_'));
        $this->assertSame(self::FULL, UserDisplayName::person($row));
        $this->assertSame(self::FULL, $this->bea->name);
        $this->assertSame(self::FULL, $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id));

        $serialised = $this->bea->toArray();
        $this->assertSame(self::LAST, $serialised['last_name']);
        $this->assertSame(self::FULL, $serialised['name']);
        $this->assertStringContainsString(self::LAST, (string) $this->bea->toJson());

        // Scopes and grants are inert too.
        $this->assertSame(self::FULL, NameAudience::withPublicNames(fn (): string => UserDisplayName::resolve($this->bea)));
        $this->assertSame(self::FULL, NameAudience::forRecipient(null, fn (): string => UserDisplayName::resolve($this->bea)));
        $this->assertSame([], UserDisplayName::degradedCallSites());
    }

    public function test_with_the_switch_off_the_sql_expression_is_the_one_it_always_was(): void
    {
        config([NameAudience::CONFIG_KEY => false]);
        $expected = "CASE
                WHEN u.profile_type = 'organisation'
                     AND u.organization_name IS NOT NULL
                     AND u.organization_name != ''
                THEN u.organization_name
                ELSE TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))
            END as author_name";

        $this->assertSame($expected, UserDisplayName::sql('u', 'author_name'));
        $this->assertSame($expected, UserDisplayName::sqlFull('u', 'author_name', NameReason::AUDIT_LOG));
        $this->assertSame(
            str_replace(['u.', ' as author_name'], '', $expected),
            UserDisplayName::sql('', ''),
            'Unqualified and unaliased, for a WHERE or ORDER BY.'
        );
    }

    public function test_with_the_switch_off_no_query_is_added_to_building_a_name(): void
    {
        config([NameAudience::CONFIG_KEY => false]);
        $this->signInAs($this->person());
        $row = $this->row($this->bea);
        $loaded = User::query()->find($this->bea->id);

        DB::flushQueryLog();
        DB::enableQueryLog();
        UserDisplayName::resolve($row);
        UserDisplayName::sql('u');
        UserDisplayName::person($row);
        $loaded->toArray();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame(0, $queries);
    }

    // ------------------------------------------------------------------
    // Switch forced ON, here only: what stage 4 turns on.
    // ------------------------------------------------------------------

    public function test_switched_on_an_ordinary_member_gets_first_names_only(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());

        $row = $this->row($this->bea);

        $this->assertSame(self::FIRST, UserDisplayName::resolve($this->bea));
        $this->assertSame(self::FIRST, UserDisplayName::resolve($row));
        $this->assertSame(self::FIRST, UserDisplayName::resolve((object) $row));
        $this->assertSame(self::FIRST, UserDisplayName::person($row));
        $this->assertSame(self::FIRST, UserDisplayName::person($this->bea));
        $this->assertSame(self::FIRST, UserDisplayName::resolvePrefixed(
            ['author_first_name' => self::FIRST, 'author_last_name' => self::LAST, 'author_name' => self::FULL],
            'author_'
        ));
        $this->assertSame(self::FIRST, $this->bea->name, 'The model accessor follows the same rule.');
        $this->assertSame(self::FIRST, $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id));

        $serialised = $this->bea->toArray();
        $this->assertArrayNotHasKey('last_name', $serialised);
        $this->assertSame(self::FIRST, $serialised['name']);
        $this->assertSame(self::FIRST, $serialised['first_name'], 'Clients still get first_name.');
        $this->assertStringNotContainsString(self::LAST, (string) $this->bea->toJson());
    }

    public function test_switched_on_a_user_nested_in_another_response_loses_the_surname_too(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());

        $payload = json_encode([
            'items' => [['id' => 1, 'user' => User::query()->find($this->bea->id)]],
            'people' => User::query()->whereKey($this->bea->id)->get(),
        ], JSON_THROW_ON_ERROR);

        $this->assertStringNotContainsString(self::LAST, $payload);
        $this->assertStringContainsString(self::FIRST, $payload);
    }

    /**
     * @return array<string, array{0: array<string, mixed>}>
     */
    public static function staffOfTheCommunity(): array
    {
        return [
            'admin' => [['role' => 'admin']],
            'admin by flag' => [['role' => 'member', 'is_admin' => 1]],
            'broker' => [['role' => 'broker']],
            'coordinator' => [['role' => 'coordinator']],
        ];
    }

    /** @param array<string, mixed> $staff */
    #[DataProvider('staffOfTheCommunity')]
    public function test_switched_on_staff_of_the_community_still_get_the_full_name(array $staff): void
    {
        $this->switchOn();
        $this->signInAs($this->person($staff));

        $row = $this->row($this->bea);

        $this->assertSame(self::FULL, UserDisplayName::resolve($this->bea));
        $this->assertSame(self::FULL, UserDisplayName::resolve($row));
        $this->assertSame(self::FULL, UserDisplayName::person($row));
        $this->assertSame(self::FULL, UserDisplayName::resolvePrefixed(
            ['author_first_name' => self::FIRST, 'author_last_name' => self::LAST],
            'author_'
        ));
        $this->assertSame(self::FULL, $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id));
        $this->assertSame(self::LAST, $this->bea->toArray()['last_name']);
        $this->assertSame(self::FULL, $this->bea->toArray()['name']);
    }

    public function test_switched_on_a_broker_of_another_community_gets_first_names(): void
    {
        $this->switchOn();
        $this->signInAs($this->person(['role' => 'broker'], 999));

        $this->assertSame(self::FIRST, UserDisplayName::resolve($this->bea));
        $this->assertSame(self::FIRST, $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id));
        $this->assertArrayNotHasKey('last_name', $this->bea->toArray());
    }

    public function test_switched_on_a_member_keeps_their_own_surname(): void
    {
        $this->switchOn();
        $this->signInAs($this->bea);

        $me = User::query()->find($this->bea->id);
        $other = $this->person(['first_name' => 'Cal', 'last_name' => 'Zqxsurnamecal', 'name' => 'Cal Zqxsurnamecal']);
        $this->signInAs($this->bea);

        $this->assertSame(self::FULL, UserDisplayName::resolve($me));
        $this->assertSame(self::FULL, UserDisplayName::person($me));
        $this->assertSame(self::FULL, $me->name);
        $this->assertSame(self::LAST, $me->toArray()['last_name'], 'The erasure guard: an edit form prefilled from this keeps the surname.');
        $this->assertSame(self::FULL, $me->toArray()['name']);

        // ...and nobody else's.
        $this->assertSame('Cal', UserDisplayName::resolve($other));
        $this->assertArrayNotHasKey('last_name', $other->toArray());

        // A bare row does not say whose it is, so "own name" is never assumed
        // from an `id` key (it may be a listing's id, or an event's).
        $this->assertSame(self::FIRST, UserDisplayName::resolve($this->row($this->bea)));
        // Own-account code that builds its name from a row says so.
        $this->assertSame(self::FULL, UserDisplayName::full($this->row($this->bea), NameReason::SELF));
    }

    public function test_switched_on_with_no_viewer_only_a_reasoned_opt_in_gives_a_full_name(): void
    {
        $this->switchOn();
        $row = $this->row($this->bea);
        $prefixed = ['donor_first_name' => self::FIRST, 'donor_last_name' => self::LAST];

        // A queue job or a scheduled command.
        $this->assertSame(self::FIRST, UserDisplayName::resolve($this->bea));
        $this->assertSame(self::FIRST, UserDisplayName::resolve($row));
        $this->assertSame(self::FIRST, UserDisplayName::resolvePrefixed($prefixed, 'donor_'));
        $this->assertArrayNotHasKey('last_name', $this->bea->toArray());

        $this->assertSame(self::FULL, UserDisplayName::full($this->bea, NameReason::EXTERNAL_PROCESSOR));
        $this->assertSame(self::FULL, UserDisplayName::full($row, NameReason::LEGAL_RECORD));
        $this->assertSame(self::FULL, UserDisplayName::fullPrefixed($prefixed, 'donor_', NameReason::AUDIT_LOG));
        $this->assertSame('—', UserDisplayName::full(null, NameReason::AUDIT_LOG, '—'));
        $this->assertSame(
            self::FULL,
            $this->selectName(UserDisplayName::sqlFull('u', 'shown', NameReason::AUDIT_LOG), (int) $this->bea->id)
        );

        $inScope = NameAudience::withFullNames(NameReason::STAFF_RECIPIENT, fn (): array => [
            UserDisplayName::resolve($row),
            $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id),
            $this->bea->toArray()['last_name'] ?? null,
        ]);
        $this->assertSame([self::FULL, self::FULL, self::LAST], $inScope);

        $this->assertSame(self::FIRST, UserDisplayName::resolve($row), 'The scope is closed again.');
    }

    public function test_switched_on_a_recipient_scope_decides_for_the_recipient(): void
    {
        $this->switchOn();
        $admin = $this->person(['role' => 'admin']);
        $member = $this->person();
        $broker = $this->person(['role' => 'broker']);
        $row = $this->row($this->bea);

        // An admin's own request, rendering for a member: first names.
        $this->signInAs($admin);
        $this->assertSame(self::FULL, UserDisplayName::resolve($row));
        $this->assertSame(self::FIRST, NameAudience::forRecipient($member, fn (): string => UserDisplayName::resolve($row)));
        $this->assertSame(self::FULL, NameAudience::forRecipient($this->bea, fn (): string => UserDisplayName::resolve($this->bea)), 'Her own name, to her.');

        // A member's request, rendering for staff: full names.
        $this->signInAs($member);
        $this->assertSame(self::FIRST, UserDisplayName::resolve($row));
        $this->assertSame(self::FULL, NameAudience::forRecipient($broker, fn (): string => UserDisplayName::resolve($row)));
    }

    public function test_switched_on_a_public_scope_gives_first_names_even_to_an_admin(): void
    {
        $this->switchOn();
        $admin = $this->person(['role' => 'admin']);
        $this->signInAs($admin);

        $shown = NameAudience::withPublicNames(fn (): array => [
            UserDisplayName::resolve($this->bea),
            UserDisplayName::resolve(User::query()->find($admin->id)),
            $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->bea->id),
            array_key_exists('last_name', $this->bea->toArray()),
        ]);

        $this->assertSame([self::FIRST, (string) $admin->first_name, self::FIRST, false], $shown);
    }

    public function test_switched_on_an_organisation_keeps_its_trading_name_for_everyone(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());

        $this->assertSame(self::ORGANISATION, UserDisplayName::resolve($this->organisation));
        $this->assertSame(self::ORGANISATION, UserDisplayName::resolve($this->row($this->organisation)));
        $this->assertSame(self::ORGANISATION, $this->selectName(UserDisplayName::sql('u', 'shown'), (int) $this->organisation->id));
        $this->assertSame(self::ORGANISATION, UserDisplayName::publicName($this->organisation));
        $this->assertSame(self::ORGANISATION, $this->organisation->toArray()['name']);
        $this->assertArrayNotHasKey('last_name', $this->organisation->toArray(), "The contact person's surname is still a surname.");

        // person() is about the human behind the account: their first name.
        $this->assertSame('Contact', UserDisplayName::person($this->organisation));
    }

    public function test_the_public_name_never_contains_a_surname_whatever_the_row_carries(): void
    {
        // publicName() does not depend on the switch or the viewer.
        $this->signInAs($this->person(['role' => 'admin']));

        $this->assertSame(self::FIRST, UserDisplayName::publicName($this->bea));
        $this->assertSame(self::FIRST, UserDisplayName::publicName($this->row($this->bea)));
        $this->assertSame(self::FIRST, UserDisplayName::publicNamePrefixed(
            ['sender_first_name' => ' ' . self::FIRST . ' ', 'sender_last_name' => self::LAST, 'sender_name' => self::FULL],
            'sender_'
        ));
        $this->assertSame('Member', UserDisplayName::publicName(null, 'Member'));
        $this->assertSame('Member', UserDisplayName::publicName(['last_name' => self::LAST], 'Member'));
        $this->assertSame(
            self::FIRST,
            $this->selectName(UserDisplayName::sqlPublic('u', 'shown'), (int) $this->bea->id)
        );
        $this->assertSame([], UserDisplayName::degradedCallSites());
    }

    public function test_a_row_with_only_a_stored_full_name_degrades_to_its_first_word_and_is_noted(): void
    {
        $this->assertSame(self::FIRST, UserDisplayName::publicName(['name' => self::FULL])); // noted: this line
        $line = __LINE__ - 1;

        $this->assertSame([__FILE__ . ':' . $line], UserDisplayName::degradedCallSites());

        // Wrong on the safe side: never a leak.
        $this->assertSame('Zqx', UserDisplayName::publicName(['name' => self::ORGANISATION]));
        $this->assertSame('Mary', UserDisplayName::publicName(['name' => "Mary Anne\tSmith"]));
        $this->assertSame('Cher', UserDisplayName::publicName(['first_name' => '', 'name' => 'Cher']));

        UserDisplayName::forgetDegradedCallSites();
        $this->assertSame([], UserDisplayName::degradedCallSites());
    }

    /**
     * E-122 stage 4. Dozens of lists load a member as `author:id,name,avatar_url`.
     * Guessing the first word of that stored name turned the organisation
     * "Zqx Helping Hands" into "Zqx" and "Mary Anne" into "Mary". A loaded
     * User says which member it is, so the public name is looked up instead.
     */
    public function test_a_loaded_member_carrying_only_a_stored_name_is_looked_up_not_guessed(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());
        $maryAnne = $this->person(['first_name' => 'Mary Anne', 'last_name' => 'Zqxsurnamemary', 'name' => 'Mary Anne Zqxsurnamemary']);

        $organisation = User::query()->select(['id', 'name', 'avatar_url'])->find($this->organisation->id);
        $member = User::query()->select(['id', 'name', 'avatar_url'])->find($maryAnne->id);

        $this->assertSame(self::ORGANISATION, UserDisplayName::resolve($organisation));
        $this->assertSame(self::ORGANISATION, $organisation->name);
        $this->assertSame(self::ORGANISATION, $organisation->toArray()['name']);
        $this->assertSame('Mary Anne', UserDisplayName::resolve($member));
        $this->assertSame('Mary Anne', $member->toArray()['name']);
        $this->assertStringNotContainsString('Zqxsurnamemary', (string) $member->toJson());

        // Still noted: the select should carry first_name, profile_type and
        // organization_name so that no extra query is needed.
        $this->assertNotSame([], UserDisplayName::degradedCallSites());

        // A plain row cannot say whose it is, so it is still guessed.
        $this->assertSame('Mary', UserDisplayName::publicName(['id' => $maryAnne->id, 'name' => 'Mary Anne Zqxsurnamemary']));
    }

    public function test_switched_on_the_stored_name_is_still_written_in_full(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());

        $this->assertSame(self::FULL, UserDisplayName::forStorage(null, null, self::FIRST, self::LAST));
        $this->assertSame(self::FULL, UserDisplayName::fromParts(null, null, self::FIRST, self::LAST));

        // Reading the property to WRITE is untouched: only serialisation is.
        $this->assertSame(self::LAST, $this->bea->last_name);
        $this->assertSame(self::LAST, DB::table('users')->where('id', $this->bea->id)->value('last_name'));
    }

    public function test_switched_on_one_lookup_serves_every_name_in_a_request(): void
    {
        $this->switchOn();
        $this->signInAs($this->person());
        $request = \Illuminate\Http\Request::create('/api/v2/e122-probe', 'GET');
        $request->setRouteResolver(static fn () => new \Illuminate\Routing\Route('GET', '/api/v2/e122-probe', static fn () => null));
        $this->app->instance('request', $request);

        $rows = array_fill(0, 40, $this->row($this->bea));
        $loaded = User::query()->find($this->bea->id);

        DB::flushQueryLog();
        DB::enableQueryLog();
        foreach ($rows as $row) {
            UserDisplayName::resolve($row);
            UserDisplayName::sql('u');
        }
        $loaded->toArray();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame(1, $queries, 'The audience is decided once per request, not once per name.');
    }

    // ------------------------------------------------------------------

    private function switchOn(): void
    {
        config([NameAudience::CONFIG_KEY => true]);
        $this->assertTrue(NameAudience::enforced());
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @return array<string, mixed> */
    private function row(User $user): array
    {
        return (array) DB::table('users')
            ->where('tenant_id', $user->tenant_id)
            ->where('id', $user->id)
            ->first(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name']);
    }

    private function selectName(string $expression, int $userId): string
    {
        $row = DB::selectOne(
            "SELECT {$expression} FROM users u WHERE u.id = ? AND u.tenant_id = ?",
            [$userId, $this->testTenantId]
        );

        return (string) ($row->shown ?? '');
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
