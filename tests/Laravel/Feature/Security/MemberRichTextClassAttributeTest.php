<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Helpers\HtmlSanitizer;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-075 (E-027) — the member rich-text sanitiser kept `class` on every
 * element, so a post, comment or group discussion could use the app's own
 * Tailwind classes to draw a full-screen fake "session expired, sign in
 * again" panel over the real page. Member content has no legitimate use for
 * the app's classes; admin-authored legal documents and FAQ answers keep them
 * through an explicit opt-in.
 */
class MemberRichTextClassAttributeTest extends TestCase
{
    use DatabaseTransactions;

    private const OVERLAY = '<div class="fixed inset-0 z-[9999] bg-white" id="login-overlay" style="position:fixed">'
        . '<p class="text-2xl">Your session expired. <a class="btn" href="https://evil.example/login">Sign in again</a></p></div>';

    public function test_member_sanitiser_drops_class_id_and_style(): void
    {
        $clean = HtmlSanitizer::sanitize(self::OVERLAY);

        $this->assertStringNotContainsString('class=', $clean);
        $this->assertStringNotContainsString('id=', $clean);
        $this->assertStringNotContainsString('style=', $clean);
        $this->assertStringContainsString('Your session expired.', $clean, 'The text itself is kept.');
        $this->assertStringContainsString('href="https://evil.example/login"', $clean, 'Safe links are kept.');
    }

    public function test_member_sanitiser_still_keeps_ordinary_formatting(): void
    {
        $clean = HtmlSanitizer::sanitize('<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>');

        $this->assertSame('<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>', $clean);
    }

    public function test_feed_post_is_stored_without_class_attributes(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost('/v2/feed/posts', ['content' => self::OVERLAY, 'visibility' => 'public']);
        $response->assertStatus(201);

        $stored = (string) DB::table('feed_posts')->where('id', (int) $response->json('data.id'))->value('content');
        $this->assertStringContainsString('Your session expired.', $stored);
        $this->assertStringNotContainsString('class=', $stored);
        $this->assertStringNotContainsString('fixed inset-0', $stored);
    }

    public function test_admin_content_can_opt_in_to_keep_class(): void
    {
        $clean = HtmlSanitizer::sanitize('<p class="legal-note">Clause</p>', false, true);

        $this->assertStringContainsString('class="legal-note"', $clean);
    }
}
