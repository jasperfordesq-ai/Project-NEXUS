<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\UgcTranslationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class UgcTranslationCacheOnlyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_cache_misses_do_not_invoke_translation(): void
    {
        $this->assertCacheRead(null);
    }

    public function test_cache_hits_are_returned_without_provider_calls(): void
    {
        $this->assertCacheRead(['translated_text' => 'Hola', 'source_locale' => 'auto', 'target_locale' => 'es', 'cached' => true]);
    }

    private function assertCacheRead(?array $cached): void
    {
        Http::fake();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]), ['*']);
        $service = Mockery::mock(UgcTranslationService::class);
        $service->shouldReceive('getCached')->once()->with('Hello', null, 'es')->andReturn($cached);
        $service->shouldNotReceive('translate');
        $this->app->instance(UgcTranslationService::class, $service);
        $this->apiPost('/v2/ugc-translate', [
            'content_type' => 'post', 'content_id' => 1, 'source_text' => 'Hello',
            'target_locale' => 'es', 'cache_only' => true,
        ])->assertOk()->assertJsonPath('data', $cached);
        Http::assertNothingSent();
    }
}
