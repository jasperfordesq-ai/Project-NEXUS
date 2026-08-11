<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\TurnstileService;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

class TurnstileServiceTest extends TestCase
{
    private TurnstileService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        $this->svc = new TurnstileService();
        $this->clearSecret();
    }

    protected function tearDown(): void
    {
        $this->clearSecret();
        parent::tearDown();
    }

    // 🔴 These set CONFIG, not the environment. They used to use putenv(), so the
    // suite exercised env() — the exact mechanism that stops working once the
    // deploy runs "artisan optimize". Every test here passed while the production
    // bot check was disabled, because they tested the broken path.
    private function clearSecret(): void
    {
        config(['turnstile.secret' => '']);
    }

    private function setSecret(string $value): void
    {
        config(['turnstile.secret' => $value]);
    }

    public function test_it_reads_the_secret_from_config_and_never_from_the_environment(): void
    {
        // 🔴 THE regression test. The deploy runs "artisan optimize", after which
        // Laravel no longer loads .env and env() returns its default. Reading the
        // secret with env() therefore yielded an empty string in production, and an
        // empty secret makes verify() return true — so the check passed everything.
        //
        // Here the environment says one thing and config says another. If the
        // service ever reads the environment again, it will see the test-pass key
        // and skip verification, and this test fails.
        putenv('TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA');
        $_ENV['TURNSTILE_SECRET_KEY'] = '1x0000000000000000000000000000000AA';
        config(['turnstile.secret' => 'a-real-looking-secret']);

        Http::fake([
            '*' => Http::response(['success' => true], 200),
        ]);

        $this->assertTrue($this->svc->verify('a-token'));

        // Verification actually happened — it did not take the skip path.
        Http::assertSentCount(1);

        putenv('TURNSTILE_SECRET_KEY');
        unset($_ENV['TURNSTILE_SECRET_KEY']);
    }

    public function test_the_config_default_comes_from_the_documented_env_var(): void
    {
        // config/turnstile.php is the only place allowed to call env(), so that the
        // value survives config caching. This pins that wiring.
        $source = (string) file_get_contents(base_path('config/turnstile.php'));

        $this->assertStringContainsString("env('TURNSTILE_SECRET_KEY'", $source);

        // 🔴 Comments are stripped before checking. The first version of this
        // assertion searched the raw file and matched the explanatory comment that
        // says "never env()" — so a test written to catch the bug was tripped by the
        // note describing it. Any text-matching guard over source has to look at
        // code only.
        $service = (string) file_get_contents(app_path('Services/TurnstileService.php'));
        $code = (string) preg_replace(
            ['/\/\*[\s\S]*?\*\//', '/\/\/.*$/m'],
            '',
            $service
        );

        $this->assertStringNotContainsString(
            'env(',
            $code,
            'TurnstileService must not call env() — the deploy caches config, after which env() returns its default.'
        );
    }

    public function test_skips_verification_when_secret_unset(): void
    {
        Http::fake();
        $this->assertTrue($this->svc->verify('any-token'));
        Http::assertNothingSent();
    }

    public function test_skips_verification_with_test_pass_key(): void
    {
        $this->setSecret('1x0000000000000000000000000000000AA');
        Http::fake();
        $this->assertTrue($this->svc->verify('token'));
        Http::assertNothingSent();
    }

    public function test_missing_token_with_real_secret_is_rejected(): void
    {
        $this->setSecret('real-secret-key');
        Http::fake();
        $this->assertFalse($this->svc->verify(null));
        $this->assertFalse($this->svc->verify('   '));
        Http::assertNothingSent();
    }

    public function test_cloudflare_success_passes(): void
    {
        $this->setSecret('real-secret-key');
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => true], 200)]);
        $this->assertTrue($this->svc->verify('good-token'));
    }

    public function test_cloudflare_failure_is_rejected(): void
    {
        $this->setSecret('real-secret-key');
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => false, 'error-codes' => ['invalid-input-response']], 200)]);
        $this->assertFalse($this->svc->verify('bad-token'));
    }

    public function test_http_error_is_rejected(): void
    {
        $this->setSecret('real-secret-key');
        Http::fake(['challenges.cloudflare.com/*' => Http::response('', 500)]);
        $this->assertFalse($this->svc->verify('token'));
    }

    public function test_posts_secret_token_and_remoteip(): void
    {
        $this->setSecret('real-secret-key');
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => true], 200)]);

        $this->svc->verify('my-token', '203.0.113.5');

        Http::assertSent(function ($req) {
            $d = $req->data();
            return ($d['secret'] ?? null) === 'real-secret-key'
                && ($d['response'] ?? null) === 'my-token'
                && ($d['remoteip'] ?? null) === '203.0.113.5';
        });
    }
}
