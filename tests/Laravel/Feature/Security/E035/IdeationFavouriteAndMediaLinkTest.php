<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\IdeaMediaService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-187 residue — favouriting a draft (unpublished) ideation challenge
 * used to answer 200 with a count, confirming the draft exists. It must answer
 * exactly as for a challenge that does not exist, using the same visibility
 * rule as the challenge list.
 *
 * E-035 F-207 (server half) — idea media links are rendered as `href`s by both
 * frontends, so only http(s) links may be stored.
 */
class IdeationFavouriteAndMediaLinkTest extends TestCase
{
    use DatabaseTransactions;

    private User $member;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        if (!TenantContext::hasFeature('ideation_challenges')) {
            $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
            $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
            $features['ideation_challenges'] = true;
            DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
            TenantContext::setById($this->testTenantId);
        }

        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        $this->admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_member_cannot_favourite_a_draft_challenge_and_gets_the_not_found_answer(): void
    {
        $draftId = $this->challenge('draft');
        $missingId = $draftId + 100000;

        Sanctum::actingAs($this->member, ['*']);
        $draft = $this->apiPost("/v2/ideation-challenges/{$draftId}/favorite");
        $missing = $this->apiPost("/v2/ideation-challenges/{$missingId}/favorite");

        $this->assertSame($missing->status(), $draft->status(), (string) $draft->getContent());
        $this->assertSame(404, $draft->status());
        $this->assertSame(0, DB::table('challenge_favorites')->where('challenge_id', $draftId)->count());
        $this->assertSame(0, (int) DB::table('ideation_challenges')->where('id', $draftId)->value('favorites_count'));
    }

    public function test_member_can_still_favourite_an_open_challenge_and_admin_a_draft(): void
    {
        $openId = $this->challenge('open');
        Sanctum::actingAs($this->member, ['*']);
        $this->apiPost("/v2/ideation-challenges/{$openId}/favorite")
            ->assertStatus(200)
            ->assertJsonPath('data.favorited', true);

        $draftId = $this->challenge('draft');
        Sanctum::actingAs($this->admin, ['*']);
        $this->apiPost("/v2/ideation-challenges/{$draftId}/favorite")
            ->assertStatus(200)
            ->assertJsonPath('data.favorited', true);
    }

    public function test_idea_media_accepts_only_http_and_https_links(): void
    {
        $challengeId = $this->challenge('open');
        $ideaId = (int) DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $this->member->id,
            'title' => 'E035 idea',
            'description' => 'Idea used by the media link test.',
            'status' => 'submitted',
            'created_at' => now(),
        ]);
        $service = app(IdeaMediaService::class);

        foreach ([
            'javascript:alert(document.domain)',
            'JavaScript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            'vbscript:msgbox(1)',
            '//evil.example/x',
            'not a url',
        ] as $url) {
            $this->assertNull($service->addMedia($ideaId, $this->member->id, ['url' => $url, 'media_type' => 'link']), $url);
            $this->assertSame('url', $service->getErrors()[0]['field'] ?? null, $url);
        }
        $this->assertSame(0, DB::table('idea_media')->where('idea_id', $ideaId)->count());

        $this->assertNotNull($service->addMedia($ideaId, $this->member->id, ['url' => 'https://example.org/plan.pdf', 'media_type' => 'document']));
        $this->assertNotNull($service->addMedia($ideaId, $this->member->id, ['url' => 'http://example.org/photo.jpg', 'media_type' => 'image']));
        $this->assertSame(2, DB::table('idea_media')->where('idea_id', $ideaId)->count());
    }

    private function challenge(string $status): int
    {
        return (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->admin->id,
            'title' => 'E035 favourite fixture ' . $status . ' ' . uniqid(),
            'description' => 'E035 fixture challenge.',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
