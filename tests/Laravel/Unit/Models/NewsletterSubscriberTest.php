<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Core\TenantContext;
use App\Models\Concerns\HasTenantScope;
use App\Models\NewsletterSubscriber;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class NewsletterSubscriberTest extends TestCase
{
    use DatabaseTransactions;

    private NewsletterSubscriber $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new NewsletterSubscriber();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('newsletter_subscribers', $this->model->getTable());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $expected = [
            'tenant_id', 'email', 'first_name', 'last_name', 'user_id',
            'source', 'status', 'confirmation_token', 'unsubscribe_token',
            'confirmed_at', 'unsubscribed_at', 'unsubscribe_reason', 'is_active',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('integer', $casts['user_id']);
        $this->assertEquals('datetime', $casts['confirmed_at']);
        $this->assertEquals('datetime', $casts['unsubscribed_at']);
        $this->assertEquals('boolean', $casts['is_active']);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(NewsletterSubscriber::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_user_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->user());
    }

    public function test_member_sync_requires_newsletter_opt_in(): void
    {
        $this->withTenant(999);

        $optedIn = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'newsletter-opt-in@example.test',
            'newsletter_opt_in' => 1,
            'status' => 'active',
            'is_approved' => 1,
        ]);

        $optedOut = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'newsletter-opt-out@example.test',
            'newsletter_opt_in' => 0,
            'status' => 'active',
            'is_approved' => 1,
        ]);

        // User::factory()->create() fires UserObserver::created(), whose indexing
        // path resets TenantContext to tenant 1. Re-pin the test tenant before the
        // tenant-scoped sync read so it queries tenant 999 (where the users live).
        TenantContext::setById($this->testTenantId);

        $result = NewsletterSubscriber::syncMembersWithStats();

        $this->assertSame(1, $result['synced']);
        $this->assertDatabaseHas('newsletter_subscribers', [
            'tenant_id' => $this->testTenantId,
            'email' => $optedIn->email,
            'status' => 'active',
            'source' => 'member_sync',
        ]);
        $this->assertDatabaseMissing('newsletter_subscribers', [
            'tenant_id' => $this->testTenantId,
            'email' => $optedOut->email,
        ]);
    }
}
