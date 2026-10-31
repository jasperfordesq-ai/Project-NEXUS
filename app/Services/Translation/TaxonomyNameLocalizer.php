<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Translation;

use App\Core\TenantContext;
use App\Services\TranslationConfigurationService;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Shows a community's category and skill-category names in the reader's
 * language (AWID pilot feedback, 30 Oct 2026: "the lists are not fully
 * translated — Spanish speakers need basic English to pick the right option").
 *
 * Names are admin-written in the community's default language and stored once.
 * Their translations live in `name_translations` (JSON, language => name). A
 * missing one is translated by the community's translation engine the first
 * time someone reads the list in that language, saved, and reused from then on —
 * so each name is sent to the provider at most once per language.
 *
 * When nothing can translate (translation switched off, no engine, provider
 * refused) the stored name is shown, exactly as before. The failure is logged;
 * it is not hidden as a translation.
 */
class TaxonomyNameLocalizer
{
    public const TABLES = ['categories', 'skill_categories'];

    /** Provider calls one request may make, so a long list cannot stall a page. */
    public const MAX_PROVIDER_CALLS = 40;

    /**
     * Localise flat rows (arrays with `id`, `name`, `name_translations`).
     * Returns the rows with `name` in the reader's language and the
     * `name_translations` column removed, so it is never published.
     *
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    public static function localize(string $table, array $rows): array
    {
        $budget = self::MAX_PROVIDER_CALLS;

        return array_map(fn (array $row) => self::localizeRow($table, $row, $budget), $rows);
    }

    /**
     * Localise a tree of rows whose children sit under `children`.
     *
     * @param array<int, array<string, mixed>> $nodes
     * @return array<int, array<string, mixed>>
     */
    public static function localizeTree(string $table, array $nodes): array
    {
        $budget = self::MAX_PROVIDER_CALLS;

        $walk = function (array $nodes) use (&$walk, $table, &$budget): array {
            return array_map(function (array $node) use (&$walk, $table, &$budget) {
                $node = self::localizeRow($table, $node, $budget);
                if (isset($node['children']) && is_array($node['children'])) {
                    $node['children'] = $walk($node['children']);
                }
                return $node;
            }, $nodes);
        };

        return $walk($nodes);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function localizeRow(string $table, array $row, int &$budget): array
    {
        $stored = self::decode($row['name_translations'] ?? null);
        unset($row['name_translations']);

        $name = is_string($row['name'] ?? null) ? trim($row['name']) : '';
        if ($name === '' || ! in_array($table, self::TABLES, true)) {
            return $row;
        }

        $target = self::readerLanguage();
        $source = self::communityLanguage();
        if ($target === $source) {
            return $row;
        }

        if (isset($stored[$target]) && is_string($stored[$target]) && trim($stored[$target]) !== '') {
            $row['name'] = $stored[$target];
            return $row;
        }

        if ($budget <= 0 || ! self::canTranslate()) {
            return $row;
        }
        $budget--;

        try {
            $translated = TranslationEngine::translate($name, $source, $target);
        } catch (\Throwable $e) {
            $translated = null;
            Log::warning('TaxonomyNameLocalizer: translation threw', ['table' => $table, 'id' => $row['id'] ?? null, 'error' => $e->getMessage()]);
        }

        if (! is_string($translated) || trim($translated) === '') {
            Log::warning('TaxonomyNameLocalizer: name not translated', ['table' => $table, 'id' => $row['id'] ?? null, 'target' => $target]);
            return $row;
        }

        $translated = mb_substr(trim($translated), 0, 255);
        $stored[$target] = $translated;
        self::save($table, (int) ($row['id'] ?? 0), $stored);
        $row['name'] = $translated;

        return $row;
    }

    /** @var array<string, array{at: int, names: array<int, string>}> */
    private static array $nameMaps = [];

    /**
     * A category's name for DISPLAY, in the reader's language, from the stored
     * translations only (no provider call — names are filled ahead of time).
     * Falls back to the stored name. Use it where a name is shown; never where
     * names are compared, grouped, searched or saved — those keep the stored name.
     */
    public static function nameFor(string $table, mixed $id, ?string $storedName): ?string
    {
        $id = is_numeric($id) ? (int) $id : 0;
        if ($id <= 0 || $storedName === null || $storedName === '' || ! in_array($table, self::TABLES, true)) {
            return $storedName;
        }
        $target = self::readerLanguage();
        if ($target === self::communityLanguage()) {
            return $storedName;
        }

        return self::nameMap($table, $target)[$id] ?? $storedName;
    }

    /**
     * id => translated name for one table and language, for the current
     * community. Held for a minute so a long-running worker sees an admin's
     * correction soon after it is made.
     *
     * @return array<int, string>
     */
    private static function nameMap(string $table, string $language): array
    {
        $tenantId = (int) TenantContext::getId();
        $key = $table . '|' . $tenantId . '|' . $language;
        $cached = self::$nameMaps[$key] ?? null;
        if ($cached !== null && $cached['at'] > time() - 60) {
            return $cached['names'];
        }

        $names = [];
        if ($tenantId > 0) {
            $rows = DB::table($table)->where('tenant_id', $tenantId)->whereNotNull('name_translations')
                ->get(['id', 'name_translations']);
            foreach ($rows as $row) {
                $stored = self::decode($row->name_translations);
                if (isset($stored[$language]) && is_string($stored[$language]) && trim($stored[$language]) !== '') {
                    $names[(int) $row->id] = $stored[$language];
                }
            }
        }
        self::$nameMaps[$key] = ['at' => time(), 'names' => $names];

        return $names;
    }

    /**
     * Translate every `categories` name inside a response payload: rows with
     * `category_id` + `category_name`, nested `category` {id, name}, and a
     * `categories` list of {id, name}. Use ONLY on payloads whose categories all
     * come from the `categories` table (marketplace, course and resource-library
     * categories are other tables with their own ids).
     *
     * @param array<mixed> $payload
     * @return array<mixed>
     */
    public static function localizePayload(array $payload): array
    {
        if (isset($payload['category_id'], $payload['category_name']) && is_string($payload['category_name'])) {
            $payload['category_name'] = self::nameFor('categories', $payload['category_id'], $payload['category_name']);
        }
        if (isset($payload['category']) && is_array($payload['category'])
            && isset($payload['category']['id'], $payload['category']['name']) && is_string($payload['category']['name'])) {
            $payload['category']['name'] = self::nameFor('categories', $payload['category']['id'], $payload['category']['name']);
        }
        foreach ($payload as $key => $value) {
            if (! is_array($value)) {
                continue;
            }
            if ($key === 'categories' && array_is_list($value)) {
                $payload[$key] = array_map(fn ($row) => is_array($row) && isset($row['id'], $row['name']) && is_string($row['name'])
                    ? ['name' => self::nameFor('categories', $row['id'], $row['name'])] + $row
                    : $row, $value);
                continue;
            }
            if ($key !== 'category') {
                $payload[$key] = self::localizePayload($value);
            }
        }

        return $payload;
    }

    /** For tests: forget the held name maps. */
    public static function flushNameMaps(): void
    {
        self::$nameMaps = [];
        self::$communityLanguages = [];
    }

    /**
     * The languages every name is translated into ahead of time: the platform's
     * whole language list, so no reader anywhere waits for a translation or sees
     * the admin's language instead of their own.
     *
     * @return list<string>
     */
    public static function platformLanguages(): array
    {
        return \App\Http\Middleware\SetLocale::SUPPORTED_LOCALES;
    }

    /**
     * Translate one category's name into every platform language it lacks, and
     * save. An existing translation is never overwritten, so an admin's
     * correction stays. Uses the current community (TenantContext).
     *
     * @return array{filled: int, failed: int}
     */
    public static function fillMissing(string $table, int $id): array
    {
        $result = ['filled' => 0, 'failed' => 0];
        $tenantId = TenantContext::getId();
        if (! in_array($table, self::TABLES, true) || ! $tenantId || ! self::canTranslate()) {
            return $result;
        }

        $row = DB::table($table)->where('id', $id)->where('tenant_id', $tenantId)
            ->first(['id', 'name', 'name_translations']);
        $name = $row && is_string($row->name) ? trim($row->name) : '';
        if ($name === '') {
            return $result;
        }

        $source = self::communityLanguage();
        $stored = self::decode($row->name_translations);
        foreach (self::platformLanguages() as $language) {
            if ($language === $source || (isset($stored[$language]) && trim((string) $stored[$language]) !== '')) {
                continue;
            }
            try {
                $translated = TranslationEngine::translate($name, $source, $language);
            } catch (\Throwable $e) {
                $translated = null;
            }
            if (! is_string($translated) || trim($translated) === '') {
                $result['failed']++;
                continue;
            }
            $stored[$language] = mb_substr(trim($translated), 0, 255);
            $result['filled']++;
        }

        if ($result['filled'] > 0) {
            self::save($table, $id, $stored);
        }
        if ($result['failed'] > 0) {
            Log::warning('TaxonomyNameLocalizer: some languages not filled', ['table' => $table, 'id' => $id] + $result);
        }

        return $result;
    }

    /**
     * Fill every category and skill category of the current community.
     *
     * @return array{rows: int, filled: int, failed: int}
     */
    public static function fillCommunity(): array
    {
        $totals = ['rows' => 0, 'filled' => 0, 'failed' => 0];
        $tenantId = TenantContext::getId();
        if (! $tenantId || ! self::canTranslate()) {
            return $totals;
        }

        foreach (self::TABLES as $table) {
            $ids = DB::table($table)->where('tenant_id', $tenantId)->pluck('id');
            foreach ($ids as $id) {
                $one = self::fillMissing($table, (int) $id);
                $totals['rows']++;
                $totals['filled'] += $one['filled'];
                $totals['failed'] += $one['failed'];
            }
        }

        return $totals;
    }

    /**
     * An admin's edited translations merged over the stored ones. Only platform
     * languages are kept; an empty value removes that language (the nightly sweep
     * then translates it again). Returns null when a value is longer than 255.
     *
     * @param array<string, mixed> $current
     * @return array<string, string>|null
     */
    public static function sanitizeTranslations(mixed $submitted, array $current): ?array
    {
        $result = array_filter($current, fn ($v, $k) => is_string($k) && is_string($v) && trim($v) !== ''
            && in_array($k, self::platformLanguages(), true), ARRAY_FILTER_USE_BOTH);
        if (! is_array($submitted)) {
            return $result;
        }
        foreach ($submitted as $language => $value) {
            if (! is_string($language) || ! in_array($language, self::platformLanguages(), true)) {
                continue;
            }
            $value = is_string($value) ? trim($value) : '';
            if ($value === '') {
                unset($result[$language]);
                continue;
            }
            if (mb_strlen($value) > 255) {
                return null;
            }
            $result[$language] = $value;
        }

        return $result;
    }

    private static function canTranslate(): bool
    {
        return TranslationConfigurationService::isEnabled() && TranslationEngine::available();
    }

    /** @param array<string, string> $translations */
    private static function save(string $table, int $id, array $translations): void
    {
        $tenantId = TenantContext::getId();
        if ($id <= 0 || ! $tenantId) {
            return;
        }

        DB::table($table)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'name_translations' => json_encode($translations, JSON_UNESCAPED_UNICODE),
                // A translation is not an edit of the category.
                'updated_at' => DB::raw('updated_at'),
            ]);
    }

    /** @return array<string, mixed> */
    private static function decode(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (! is_string($value) || $value === '') {
            return [];
        }
        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private static function readerLanguage(): string
    {
        return self::base(App::getLocale()) ?: 'en';
    }

    /** The language the community's admins write in: its default language, else English. */
    /** @var array<int, array{at: int, language: string}> */
    private static array $communityLanguages = [];

    private static function communityLanguage(): string
    {
        $tenantId = (int) TenantContext::getId();
        $cached = self::$communityLanguages[$tenantId] ?? null;
        if ($cached !== null && $cached['at'] > time() - 60) {
            return $cached['language'];
        }
        $language = self::lookUpCommunityLanguage($tenantId);
        self::$communityLanguages[$tenantId] = ['at' => time(), 'language' => $language];

        return $language;
    }

    private static function lookUpCommunityLanguage(int $tenantId): string
    {
        if ($tenantId) {
            $configuration = DB::table('tenants')->where('id', $tenantId)->value('configuration');
            $config = is_string($configuration) ? json_decode($configuration, true) : null;
            $default = is_array($config) ? ($config['default_language'] ?? null) : null;
            if (is_string($default) && self::base($default) !== '') {
                return self::base($default);
            }
        }

        return 'en';
    }

    private static function base(?string $locale): string
    {
        return strtolower(substr(str_replace('_', '-', trim((string) $locale)), 0, 2));
    }
}
