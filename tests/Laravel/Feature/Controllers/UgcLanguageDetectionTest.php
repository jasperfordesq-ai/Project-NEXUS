<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use App\Services\Translation\ContentLanguageDetector;
use App\Services\TranslationConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner, 9 Nov 2026: "if my language is set to English and the text is
 * English, there's no need for a translate button. If … text anywhere on the
 * site is in a different language, then there should be a translate button."
 *
 * Nothing on the platform records what language a post, group or listing is
 * written in, and the words alone cannot tell for short texts ("Media Test
 * Group"). POST /v2/ugc-language asks the community's Google translation
 * engine — the one that already translates — which language each text is in,
 * once per text, and remembers the answer.
 */
class UgcLanguageDetectionTest extends TestCase
{
    use DatabaseTransactions;

    private const GOOGLE_KEY = 'platform-google-key-test';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['services.google_translate.api_key' => self::GOOGLE_KEY]);
        DB::table('ai_settings')->where('tenant_id', $this->testTenantId)->whereIn('setting_key', ['ai_enabled', 'openai_api_key'])->delete();
        AIServiceFactory::clearCache();
    }

    protected function tearDown(): void
    {
        Cache::flush();
        parent::tearDown();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /** @param list<array{0: string, 1: float}> $answers language and confidence, one per text sent */
    private function fakeGoogle(array $answers): void
    {
        Http::fake([
            'translation.googleapis.com/language/translate/v2/detect*' => Http::response(['data' => [
                'detections' => array_map(fn (array $a) => [['language' => $a[0], 'confidence' => $a[1], 'isReliable' => false]], $answers),
            ]]),
        ]);
    }

    /** @return list<string> the texts Google was sent, across every request */
    private function sentToGoogle(): array
    {
        $sent = [];
        foreach (Http::recorded() as [$request]) {
            /** @var HttpRequest $request */
            $sent = array_merge($sent, (array) ($request->data()['q'] ?? []));
        }

        return $sent;
    }

    public function test_it_says_which_language_each_text_is_in(): void
    {
        $this->member();
        $this->fakeGoogle([['en', 0.97], ['es', 1.0]]);

        $response = $this->apiPost('/v2/ugc-language', ['texts' => ['Security testing group for media uploads', 'Hola, ¿cómo estás?']]);

        $response->assertOk();
        // JSON writes 1.0 as 1, hence equals rather than same.
        $this->assertEquals([
            ['language' => 'en', 'confidence' => 0.97],
            ['language' => 'es', 'confidence' => 1.0],
        ], $response->json('data.detections'));
        Http::assertSent(fn (HttpRequest $r) => str_starts_with($r->url(), 'https://translation.googleapis.com/language/translate/v2/detect')
            && str_contains($r->url(), 'key=' . self::GOOGLE_KEY));
    }

    public function test_it_asks_google_only_once_for_the_same_text(): void
    {
        $this->member();
        $this->fakeGoogle([['en', 0.9]]);

        $this->apiPost('/v2/ugc-language', ['texts' => ['A walk in the park on Saturday']])->assertOk();
        $second = $this->apiPost('/v2/ugc-language', ['texts' => ['A walk in the park on Saturday']]);

        $second->assertOk();
        $this->assertSame('en', $second->json('data.detections.0.language'));
        Http::assertSentCount(1);
    }

    public function test_it_sends_google_only_a_short_sample_without_html_or_links(): void
    {
        $this->member();
        $this->fakeGoogle([['en', 0.99]]);

        $long = '<p>Join us at https://example.org/very/long/link for the garden day.</p> ' . str_repeat('We will plant trees together. ', 300);
        $this->apiPost('/v2/ugc-language', ['texts' => [$long]])->assertOk();

        $sent = $this->sentToGoogle();
        $this->assertCount(1, $sent);
        $this->assertLessThanOrEqual(ContentLanguageDetector::SAMPLE_LENGTH, mb_strlen($sent[0]));
        $this->assertStringNotContainsString('<p>', $sent[0]);
        $this->assertStringNotContainsString('example.org', $sent[0]);
        $this->assertStringStartsWith('Join us at for the garden day.', $sent[0]);
    }

    public function test_undetermined_and_text_without_letters_have_no_language(): void
    {
        $this->member();
        $this->fakeGoogle([['und', 0.1]]);

        $response = $this->apiPost('/v2/ugc-language', ['texts' => ['zzkq vrr', '12:30 👍', 42]]);

        $response->assertOk();
        $this->assertSame([null, null, null], $response->json('data.detections'));
        $this->assertSame(['zzkq vrr'], $this->sentToGoogle());
    }

    public function test_nothing_is_sent_when_the_community_has_switched_translation_off(): void
    {
        $this->member();
        $this->fakeGoogle([['en', 0.9]]);
        TranslationConfigurationService::set(TranslationConfigurationService::CONFIG_ENABLED, false);

        $response = $this->apiPost('/v2/ugc-language', ['texts' => ['A walk in the park on Saturday']]);

        $response->assertOk();
        $this->assertSame([null], $response->json('data.detections'));
        Http::assertNothingSent();
    }

    public function test_nothing_is_sent_when_no_google_engine_is_set_up(): void
    {
        $this->member();
        config(['services.google_translate.api_key' => null]);
        $this->fakeGoogle([['en', 0.9]]);

        $response = $this->apiPost('/v2/ugc-language', ['texts' => ['A walk in the park on Saturday']]);

        $response->assertOk();
        $this->assertSame([null], $response->json('data.detections'));
        Http::assertNothingSent();
    }

    public function test_a_google_failure_is_not_remembered(): void
    {
        $this->member();
        Http::fakeSequence('translation.googleapis.com/*')
            ->push(['error' => ['message' => 'quota']], 403)
            ->push(['data' => ['detections' => [[['language' => 'fr', 'confidence' => 0.95]]]]]);

        $first = $this->apiPost('/v2/ugc-language', ['texts' => ['Bonjour à tous les voisins']]);
        $second = $this->apiPost('/v2/ugc-language', ['texts' => ['Bonjour à tous les voisins']]);

        $this->assertSame([null], $first->json('data.detections'));
        $this->assertSame('fr', $second->json('data.detections.0.language'));
    }

    public function test_each_member_has_an_hourly_allowance_of_new_text(): void
    {
        $this->member();
        $this->fakeGoogle(array_fill(0, 50, ['en', 0.9]));

        // Keep sending new, distinct text until a whole round comes back "not
        // known": the allowance is used up.
        $answeredRounds = 0;
        for ($round = 0; $round < 10; $round++) {
            $texts = array_map(fn (int $i) => "Round {$round} text {$i} " . str_repeat('about our garden ', 40), range(1, 50));
            $detections = $this->apiPost('/v2/ugc-language', ['texts' => $texts])->assertOk()->json('data.detections');
            if ($detections === array_fill(0, 50, null)) {
                break;
            }
            $answeredRounds++;
        }
        $this->assertGreaterThan(0, $answeredRounds);
        $this->assertLessThanOrEqual(ContentLanguageDetector::HOURLY_CHARACTERS_PER_MEMBER, array_sum(array_map('mb_strlen', $this->sentToGoogle())));

        // Over the allowance, nothing new goes to Google and the answer is "not
        // known" (the button then stays, as before). Remembered answers still come back.
        $last = $this->apiPost('/v2/ugc-language', ['texts' => [str_repeat('Something new about the allotments this week. ', 40)]]);
        $this->assertSame([null], $last->json('data.detections'));
        $this->assertCount($answeredRounds * 50, $this->sentToGoogle());

        $remembered = $this->apiPost('/v2/ugc-language', ['texts' => ['Round 0 text 1 ' . str_repeat('about our garden ', 40)]]);
        $this->assertSame('en', $remembered->json('data.detections.0.language'));
    }

    public function test_at_most_fifty_texts_at_a_time(): void
    {
        $this->member();
        $this->fakeGoogle([]);

        $this->apiPost('/v2/ugc-language', ['texts' => array_fill(0, 51, 'Hello there neighbours')])->assertStatus(422);
        $this->apiPost('/v2/ugc-language', ['texts' => 'Hello there neighbours'])->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_it_needs_a_signed_in_member(): void
    {
        $this->fakeGoogle([['en', 0.9]]);

        $this->apiPost('/v2/ugc-language', ['texts' => ['Hello there neighbours']])->assertStatus(401);
        Http::assertNothingSent();
    }
}
