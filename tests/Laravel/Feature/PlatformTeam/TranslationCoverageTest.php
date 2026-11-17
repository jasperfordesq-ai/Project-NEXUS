<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\TranslationCoverageService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Translations, the server half: for each of the ten
 * languages other than English, how many of the server's phrases (emails and
 * messages, `lang/`) are missing and how many are still word-for-word English.
 *
 * Every test reads a small `lang` folder written to a temporary directory,
 * never the real one, so no real count is pinned here.
 */
class TranslationCoverageTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/translation-coverage';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['available', 'generated_at', 'locales'];

    private const ROW_KEYS = ['keys', 'locale', 'missing', 'same_as_english'];

    private const LOCALES = ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/pt-lang-' . bin2hex(random_bytes(6));
        mkdir($this->dir);
        Cache::forget(TranslationCoverageService::CACHE_KEY);
        $this->app->instance(TranslationCoverageService::class, new TranslationCoverageService($this->dir));
    }

    protected function tearDown(): void
    {
        try {
            Cache::forget(TranslationCoverageService::CACHE_KEY);
            $this->removeTree($this->dir);
        } finally {
            parent::tearDown();
        }
    }

    private function removeTree(string $path): void
    {
        if (is_dir($path)) {
            foreach (scandir($path) ?: [] as $entry) {
                if ($entry !== '.' && $entry !== '..') {
                    $this->removeTree($path . '/' . $entry);
                }
            }
            @rmdir($path);
        } elseif (is_file($path)) {
            @unlink($path);
        }
    }

    /** @param array<string, mixed> $data */
    private function writeJson(string $locale, string $namespace, array $data): void
    {
        @mkdir($this->dir . '/' . $locale, 0777, true);
        file_put_contents($this->dir . "/{$locale}/{$namespace}.json", json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    /** @param array<string, mixed> $data */
    private function writePhp(string $locale, string $namespace, array $data): void
    {
        @mkdir($this->dir . '/' . $locale, 0777, true);
        file_put_contents($this->dir . "/{$locale}/{$namespace}.php", '<?php return ' . var_export($data, true) . ";\n");
    }

    /** English: 6 phrases in a .json namespace (one plural pair = one phrase), 3 in a .php one. */
    private function english(): void
    {
        $this->writeJson('en', 'emails', [
            'greeting' => 'Hello {{name}}',
            'footer' => ['rights' => 'All rights reserved', 'brand' => 'Project NEXUS'],
            'only_placeholder' => '{{count}}',
            'items_one' => 'One item',
            'items_other' => '{{count}} items',
        ]);
        $this->writePhp('en', 'api', [
            'saved' => 'Saved',
            'nested' => ['deleted' => 'Deleted :name'],
            'units' => 'km',
        ]);
    }

    /** @return array<string, mixed> */
    private function data(string $query = ''): array
    {
        $this->actAsPlatformTeam();

        return $this->apiGet(self::URI . $query)->assertStatus(200)->json('data');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, array<string, mixed>>
     */
    private function byLocale(array $data): array
    {
        $out = [];
        foreach ($data['locales'] as $row) {
            $out[$row['locale']] = $row;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $array
     * @return list<string>
     */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->english();
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_the_counts_for_the_ten_other_languages(): void
    {
        $this->english();

        $data = $this->data();

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertTrue($data['available']);
        $this->assertIsString($data['generated_at']);
        $this->assertNotFalse(strtotime($data['generated_at']));
        $this->assertSame(self::LOCALES, array_map(fn ($row) => $row['locale'], $data['locales']));
        foreach ($data['locales'] as $row) {
            $this->assertSame(self::ROW_KEYS, $this->sortedKeys($row));
            // No folder for the language at all: every phrase is missing, none is "the same".
            $this->assertSame(['keys' => 8, 'missing' => 8, 'same_as_english' => 0], ['keys' => $row['keys'], 'missing' => $row['missing'], 'same_as_english' => $row['same_as_english']]);
        }
    }

    public function test_it_counts_missing_and_same_as_english_phrases(): void
    {
        $this->english();
        $this->writeJson('de', 'emails', [
            'greeting' => 'Hallo {{name}}',
            // Identical to English: counted as the same.
            'footer' => ['rights' => '  All rights reserved ', 'brand' => 'Project NEXUS'],
            // Identical, but only a placeholder: never "the same".
            'only_placeholder' => '{{count}}',
            // German has only the "other" form: the plural is present.
            'items_other' => '{{count}} Elemente',
        ]);
        $this->writePhp('de', 'api', [
            'saved' => 'Gespeichert',
            // nested.deleted missing
            'units' => 'km',
        ]);

        $de = $this->byLocale($this->data())['de'];

        $this->assertSame(8, $de['keys']);
        $this->assertSame(1, $de['missing']);
        // "All rights reserved", "Project NEXUS", "km".
        $this->assertSame(3, $de['same_as_english']);
    }

    public function test_an_empty_translation_counts_as_missing(): void
    {
        $this->english();
        $this->writePhp('fr', 'api', ['saved' => '', 'nested' => ['deleted' => 'Supprimé :name'], 'units' => 'km']);

        $fr = $this->byLocale($this->data())['fr'];

        // 5 phrases of `emails` (no file) + the empty one.
        $this->assertSame(6, $fr['missing']);
    }

    /**
     * Measured on the live server (17 Nov 2026): three phrases in
     * `govuk_alpha.php` whose English text is the empty string were counted as
     * "missing" in every language. A phrase with no English text is not a phrase.
     */
    public function test_a_phrase_whose_english_text_is_empty_is_never_counted(): void
    {
        $this->english();
        $this->writePhp('en', 'pages', [
            'intro' => '',
            'other_intro' => '   ',
            'blank_one' => '',
            'blank_other' => ' ',
            'real' => 'Real words',
        ]);
        // German: empty where English is empty, text where English is empty, the real one empty.
        $this->writePhp('de', 'pages', ['intro' => '', 'other_intro' => 'Etwas', 'real' => '']);
        // Spanish: the real one translated, nothing where English is empty.
        $this->writePhp('es', 'pages', ['real' => 'Palabras reales']);

        $rows = $this->byLocale($this->data());

        // 8 from the base fixture + `real`; the English-empty ones are left out.
        $this->assertSame(['keys' => 9, 'missing' => 9, 'same_as_english' => 0], array_intersect_key($rows['de'], ['keys' => 1, 'missing' => 1, 'same_as_english' => 1]));
        $this->assertSame(['keys' => 9, 'missing' => 8, 'same_as_english' => 0], array_intersect_key($rows['es'], ['keys' => 1, 'missing' => 1, 'same_as_english' => 1]));
    }

    public function test_a_namespace_with_both_files_is_counted_once_from_the_file_that_serves_each_phrase(): void
    {
        $this->english();
        // `__()` reads the .json first, so its phrases are served from there;
        // the .php only serves a phrase the .json does not have.
        $this->writeJson('en', 'admin', ['title' => 'Dashboard', 'save' => 'Save']);
        $this->writePhp('en', 'admin', ['save' => 'Save', 'old_only' => 'Legacy wording']);
        // In Spanish the .php has `title`, but that is never read: the .json is.
        $this->writeJson('es', 'admin', ['save' => 'Guardar']);
        $this->writePhp('es', 'admin', ['title' => 'Panel', 'old_only' => 'Texto antiguo']);

        $es = $this->byLocale($this->data())['es'];

        // 8 + title, save (json) + old_only (php) = 11; `save` in the .php is not counted again.
        $this->assertSame(11, $es['keys']);
        // All 8 of the base fixture, plus `title` (missing from the .json that serves it).
        $this->assertSame(9, $es['missing']);
    }

    public function test_a_broken_language_file_counts_its_phrases_as_missing_and_does_not_fail(): void
    {
        $this->english();
        @mkdir($this->dir . '/it', 0777, true);
        file_put_contents($this->dir . '/it/emails.json', '{ this is not json');
        file_put_contents($this->dir . '/it/api.php', "<?php return 'not an array';\n");

        $it = $this->byLocale($this->data())['it'];

        $this->assertSame(8, $it['missing']);
    }

    public function test_without_english_files_it_is_not_available_never_zero(): void
    {
        $data = $this->data();

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertFalse($data['available']);
        $this->assertNull($data['generated_at']);
        $this->assertNull($data['locales']);
    }

    public function test_a_broken_english_file_is_not_available(): void
    {
        $this->english();
        file_put_contents($this->dir . '/en/emails.json', '{ broken');

        $this->assertFalse($this->data()['available']);
    }

    public function test_it_is_kept_for_an_hour_and_refresh_recomputes(): void
    {
        $this->english();
        $first = $this->data();
        $this->assertSame(8, $this->byLocale($first)['pl']['missing']);

        $this->writePhp('pl', 'api', ['saved' => 'Zapisano', 'nested' => ['deleted' => 'Usunięto :name'], 'units' => 'km']);

        // Kept: the new Polish file is not seen yet.
        $this->assertSame(8, $this->byLocale($this->data())['pl']['missing']);
        // Recomputed on request.
        $this->assertSame(5, $this->byLocale($this->data('?refresh=1'))['pl']['missing']);
        // And the fresh result is the one kept.
        $this->assertSame(5, $this->byLocale($this->data())['pl']['missing']);
    }

    public function test_a_result_that_is_not_available_is_not_kept(): void
    {
        $this->assertFalse($this->data()['available']);

        $this->english();

        $this->assertTrue($this->data()['available']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, [])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
