<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\Support\AuthReturnPath;
use PHPUnit\Framework\TestCase;

/** Mirrors react-frontend/src/lib/safe-auth-return-path.test.ts. */
class AuthReturnPathTest extends TestCase
{
    /** @return array<string, array{0: mixed}> */
    public static function unsafe(): array
    {
        return [
            'another host' => ['https://evil.test/x'],
            'protocol-relative' => ['//evil.test'],
            'backslash' => ['/\\evil.test'],
            'encoded backslash' => ['/%5cevil.test'],
            'encoded slash' => ['/%2fevil.test'],
            'double-encoded' => ['/%255cevil.test'],
            'newline' => ["/\nevil.test"],
            'space' => ['/a b'],
            'javascript' => ['javascript:alert(1)'],
            'relative' => ['groups/7'],
            'empty' => [''],
            'not a string' => [['/groups/7']],
            'null' => [null],
            'too long' => ['/' . str_repeat('a', 600)],
        ];
    }

    /** @dataProvider unsafe */
    public function test_rejects_anything_but_a_local_path(mixed $value): void
    {
        $this->assertNull(AuthReturnPath::safe($value));
    }

    public function test_keeps_a_local_path_with_query_and_fragment(): void
    {
        $this->assertSame(
            '/hour-timebank/events/9?q=hello%20world#details',
            AuthReturnPath::safe('/hour-timebank/events/9?q=hello%20world#details'),
        );
    }
}
