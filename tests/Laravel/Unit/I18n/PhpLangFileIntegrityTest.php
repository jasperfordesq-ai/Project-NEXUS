<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\I18n;

use PHPUnit\Framework\TestCase;

/**
 * Two mistakes PHP accepts silently in `lang/<locale>/*.php`, both found in
 * `lang/en/safeguarding.php` on 26 Oct 2026 by a dry run of the member
 * safeguarding emails:
 *
 * 1. An escape such as `\x27` inside a single-quoted string is NOT an escape:
 *    members saw "tutoring a member\x27s child" on the settings page, and the
 *    emails would have quoted it.
 * 2. A key repeated inside one array literal makes the second silently replace
 *    the first: Scotland's `works_with_vulnerable_adults` lost its description.
 *
 * Neither is visible to the key-set parity gate, which only sees the array
 * after PHP has already collapsed the duplicate.
 */
final class PhpLangFileIntegrityTest extends TestCase
{
    public function test_no_single_quoted_string_carries_a_literal_escape_sequence(): void
    {
        $offenders = [];
        foreach ($this->langFiles() as $file) {
            foreach (token_get_all((string) file_get_contents($file)) as $token) {
                if (is_array($token)
                    && $token[0] === T_CONSTANT_ENCAPSED_STRING
                    && str_starts_with($token[1], "'")
                    && preg_match('/\\\\(x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\}|[nrt])/', $token[1]) === 1) {
                    $offenders[] = $this->relative($file) . ':' . $token[2];
                }
            }
        }

        $this->assertSame([], $offenders, 'Single-quoted strings print \\x27, \\n etc. literally; write the character itself');
    }

    public function test_no_array_literal_repeats_a_key(): void
    {
        $offenders = [];
        foreach ($this->langFiles() as $file) {
            $tokens = array_values(array_filter(
                token_get_all((string) file_get_contents($file)),
                static fn ($t): bool => ! is_array($t) || ! in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
            ));
            /** @var list<array<string, true>> $stack keys seen in each open array literal */
            $stack = [];
            foreach ($tokens as $i => $token) {
                if ($token === '[') {
                    $stack[] = [];
                } elseif ($token === ']') {
                    array_pop($stack);
                } elseif (is_array($token)
                    && $token[0] === T_CONSTANT_ENCAPSED_STRING
                    && is_array($tokens[$i + 1] ?? null)
                    && $tokens[$i + 1][0] === T_DOUBLE_ARROW
                    && $stack !== []) {
                    $depth = count($stack) - 1;
                    if (isset($stack[$depth][$token[1]])) {
                        $offenders[] = $this->relative($file) . ':' . $token[2] . ' ' . $token[1];
                    }
                    $stack[$depth][$token[1]] = true;
                }
            }
        }

        $this->assertSame([], $offenders, 'A repeated key silently replaces the earlier entry; merge them');
    }

    /** @return list<string> */
    private function langFiles(): array
    {
        $files = glob(dirname(__DIR__, 4) . '/lang/*/*.php') ?: [];
        $this->assertNotSame([], $files, 'No language files found');

        return $files;
    }

    private function relative(string $file): string
    {
        return substr($file, strlen(dirname(__DIR__, 4)) + 1);
    }
}
