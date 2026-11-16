<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\CommunitySetupService;
use App\Services\LegalDocumentService;
use App\Services\PlatformTeam\CommunitySetupChecklistService;
use App\Services\PlatformTeam\LegalDocumentsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Legal documents: per community, which legal documents
 * it has (terms and privacy notice always listed, others when it has them),
 * whether each is published, its version and publication date, whether
 * members must accept it, and — when they must and it is published — how many
 * members are asked and how many have not accepted the current version.
 *
 * "Published" is the rule the Community setup page uses (one shared helper),
 * so the two pages never disagree. The member figures use the population of
 * LegalDocumentService::eligibleMemberQuery() and are pinned to
 * getComplianceSummary() for one community. Counts only: no names.
 */
class LegalDocumentsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/legal-documents';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['unavailable', 'totals', 'communities'];

    private const TOTAL_KEYS = ['communities', 'no_privacy_notice'];

    private const ROW_KEYS = ['id', 'name', 'slug', 'is_active', 'no_privacy_notice', 'documents'];

    private const DOCUMENT_KEYS = [
        'type', 'exists', 'published', 'version_number', 'published_at', 'requires_acceptance',
        'members_asked', 'members_not_accepted',
    ];

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Legal Test ' . $suffix,
            'slug' => 'legal-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    /** @param array<string, mixed> $attributes */
    private function account(int $communityId, array $attributes = []): int
    {
        return (int) DB::table('users')->insertGetId(array_merge([
            'tenant_id' => $communityId,
            'name' => 'Legalfirst Legalsurname',
            'first_name' => 'Legalfirst',
            'last_name' => 'Legalsurname',
            'email' => 'legal-' . Str::lower(Str::random(12)) . '@example.test',
            'status' => 'active',
            'is_approved' => 1,
            'role' => 'member',
        ], $attributes));
    }

    /**
     * A document, and (unless $draft is null) one version that is its current one.
     *
     * @param array<string, mixed> $attributes
     * @return array{document: int, version: int|null}
     */
    private function legal(int $communityId, string $type, ?bool $draft, array $attributes = []): array
    {
        $documentId = (int) DB::table('legal_documents')->insertGetId(array_merge([
            'tenant_id' => $communityId,
            'document_type' => $type,
            'title' => 'Legal test ' . $type,
            'slug' => $type . '-' . Str::lower(Str::random(6)),
            'is_active' => 1,
            'requires_acceptance' => 1,
        ], $attributes));
        if ($draft === null) {
            return ['document' => $documentId, 'version' => null];
        }
        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '2.1',
            'content' => '<p>Planted legal content Zq7</p>',
            'effective_date' => now()->toDateString(),
            'is_draft' => $draft ? 1 : 0,
            'is_current' => $draft ? 0 : 1,
            'published_at' => $draft ? null : now()->subDays(3),
            'created_by' => 1,
        ]);
        DB::table('legal_documents')->where('id', $documentId)->update(['current_version_id' => $versionId]);

        return ['document' => $documentId, 'version' => $versionId];
    }

    /** @param array{document: int, version: int|null} $doc */
    private function accept(int $userId, array $doc): void
    {
        DB::table('user_legal_acceptances')->insert([
            'user_id' => $userId,
            'document_id' => $doc['document'],
            'version_id' => $doc['version'],
            'version_number' => '2.1',
            'ip_address' => '203.0.113.77',
            'user_agent' => 'PlantedAgent/9.9',
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

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function document(array $row, string $type): array
    {
        foreach ($row['documents'] as $document) {
            if ($document['type'] === $type) {
                return $document;
            }
        }
        $this->fail("document {$type} is not listed");
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

    public function test_it_carries_exactly_what_the_page_shows_and_nothing_personal(): void
    {
        $id = $this->community();
        $terms = $this->legal($id, 'terms', false);
        $this->legal($id, 'privacy', false);
        $member = $this->account($id);
        $this->accept($member, $terms);
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::sorted(self::TOP_KEYS), self::sorted(array_keys($data)));
        $this->assertSame(self::sorted(self::TOTAL_KEYS), self::sorted(array_keys($data['totals'])));
        foreach ($data['communities'] as $row) {
            $this->assertSame(self::sorted(self::ROW_KEYS), self::sorted(array_keys($row)));
            foreach ($row['documents'] as $document) {
                $this->assertSame(self::sorted(self::DOCUMENT_KEYS), self::sorted(array_keys($document)));
            }
        }
        $this->assertSame([], $data['unavailable']);

        $body = (string) $response->getContent();
        foreach ([
            'Legalfirst', 'Legalsurname', '@example.test', '203.0.113.77', 'PlantedAgent',
            'Planted legal content', '"user_id"', '"title"', '"content"',
        ] as $needle) {
            $this->assertStringNotContainsString($needle, $body, $needle);
        }
    }

    public function test_every_community_is_listed_with_terms_and_privacy_even_when_missing(): void
    {
        $empty = $this->community();
        $off = $this->community(['is_active' => 0]);
        $this->actAsPlatformTeam();

        $data = $this->data();
        $row = $this->row($data, $empty);

        $this->assertSame(DB::table('tenants')->count(), count($data['communities']));
        $this->assertSame(count($data['communities']), $data['totals']['communities']);
        $this->assertSame(['terms', 'privacy'], array_column($row['documents'], 'type'));
        foreach ($row['documents'] as $document) {
            $this->assertFalse($document['exists']);
            $this->assertFalse($document['published']);
            $this->assertNull($document['version_number']);
            $this->assertNull($document['published_at']);
            $this->assertNull($document['requires_acceptance']);
            $this->assertNull($document['members_asked']);
            $this->assertNull($document['members_not_accepted']);
        }
        $this->assertTrue($row['no_privacy_notice']);
        $this->assertTrue($row['is_active']);
        $this->assertFalse($this->row($data, $off)['is_active']);
    }

    public function test_other_kinds_of_document_are_listed_after_terms_and_privacy(): void
    {
        $id = $this->community();
        $this->legal($id, 'cookies', false, ['requires_acceptance' => 0]);
        $this->legal($id, 'privacy', false);
        $this->legal($id, 'acceptable_use', true);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(['terms', 'privacy', 'cookies', 'acceptable_use'], array_column($row['documents'], 'type'));
        $cookies = $this->document($row, 'cookies');
        $this->assertTrue($cookies['exists']);
        $this->assertTrue($cookies['published']);
        $this->assertFalse($cookies['requires_acceptance']);
        $this->assertNull($cookies['members_asked']);
        $this->assertNull($cookies['members_not_accepted']);
        $this->assertFalse($this->document($row, 'acceptable_use')['published']);
        $this->assertFalse($row['no_privacy_notice']);
    }

    public function test_published_follows_the_same_rule_as_the_community_setup_page(): void
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
        $this->legal($switchedOff, 'privacy', false, ['is_active' => 0]);
        $this->legal($switchedOff, 'terms', false);
        $this->actAsPlatformTeam();

        $data = $this->data();
        $setup = [];
        foreach (app(CommunitySetupChecklistService::class)->overview()['communities'] as $setupRow) {
            $setup[(int) $setupRow['id']] = $setupRow;
        }

        foreach ([$published, $draft, $noVersion, $switchedOff] as $id) {
            $row = $this->row($data, $id);
            $this->assertSame($setup[$id]['privacy_notice_published'], $this->document($row, 'privacy')['published'], "privacy {$id}");
            $this->assertSame($setup[$id]['terms_published'], $this->document($row, 'terms')['published'], "terms {$id}");
            $this->assertSame(!$setup[$id]['privacy_notice_published'], $row['no_privacy_notice'], "no_privacy_notice {$id}");
        }
        $this->assertTrue($this->document($this->row($data, $published), 'privacy')['published']);
        $this->assertFalse($this->document($this->row($data, $draft), 'privacy')['published']);
        $this->assertTrue($this->document($this->row($data, $noVersion), 'privacy')['exists']);
        $this->assertFalse($this->document($this->row($data, $noVersion), 'privacy')['published']);
        $this->assertFalse($this->document($this->row($data, $switchedOff), 'privacy')['published']);
        $this->assertTrue($this->row($data, $switchedOff)['no_privacy_notice']);
    }

    public function test_a_published_document_carries_its_version_and_date_and_a_draft_does_not(): void
    {
        $id = $this->community();
        $this->legal($id, 'terms', false);
        $this->legal($id, 'privacy', true);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);
        $terms = $this->document($row, 'terms');
        $privacy = $this->document($row, 'privacy');

        $this->assertSame('2.1', $terms['version_number']);
        $this->assertNotNull($terms['published_at']);
        $this->assertSame(now()->subDays(3)->toDateString(), substr((string) $terms['published_at'], 0, 10));
        $this->assertNull($privacy['version_number']);
        $this->assertNull($privacy['published_at']);
        $this->assertNull($privacy['members_asked']);
        $this->assertNull($privacy['members_not_accepted']);
    }

    public function test_members_asked_and_not_accepted_count_the_members_the_acceptance_gate_asks(): void
    {
        $id = $this->community();
        $other = $this->community();
        $terms = $this->legal($id, 'terms', false);
        $privacy = $this->legal($id, 'privacy', false);
        $old = $this->legal($id, 'cookies', false); // its acceptance below is for this document, not terms

        $a = $this->account($id);
        $b = $this->account($id);
        $c = $this->account($id);
        $this->accept($a, $terms);
        $this->accept($b, $terms);
        $this->accept($a, $privacy);
        $this->accept($c, $old);
        // Not asked: administrators, a suspended account, a manager stand-in.
        $admin = $this->account($id, ['role' => 'admin']);
        $this->accept($admin, $terms);
        $this->account($id, ['role' => 'member', 'is_admin' => 1]);
        $this->account($id, ['role' => 'member', 'is_tenant_super_admin' => 1]);
        $this->account($id, ['status' => 'suspended']);
        $this->account($id, ['status' => 'delegate']);
        // Another community's member who somehow accepted this version does not count here.
        $stranger = $this->account($other);
        $this->accept($stranger, $terms);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);

        $this->assertSame(3, $this->document($row, 'terms')['members_asked']);
        $this->assertSame(1, $this->document($row, 'terms')['members_not_accepted']);
        $this->assertSame(3, $this->document($row, 'privacy')['members_asked']);
        $this->assertSame(2, $this->document($row, 'privacy')['members_not_accepted']);
        $this->assertSame(2, $this->document($row, 'cookies')['members_not_accepted']);
    }

    public function test_the_figures_match_the_communitys_own_compliance_summary(): void
    {
        $id = $this->community();
        $terms = $this->legal($id, 'terms', false);
        $privacy = $this->legal($id, 'privacy', false);
        $this->legal($id, 'cookies', false, ['requires_acceptance' => 0]);
        $members = [];
        for ($i = 0; $i < 5; $i++) {
            $members[] = $this->account($id);
        }
        $this->account($id, ['role' => 'admin']);
        $this->account($id, ['status' => 'pending']);
        $this->accept($members[0], $terms);
        $this->accept($members[1], $terms);
        $this->accept($members[2], $terms);
        $this->accept($members[0], $privacy);
        $this->actAsPlatformTeam();

        $row = $this->row($this->data(), $id);
        $summary = LegalDocumentService::getComplianceSummary($id);

        $this->assertCount(2, $summary['documents']);
        foreach ($summary['documents'] as $document) {
            $mine = $this->document($row, (string) $document['document_type']);
            $this->assertSame($summary['total_users'], $mine['members_asked'], (string) $document['document_type']);
            $this->assertSame($document['users_not_accepted'], $mine['members_not_accepted'], (string) $document['document_type']);
        }
        $this->assertSame(5, $summary['total_users']);
    }

    public function test_the_totals_count_communities_without_a_privacy_notice(): void
    {
        $with = $this->community();
        $this->legal($with, 'privacy', false);
        $this->community();
        $this->actAsPlatformTeam();

        $data = $this->data();

        $this->assertSame(
            count(array_filter(array_column($data['communities'], 'no_privacy_notice'))),
            $data['totals']['no_privacy_notice']
        );
        $this->assertFalse($this->row($data, $with)['no_privacy_notice']);
    }

    public function test_a_figure_that_cannot_be_read_is_not_available_never_zero(): void
    {
        $id = $this->community();
        $this->legal($id, 'terms', false);
        $this->app->instance(LegalDocumentsService::class, new LegalDocumentsService(
            static function (): array {
                throw new \RuntimeException('members unreadable');
            },
        ));
        $this->actAsPlatformTeam();

        $data = $this->data();
        $terms = $this->document($this->row($data, $id), 'terms');

        $this->assertSame(['members'], $data['unavailable']);
        $this->assertNull($terms['members_asked']);
        $this->assertNull($terms['members_not_accepted']);
        // The documents themselves are still read.
        $this->assertTrue($terms['published']);
        $this->assertSame('2.1', $terms['version_number']);
    }

    public function test_the_community_setup_page_still_agrees_after_sharing_the_rule(): void
    {
        $id = $this->community(['created_at' => now()->addMinute()]);
        $this->legal($id, 'privacy', false);

        $result = (new CommunitySetupChecklistService(app(CommunitySetupService::class)))->overview();
        $mine = null;
        foreach ($result['communities'] as $setupRow) {
            if ((int) $setupRow['id'] === $id) {
                $mine = $setupRow;
            }
        }

        $this->assertNotNull($mine);
        $this->assertTrue($mine['privacy_notice_published']);
        $this->assertFalse($mine['terms_published']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, ['is_active' => 0])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
