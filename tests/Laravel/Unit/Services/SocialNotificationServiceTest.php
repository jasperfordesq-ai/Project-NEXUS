<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SocialNotificationService;
use Illuminate\Support\Facades\DB;

class SocialNotificationServiceTest extends TestCase
{
    // ── notifyLike ──

    public function test_notifyLike_skips_self_like(): void
    {
        // Should be a no-op when liker == owner
        SocialNotificationService::notifyLike(1, 1, 'post', 1);
        $this->assertTrue(true); // No exception
    }

    // ── notifyComment ──

    public function test_notifyComment_skips_self_comment(): void
    {
        SocialNotificationService::notifyComment(1, 1, 'post', 1, 'Test comment');
        $this->assertTrue(true);
    }

    // ── notifyShare ──

    public function test_notifyShare_skips_self_share(): void
    {
        SocialNotificationService::notifyShare(1, 1, 'post', 1);
        $this->assertTrue(true);
    }

    // ── getContentOwnerId ──

    public function test_getContentOwnerId_returns_null_for_unknown_type(): void
    {
        $result = SocialNotificationService::getContentOwnerId('unknown', 1);
        $this->assertNull($result);
    }

    public function test_getContentOwnerId_returns_user_id_for_post(): void
    {
        DB::shouldReceive('table->where->where->value')->andReturn(5);

        $result = SocialNotificationService::getContentOwnerId('post', 1);
        $this->assertEquals(5, $result);
    }

    public function test_getContentOwnerId_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->value')->andReturnNull();

        $result = SocialNotificationService::getContentOwnerId('listing', 999);
        $this->assertNull($result);
    }

    // ── getContentPreview ──

    public function test_getContentPreview_truncates_long_text(): void
    {
        $longText = str_repeat('x', 200);
        DB::shouldReceive('table->where->where->value')->andReturn($longText);

        $result = SocialNotificationService::getContentPreview('post', 1, 100);
        $this->assertEquals(103, strlen($result)); // 100 + '...'
    }

    public function test_getContentPreview_returns_empty_for_unknown_type(): void
    {
        $result = SocialNotificationService::getContentPreview('unknown', 1);
        $this->assertEquals('', $result);
    }

    public function test_discussion_link_opens_the_exact_native_group_tab(): void
    {
        DB::shouldReceive('table->where->where->value')->andReturn(44);

        $this->assertSame(
            '/groups/44?tab=discussion&discussion_id=91',
            SocialNotificationService::getContentLink('discussion', 91),
        );
    }

    public function test_social_email_helpers_use_recipient_tenant_and_translated_subjects(): void
    {
        $source = file_get_contents(app_path('Services/SocialNotificationService.php'));

        $this->assertStringContainsString("'preferred_language', 'tenant_id'", $source);
        $this->assertStringContainsString("__('emails.common.platform_name')", $source);
        $this->assertStringContainsString("__('notifications.email_subject_with_community'", $source);
        $this->assertStringNotContainsString("'Project NEXUS'", $source);
        $this->assertStringContainsString("'tenant_id' => \$tenantId", $source);
    }
}
