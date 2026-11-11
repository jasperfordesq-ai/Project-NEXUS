<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E122;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\GroupMentionService;
use App\Services\SocialNotificationService;
use App\Services\UserService;
use App\Support\Names\RecipientName;
use App\Support\UserDisplayName;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * E-122 stages 6–7 — text read later by someone else, and finding by surname.
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins"; "Brokers too".
 *
 *  - A notification is written during the SENDER's request. The audience of
 *    that request is wrong for it twice: the sender is "self" (their own
 *    surname stays whole) and a sender who is staff may see surnames the
 *    recipient may not. The name must follow the RECIPIENT.
 *  - A surname that is never displayed can still be confirmed by typing it
 *    into a search box. Only staff of the community may match on it.
 */
class RecipientNameAndSurnameSearchTest extends TestCase
{
    use DatabaseTransactions;

    private const FIRST = 'Zqxfirstactor';
    private const LAST = 'Zqxsurnameactor';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    // ------------------------------------------------------------------
    // The name of an actor, as the recipient may see it
    // ------------------------------------------------------------------

    /**
     * @return array<string, array{0: array<string, mixed>, 1: bool}>
     */
    public static function recipients(): array
    {
        return [
            'member' => [['role' => 'member'], false],
            'admin' => [['role' => 'admin'], true],
            'broker' => [['role' => 'broker'], true],
            'coordinator' => [['role' => 'coordinator'], true],
        ];
    }

    /** @param array<string, mixed> $recipientAttributes */
    #[DataProvider('recipients')]
    public function test_an_actor_is_named_as_the_recipient_may_see_them_whoever_is_signed_in(array $recipientAttributes, bool $seesSurname): void
    {
        $actor = $this->actor(['role' => 'admin']);
        $recipient = $this->person($recipientAttributes);

        // The actor is signed in — and is an administrator, who may see every
        // surname including their own. None of that may reach the recipient.
        $this->signInAs($actor);

        foreach ([$actor->id, $actor, (object) ['id' => $actor->id, 'name' => self::FIRST . ' ' . self::LAST]] as $given) {
            $name = RecipientName::of($given, $recipient->id);
            $this->assertStringContainsString(self::FIRST, $name);
            $this->assertSame($seesSurname, str_contains($name, self::LAST), 'given ' . get_debug_type($given));
        }
    }

    public function test_with_no_particular_recipient_the_name_is_the_one_anyone_may_see(): void
    {
        $actor = $this->actor(['role' => 'admin']);
        $this->signInAs($actor);

        $this->assertSame(self::FIRST, RecipientName::of($actor, null));
        $this->assertSame('fallback', RecipientName::of(null, null, 'fallback'));
        $this->assertSame('fallback', RecipientName::of(0, 5, 'fallback'));
    }

    public function test_an_organisation_keeps_its_trading_name_for_every_recipient(): void
    {
        $organisation = $this->actor(['profile_type' => 'organisation', 'organization_name' => 'Zqx Helping Hands']);
        $recipient = $this->person();

        $this->assertSame('Zqx Helping Hands', RecipientName::of($organisation->id, $recipient->id));
    }

    public function test_text_rendered_for_a_recipient_is_named_for_that_recipient(): void
    {
        $actor = $this->actor(['role' => 'admin']);
        $member = $this->person();
        $admin = $this->person(['role' => 'admin']);
        $this->signInAs($actor);

        // Outside any recipient, the signed-in administrator sees the surname.
        $this->assertStringContainsString(self::LAST, UserDisplayName::resolve($actor));

        $forMember = LocaleContext::withLocale($member, static fn (): string => UserDisplayName::resolve($actor));
        $this->assertSame(self::FIRST, $forMember);

        $forAdmin = LocaleContext::withLocale($admin, static fn (): string => UserDisplayName::resolve($actor));
        $this->assertStringContainsString(self::LAST, $forAdmin);

        // A bare locale string names nobody, so the request's audience stands.
        $forLocale = LocaleContext::withLocale('en', static fn (): string => UserDisplayName::resolve($actor));
        $this->assertStringContainsString(self::LAST, $forLocale);
    }

    public function test_a_like_from_an_administrator_tells_the_member_a_first_name_only(): void
    {
        $actor = $this->actor(['role' => 'admin']);
        $member = $this->person();
        $postId = (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'content' => 'E-122 like notification',
            'created_at' => now(),
        ]);
        $this->signInAs($actor);

        SocialNotificationService::notifyLike($member->id, $actor->id, 'post', $postId, 'E-122 like notification');

        $messages = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->pluck('message')
            ->all();
        $this->assertNotSame([], $messages, 'the like produced a notification');
        $text = implode("\n", array_map('strval', $messages));
        $this->assertStringContainsString(self::FIRST, $text);
        $this->assertStringNotContainsString(self::LAST, $text);
    }

    // ------------------------------------------------------------------
    // Finding a member by typing their surname
    // ------------------------------------------------------------------

    public function test_a_member_cannot_find_someone_by_surname_and_staff_can(): void
    {
        $target = $this->actor();
        $member = $this->person();
        $broker = $this->person(['role' => 'broker']);

        $this->signInAs($member);
        $this->assertNotContains($target->id, $this->searchIds(self::LAST, $member), 'member, by surname');
        $this->assertContains($target->id, $this->searchIds(self::FIRST, $member), 'member, by first name');

        $this->signInAs($broker);
        $this->assertContains($target->id, $this->searchIds(self::LAST, $broker), 'broker, by surname');
    }

    public function test_group_mention_suggestions_do_not_match_a_surname_for_a_member(): void
    {
        $target = $this->actor();
        $member = $this->person();
        $admin = $this->person(['role' => 'admin']);
        $groupId = $this->groupWith($member, $target, $admin);

        $this->signInAs($member);
        $this->assertSame([], GroupMentionService::getMemberSuggestions($groupId, $member->id, self::LAST));
        $byFirst = GroupMentionService::getMemberSuggestions($groupId, $member->id, self::FIRST);
        $this->assertSame([$target->id], array_column($byFirst, 'id'));
        $this->assertSame(self::FIRST, $byFirst[0]['name']);

        $this->signInAs($admin);
        $bySurname = GroupMentionService::getMemberSuggestions($groupId, $admin->id, self::LAST);
        $this->assertSame([$target->id], array_column($bySurname, 'id'));
    }

    // ------------------------------------------------------------------

    /** @return list<int> */
    private function searchIds(string $term, User $viewer): array
    {
        // The SQL path: the search engine knows nothing of rows created in
        // this transaction, so its availability is switched off for the call.
        $available = new \ReflectionProperty(\App\Services\SearchService::class, 'available');
        $available->setAccessible(true);
        $before = $available->getValue();
        $available->setValue(null, false);
        try {
            $result = UserService::search($term, 20, $viewer->id);
        } finally {
            $available->setValue(null, $before);
        }

        $rows = $result['items'] ?? $result['data'] ?? $result;

        return array_map(static fn ($row): int => (int) data_get($row, 'id'), is_array($rows) ? $rows : $rows->all());
    }

    private function signInAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string, mixed> $overrides */
    private function actor(array $overrides = []): User
    {
        return $this->person(array_merge([
            'first_name' => self::FIRST,
            'last_name' => self::LAST,
            'name' => self::FIRST . ' ' . self::LAST,
        ], $overrides));
    }

    private function groupWith(User ...$members): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $members[0]->id,
            'name' => 'E-122 stage 6 ' . bin2hex(random_bytes(3)),
            'visibility' => 'public',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        foreach ($members as $member) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $member->id,
                'role' => 'member',
                'status' => 'active',
            ]);
        }

        return $groupId;
    }

    /** @param array<string, mixed> $overrides */
    private function person(array $overrides = [], ?int $tenantId = null): User
    {
        $user = User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'onboarding_completed' => true,
            'privacy_profile' => 'public',
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
