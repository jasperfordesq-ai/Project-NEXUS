<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for HelpController — FAQs and feedback.
 */
class HelpControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/help/faqs
    // ------------------------------------------------------------------

    public function test_get_faqs_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/help/faqs');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /help/feedback
    // ------------------------------------------------------------------

    public function test_feedback_requires_auth(): void
    {
        $response = $this->apiPost('/help/feedback', [
            'message' => 'Great platform!',
            'rating' => 5,
        ]);

        $response->assertStatus(401);
    }

    public function test_feedback_accepts_submission(): void
    {
        $this->authenticatedUser();

        // The feedback endpoint records helpfulness against a help article,
        // keyed by article_slug. Seed a public article for the test tenant.
        $slug = 'test-help-article-' . uniqid();
        DB::table('help_articles')->insert([
            'tenant_id'  => $this->testTenantId,
            'title'      => 'Test Help Article',
            'slug'       => $slug,
            'content'    => 'Body',
            'module_tag' => 'core',
            'is_public'  => 1,
            'created_at' => now(),
        ]);

        $response = $this->apiPost('/help/feedback', [
            'article_slug' => $slug,
            'helpful'      => true,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    /**
     * O-087 (E-063): the insert omitted tenant_id, so every community's
     * feedback was filed under tenant 1 by the column default; once that
     * default became a refusal the endpoint's catch would have answered
     * "feedback recorded" while storing nothing. Assert the row itself.
     */
    public function test_feedback_is_stored_under_the_article_community(): void
    {
        $user = $this->authenticatedUser();

        $slug = 'test-help-article-' . uniqid();
        $articleId = DB::table('help_articles')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'title'      => 'Test Help Article',
            'slug'       => $slug,
            'content'    => 'Body',
            'module_tag' => 'core',
            'is_public'  => 1,
            'created_at' => now(),
        ]);

        $this->apiPost('/help/feedback', ['article_slug' => $slug, 'helpful' => false])->assertStatus(200);

        $row = DB::table('help_article_feedback')
            ->where('article_id', $articleId)
            ->where('user_id', $user->id)
            ->first();

        $this->assertNotNull($row, 'feedback was answered as recorded but not stored');
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame(0, (int) $row->helpful);
    }
}
