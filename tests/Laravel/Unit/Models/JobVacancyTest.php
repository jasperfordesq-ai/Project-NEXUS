<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\Concerns\HasTenantScope;
use App\Models\JobVacancy;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Tests\Laravel\TestCase;

class JobVacancyTest extends TestCase
{
    private JobVacancy $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new JobVacancy();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('job_vacancies', $this->model->getTable());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $expected = [
            'tenant_id', 'user_id',
            // Creation idempotency (2026-09-11): a retried job creation returns the original vacancy.
            'creation_idempotency_key_hash', 'creation_request_hash',
            'organization_id', 'title', 'description',
            'tagline', 'video_url', 'culture_photos', 'company_size', 'benefits',
            'location', 'latitude', 'longitude', 'is_remote', 'type', 'commitment', 'category',
            'skills_required', 'hours_per_week', 'time_credits', 'contact_email',
            'contact_phone', 'deadline', 'status', 'salary_min', 'salary_max',
            'salary_type', 'salary_currency', 'salary_negotiable', 'is_featured',
            'featured_until', 'expired_at', 'renewed_at', 'renewal_count',
            'views_count', 'applications_count', 'moderation_status', 'moderation_notes',
            'moderated_by', 'moderated_at', 'spam_score', 'spam_flags',
            'blind_hiring',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('integer', $casts['tenant_id']);
        $this->assertEquals('integer', $casts['user_id']);
        $this->assertEquals('integer', $casts['organization_id']);
        $this->assertEquals('float', $casts['latitude']);
        $this->assertEquals('float', $casts['longitude']);
        $this->assertEquals('boolean', $casts['is_remote']);
        $this->assertEquals('float', $casts['hours_per_week']);
        $this->assertEquals('float', $casts['time_credits']);
        $this->assertEquals('array', $casts['culture_photos']);
        $this->assertEquals('array', $casts['benefits']);
        $this->assertEquals('float', $casts['salary_min']);
        $this->assertEquals('float', $casts['salary_max']);
        $this->assertEquals('boolean', $casts['salary_negotiable']);
        $this->assertEquals('boolean', $casts['is_featured']);
        $this->assertEquals('datetime', $casts['featured_until']);
        $this->assertEquals('datetime', $casts['expired_at']);
        $this->assertEquals('datetime', $casts['renewed_at']);
        $this->assertEquals('integer', $casts['renewal_count']);
        $this->assertEquals('integer', $casts['views_count']);
        $this->assertEquals('integer', $casts['applications_count']);
        $this->assertEquals('datetime', $casts['deadline']);
        $this->assertEquals('boolean', $casts['blind_hiring']);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(JobVacancy::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_creator_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->creator());
    }

    public function test_applications_relationship(): void
    {
        $this->assertInstanceOf(HasMany::class, $this->model->applications());
    }
}
