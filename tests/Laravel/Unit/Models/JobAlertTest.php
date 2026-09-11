<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\Concerns\HasTenantScope;
use App\Models\JobAlert;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Tests\Laravel\TestCase;

class JobAlertTest extends TestCase
{
    private JobAlert $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new JobAlert();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('job_alerts', $this->model->getTable());
    }

    public function test_timestamps_disabled(): void
    {
        $this->assertFalse($this->model->usesTimestamps());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $expected = [
            'tenant_id', 'user_id',
            // Creation idempotency (2026-09-11): a retried alert creation must
            // return the original row instead of a duplicate.
            'creation_idempotency_key_hash', 'creation_request_hash',
            'keywords', 'categories', 'type',
            'commitment', 'location', 'is_remote_only', 'is_active',
            'last_notified_at', 'created_at',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('integer', $casts['user_id']);
        $this->assertEquals('boolean', $casts['is_remote_only']);
        $this->assertEquals('boolean', $casts['is_active']);
        $this->assertEquals('datetime', $casts['last_notified_at']);
        $this->assertEquals('datetime', $casts['created_at']);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(JobAlert::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_user_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->user());
    }
}
