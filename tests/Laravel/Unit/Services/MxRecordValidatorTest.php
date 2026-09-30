<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\MxRecordValidator;
use Illuminate\Support\Facades\Cache;
use Tests\Laravel\TestCase;

class MxRecordValidatorTest extends TestCase
{
    private MxRecordValidator $svc;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->svc = new MxRecordValidator();
    }

    public function test_malformed_email_passes_fail_open(): void
    {
        $this->assertTrue($this->svc->isResolvable('no-at-sign'));
        $this->assertTrue($this->svc->isResolvable('user@'));
    }

    public function test_reserved_documentation_domains_are_rejected(): void
    {
        foreach (['a@example.com', 'b@example.net', 'c@example.org', 'd@localhost'] as $email) {
            $this->assertFalse($this->svc->isResolvable($email), $email);
        }
    }

    public function test_reserved_tlds_are_rejected(): void
    {
        foreach (['x@foo.test', 'x@bar.invalid', 'x@baz.localhost', 'x@qux.example'] as $email) {
            $this->assertFalse($this->svc->isResolvable($email), $email);
        }
    }

    public function test_domain_with_illegal_characters_is_rejected(): void
    {
        $this->assertFalse($this->svc->isResolvable('x@not_valid!.com'));
    }

    public function test_overlong_domain_is_rejected(): void
    {
        $long = str_repeat('a', 254) . '.com';
        $this->assertFalse($this->svc->isResolvable('x@' . $long));
    }

    public function test_positive_cache_hit_short_circuits_dns(): void
    {
        Cache::put('mx:cached-good.com', true, 60);
        $this->assertTrue($this->svc->isResolvable('x@cached-good.com'));
    }

    public function test_negative_cache_hit_short_circuits_dns(): void
    {
        Cache::put('mx:cached-bad.com', false, 60);
        $this->assertFalse($this->svc->isResolvable('x@cached-bad.com'));
    }

    public function test_reserved_domain_result_is_written_to_cache(): void
    {
        // F-375: the cached value is now the three-way state rather than a
        // boolean, because "DNS did not answer" had to stop looking like
        // "this domain cannot receive mail". Pre-F-375 boolean entries are
        // still read — see test_negative_cache_hit_short_circuits_dns above.
        $this->assertFalse($this->svc->isResolvable('x@example.com'));
        $this->assertSame(MxRecordValidator::STATE_UNDELIVERABLE, Cache::get('mx:example.com'));
    }

    public function test_domain_is_lowercased_for_cache_key(): void
    {
        Cache::put('mx:mixed.com', true, 60);
        $this->assertTrue($this->svc->isResolvable('x@MIXED.com'));
    }
}
