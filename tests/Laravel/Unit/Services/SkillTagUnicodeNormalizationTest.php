<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\ChallengeTagService;
use App\Services\ListingSkillTagService;
use App\Services\SkillTaxonomyService;
use Tests\Laravel\TestCase;

/**
 * Regression: AWID pilot (Oct 2026) — skill tags and slugs deleted every
 * non-ASCII letter, so "cercanía" was saved as "cercana".
 */
class SkillTagUnicodeNormalizationTest extends TestCase
{
    private function callPrivate(object $obj, string $method, string $arg): string
    {
        $ref = new \ReflectionMethod($obj, $method);
        $ref->setAccessible(true);
        return $ref->invoke($obj, $arg);
    }

    /** @return array<string, array{string, string}> */
    public static function accentedTags(): array
    {
        return [
            'idiomáticos'  => ['idiomáticos', 'idiomáticos'],
            'cercanía'     => ['Cercanía', 'cercanía'],
            'lingüísticos' => ['LINGÜÍSTICOS', 'lingüísticos'],
            'niño'         => ['  niño  ', 'niño'],
            'arabic'       => ['ترجمة', 'ترجمة'],
        ];
    }

    /** @dataProvider accentedTags */
    public function test_listing_skill_tag_keeps_non_ascii_letters(string $input, string $expected): void
    {
        $this->assertSame($expected, $this->callPrivate(new ListingSkillTagService(), 'normalizeTag', $input));
    }

    public function test_listing_skill_tag_still_strips_punctuation_and_caps_at_100_chars(): void
    {
        $service = new ListingSkillTagService();
        $this->assertSame('cocina vegana', $this->callPrivate($service, 'normalizeTag', 'Cocina!!  vegana?'));

        $long = $this->callPrivate($service, 'normalizeTag', str_repeat('í', 150));
        $this->assertSame(100, mb_strlen($long));
        $this->assertTrue(mb_check_encoding($long, 'UTF-8'));
    }

    public function test_skill_taxonomy_slug_transliterates_instead_of_deleting_letters(): void
    {
        $this->assertSame('cercania-linguistica', $this->callPrivate(new SkillTaxonomyService(), 'generateSlug', 'Cercanía Lingüística'));
    }

    public function test_challenge_tag_slug_transliterates_instead_of_deleting_letters(): void
    {
        $this->assertSame('nino-idiomatico', $this->callPrivate(new ChallengeTagService(), 'generateSlug', 'Niño Idiomático'));
    }
}
