<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Personalisation;

use App\Services\UgcTranslationService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * AG38 — UGC translation service + endpoint tests.
 *
 * Asserts the cache contract: identical (text, source, target) tuples hit the
 * cache on the second request and never re-call the translation engine.
 * Google Translate is the default engine (owner, 30 Oct 2026), so the upstream
 * call faked here is Google's.
 */
class UgcTranslationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // A platform Google key, so the default engine is available.
        config(['services.google_translate.api_key' => 'test-google-key']);
    }

    public function test_service_caches_result_and_only_calls_the_engine_once(): void
    {
        Http::fake([
            'translation.googleapis.com/*' => Http::response([
                'data' => [
                    'translations' => [['translatedText' => 'Bonjour le monde']],
                ],
            ], 200),
        ]);

        $svc = new UgcTranslationService();

        $r1 = $svc->translate('feed_post', 1, 'Hello world', 'en', 'fr');
        $r2 = $svc->translate('feed_post', 1, 'Hello world', 'en', 'fr');

        $this->assertSame('Bonjour le monde', $r1['translated_text']);
        $this->assertFalse($r1['cached']);
        $this->assertSame('Bonjour le monde', $r2['translated_text']);
        $this->assertTrue($r2['cached']);

        // Exactly ONE upstream HTTP call should have been made.
        Http::assertSentCount(1);
    }

    public function test_get_cached_returns_null_when_no_cache_entry(): void
    {
        $svc = new UgcTranslationService();
        $this->assertNull($svc->getCached('Some untranslated text', 'en', 'de'));
    }

    public function test_same_source_and_target_locale_short_circuits(): void
    {
        Http::fake();
        $svc = new UgcTranslationService();
        $r = $svc->translate('feed_post', 1, 'Already English', 'en', 'en');
        $this->assertSame('Already English', $r['translated_text']);
        $this->assertFalse($r['cached']);
        Http::assertNothingSent();
    }

    /**
     * Owner, 30 Oct 2026 (AWID): a Spanish post in an English-default community
     * came back untranslated. Posts carry no language, so the community default
     * ("en") was taken as the source, matched the reader's "en", and the original
     * was returned. With no stated source, Google must detect it.
     */
    public function test_unstated_source_is_detected_not_assumed_to_be_the_community_default(): void
    {
        $tenantId = \App\Core\TenantContext::getId();
        $original = \Illuminate\Support\Facades\DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = json_decode((string) $original, true) ?: [];
        $config['default_language'] = 'en';
        \Illuminate\Support\Facades\DB::table('tenants')->where('id', $tenantId)
            ->update(['configuration' => json_encode($config)]);

        Http::fake([
            'translation.googleapis.com/*' => Http::response([
                'data' => ['translations' => [['translatedText' => 'help with gardening']]],
            ], 200),
        ]);

        try {
            $r = (new UgcTranslationService())->translate('feed_post', 1, 'ayuda con jardinería', null, 'en');
        } finally {
            \Illuminate\Support\Facades\DB::table('tenants')->where('id', $tenantId)
                ->update(['configuration' => $original]);
        }

        $this->assertSame('help with gardening', $r['translated_text']);
        Http::assertSent(fn ($request) => !array_key_exists('source', $request->data()));
    }
}
