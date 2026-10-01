<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\FederationSearchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-465 (E-075 A-2) — the v1 partner directory's free-text search must not
 * match a skills value the member switched off.
 *
 * F-447 (E-074 `dc14215fe`) stated the rule in its own comment at
 * `FederationController.php:404`:
 *
 *     "a member who switched a field off must not be findable BY it either"
 *
 * It applied that to the `?skills=` and `?location=` FILTERS. The free-text
 * `?q=` term five lines above was left reading
 *
 *     AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ?
 *          OR u.skills LIKE ?)
 *
 * with no visibility condition on the skills arm. The value itself is correctly
 * withheld from the response, so this is a confirm-a-guess oracle rather than a
 * read: `?q=<hidden value>` selects the member and the pagination total reports
 * 1, confirming the guess without ever returning the field.
 *
 * The fix reuses F-447's own condition, which is also the shape of the service
 * F-447's comment cites — `FederationSearchService::searchMembers()` gates its
 * free-text term with `(fus.show_skills_federated = 1 AND u.skills LIKE ?)`.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * Prerequisite: the legacy v1 external-federation protocol switched on (it
 * ships disabled). The tests switch it on themselves.
 */
final class F465FederatedSearchTermHonoursTheSkillsSwitchTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private const SECRET_SKILL = 'e075f465confidentialcounselling';

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    /**
     * THE FIX — probing the hidden skills value through the free-text term
     * selects nobody, and the pagination total does not confirm the guess.
     */
    public function test_the_free_text_term_does_not_match_a_skill_the_member_switched_off(): void
    {
        $hidden = $this->federatedMember(showSkills: false);
        $key = $this->partnerApiKey('e075-f465-a');

        // Baseline: the member IS federated and listed, and the value is
        // correctly withheld there (F-447 holds) — so the probe is the only
        // thing under test.
        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $all = $this->apiGet('/v1/federation/members?per_page=100', ['X-API-Key' => $key]);
        self::assertSame(200, $all->status(), (string) $all->getContent());
        $baseRow = $this->rowFor($all->json('data') ?? [], (int) $hidden->id);
        self::assertNotNull($baseRow, 'precondition: the member is federated and listed');
        self::assertSame([], $baseRow['skills'], 'precondition: F-447 holds — the value is withheld');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $probe = $this->apiGet(
            '/v1/federation/members?per_page=100&q=' . self::SECRET_SKILL,
            ['X-API-Key' => $key]
        );
        self::assertSame(200, $probe->status(), (string) $probe->getContent());

        self::assertNull(
            $this->rowFor($probe->json('data') ?? [], (int) $hidden->id),
            'the hidden skills value must not select the member. ' . (string) $probe->getContent()
        );
        self::assertSame(
            0,
            (int) ($probe->json('pagination.total') ?? -1),
            'and the count must not confirm the guess either. ' . (string) $probe->getContent()
        );
    }

    /**
     * THE FIX, AGREEING WITH THE CITED MODEL — the two surfaces F-447 set out to
     * bring into agreement now give the same answer to the same probe.
     */
    public function test_the_v1_read_and_the_maintained_search_service_now_agree(): void
    {
        $hidden = $this->federatedMember(showSkills: false);

        $search = app(FederationSearchService::class)->searchMembers(
            [$this->testTenantId],
            ['limit' => 100, 'search' => self::SECRET_SKILL]
        );
        self::assertNull(
            $this->rowFor($search['members'] ?? [], (int) $hidden->id),
            'the maintained service gates its free-text term on show_skills_federated'
        );

        $key = $this->partnerApiKey('e075-f465-b');
        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $v1 = $this->apiGet(
            '/v1/federation/members?per_page=100&q=' . self::SECRET_SKILL,
            ['X-API-Key' => $key]
        );
        self::assertNull(
            $this->rowFor($v1->json('data') ?? [], (int) $hidden->id),
            'and so does the v1 read. ' . (string) $v1->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — a member who ALLOWED skills sharing is still
     * findable by the same term, and the value is still returned. This case
     * differs from the one above only in the member's own switch.
     */
    public function test_control_a_member_who_shares_skills_is_still_findable_and_returned(): void
    {
        $shown = $this->federatedMember(showSkills: true);
        $key = $this->partnerApiKey('e075-f465-c');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $probe = $this->apiGet(
            '/v1/federation/members?per_page=100&q=' . self::SECRET_SKILL,
            ['X-API-Key' => $key]
        );
        self::assertSame(200, $probe->status(), (string) $probe->getContent());

        $row = $this->rowFor($probe->json('data') ?? [], (int) $shown->id);
        self::assertNotNull(
            $row,
            'control: a consenting member is still findable by their skill. ' . (string) $probe->getContent()
        );
        self::assertContains(
            self::SECRET_SKILL,
            (array) ($row['skills'] ?? []),
            'control: and the value is still returned'
        );
        self::assertSame(
            1,
            (int) ($probe->json('pagination.total') ?? -1),
            'control: and the count still reports the consenting member'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — searching by NAME, which is what the free-text
     * box is mainly for, still finds a member who switched skills off. Nothing
     * here removes the search.
     */
    public function test_control_name_search_still_works_for_a_skills_hidden_member(): void
    {
        $hidden = $this->federatedMember(showSkills: false);
        $key = $this->partnerApiKey('e075-f465-d');

        $this->useKey($key, 'GET', '/api/v1/federation/members');
        $byName = $this->apiGet(
            '/v1/federation/members?per_page=100&q=' . rawurlencode((string) $hidden->first_name),
            ['X-API-Key' => $key]
        );
        self::assertSame(200, $byName->status(), (string) $byName->getContent());
        self::assertNotNull(
            $this->rowFor($byName->json('data') ?? [], (int) $hidden->id),
            'control: name search is unaffected. ' . (string) $byName->getContent()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<string,mixed>|null
     */
    private function rowFor(array $rows, int $id): ?array
    {
        foreach ($rows as $row) {
            if (is_array($row) && (int) ($row['id'] ?? 0) === $id) {
                return $row;
            }
        }

        return null;
    }

    private function federatedMember(bool $showSkills): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'skills' => self::SECRET_SKILL,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_location_federated' => 0,
                'show_skills_federated' => $showSkills ? 1 : 0,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    /**
     * An EXTERNAL partner key: the free-text clause is shared by both arms of
     * the `$isExternal` fork, and the external arm is the one a key issued for
     * an outside organisation now takes.
     */
    private function partnerApiKey(string $platformId): string
    {
        DB::table('federation_external_partners')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => $platformId,
            'base_url' => 'https://' . $platformId . '-' . bin2hex(random_bytes(4)) . '.invalid',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'allow_member_search' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $apiKey = $platformId . '-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'E-075 F465 ' . $platformId,
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0,
            'platform_id' => $platformId,
            'permissions' => json_encode(['members:read']),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
