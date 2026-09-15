<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\Concerns\HasTenantScope;
use App\Models\Notification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Tests\Laravel\TestCase;

class NotificationTest extends TestCase
{
    private Notification $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new Notification();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('notifications', $this->model->getTable());
    }

    public function test_timestamps_disabled(): void
    {
        $this->assertFalse($this->model->usesTimestamps());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $expected = [
            'tenant_id', 'user_id', 'type', 'message',
            'link', 'idempotency_key', 'is_read', 'created_at',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('boolean', $casts['is_read']);
        $this->assertEquals('datetime', $casts['created_at']);
        $this->assertEquals('datetime', $casts['deleted_at']);
    }

    public function test_appends_contains_expected_attributes(): void
    {
        $appends = $this->model->getAppends();
        $this->assertContains('read_at', $appends);
        $this->assertContains('body', $appends);
        $this->assertContains('title', $appends);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(Notification::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_uses_soft_deletes(): void
    {
        $traits = class_uses_recursive(Notification::class);
        $this->assertContains(SoftDeletes::class, $traits);
    }

    public function test_user_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->user());
    }

    public function test_scope_unread(): void
    {
        $builder = Notification::query()->unread();
        $this->assertInstanceOf(Builder::class, $builder);
    }

    public function test_scope_of_type(): void
    {
        $builder = Notification::query()->ofType('info');
        $this->assertInstanceOf(Builder::class, $builder);
    }

    public function test_read_at_accessor_returns_null_when_unread(): void
    {
        $this->model->is_read = false;
        $this->assertNull($this->model->read_at);
    }

    public function test_body_accessor_returns_message(): void
    {
        $this->model->setAttribute('message', 'Test message');
        $this->assertEquals('Test message', $this->model->body);
    }

    public function test_title_accessor_derives_from_type(): void
    {
        $this->model->setAttribute('type', 'new_message');
        $this->assertEquals('New message', $this->model->title);
    }
}
