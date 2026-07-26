<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use PHPUnit\Framework\TestCase;

final class EventAccessibilityDiscoveryStaticTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 4);
    }

    public function test_backend_filter_is_canonical_and_series_aware(): void
    {
        $service = $this->source('app/Services/EventService.php');
        self::assertStringContainsString('resolveDiscoveryStepFree', $service);
        self::assertStringContainsString("'step_free' => \$stepFree", $service);
        self::assertStringContainsString("whereNull('events.accessibility_step_free')", $service);
        self::assertStringContainsString("whereNull('e2.accessibility_step_free')", $service);
        self::assertStringContainsString("['yes', 'no', 'unknown']", $service);

        $api = $this->source('app/Http/Controllers/Api/EventsController.php');
        self::assertStringContainsString("query('step_free')", $api);

        $accessible = $this->source('app/Http/Controllers/GovukAlpha/AlphaController.php');
        self::assertStringContainsString("['any', 'yes', 'no', 'unknown']", $accessible);
        self::assertStringContainsString("'step_free' => \$this->allowed", $accessible);
    }

    public function test_maintained_clients_expose_structured_accessibility_filters(): void
    {
        $web = $this->source('react-frontend/src/pages/events/EventsPage.tsx');
        self::assertStringContainsString('Select as HeroSelect', $web);
        // The URL/query wiring was an inline object literal until the page gained its
        // phone layout, which extracted param assembly so the list fetch and the filter
        // sheet cannot drift apart. Assert the behaviour — step_free is sent unless the
        // filter is 'any' — rather than the old literal spelling.
        self::assertStringContainsString("stepFreeFilter !== 'any'", $web);
        self::assertStringContainsString("params.set('step_free', stepFreeFilter)", $web);
        self::assertStringContainsString('event_accessibility:filters.step_free_label', $web);

        // Phones do not render the desktop filter card at all, so the same accessibility
        // filter has to be reachable from the bottom sheet. Without this the phone layout
        // could silently drop step-free discovery while every assertion above still passed.
        $webSheet = $this->source('react-frontend/src/components/events/EventFilterSheet.tsx');
        self::assertStringContainsString('event_accessibility:filters.step_free_label', $webSheet);
        self::assertStringContainsString('event_accessibility:filters.step_free_options.', $webSheet);

        $blade = $this->source('accessible-frontend/views/events.blade.php');
        self::assertStringContainsString('name="step_free"', $blade);
        self::assertStringContainsString('event_accessibility.filters.step_free_hint', $blade);
        self::assertStringContainsString("'step_free' => (\$filters['step_free']", $blade);

        $mobileApi = $this->source('mobile/lib/api/events.ts');
        self::assertStringContainsString('stepFree?: EventStepFreeFilter | null', $mobileApi);
        self::assertStringContainsString('params.step_free = filters.stepFree', $mobileApi);

        $mobile = $this->source('mobile/app/(tabs)/events.tsx');
        self::assertStringContainsString('events-step-free-filter', $mobile);
        self::assertStringContainsString('Select.TriggerIndicator', $mobile);
        self::assertStringContainsString("stepFree: stepFree === 'any' ? null : stepFree", $mobile);
    }

    public function test_accessibility_filter_translations_cover_every_maintained_locale(): void
    {
        $webLocales = ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];
        $mobileLocales = ['de', 'en', 'es', 'fr', 'ga', 'it', 'pt'];
        $expectedWebKeys = [
            'step_free_active',
            'step_free_hint',
            'step_free_label',
            'step_free_options.any',
            'step_free_options.no',
            'step_free_options.unknown',
            'step_free_options.yes',
        ];

        foreach ($webLocales as $locale) {
            $json = json_decode(
                $this->source("react-frontend/public/locales/{$locale}/event_accessibility.json"),
                true,
                512,
                JSON_THROW_ON_ERROR,
            );
            self::assertSame($expectedWebKeys, array_keys($this->flatten($json['filters'] ?? [])), $locale);
            self::assertStringContainsString('{{value}}', (string) ($json['filters']['step_free_active'] ?? ''), $locale);
            if ($locale !== 'en') {
                self::assertNotSame('Step-free venue access', $json['filters']['step_free_label'] ?? null, $locale);
            }

            /** @var array<string, mixed> $php */
            $php = require $this->root . "/lang/{$locale}/event_accessibility.php";
            self::assertSame($expectedWebKeys, array_keys($this->flatten($php['filters'] ?? [])), $locale);
            self::assertStringContainsString(':value', (string) ($php['filters']['step_free_active'] ?? ''), $locale);
        }

        foreach ($mobileLocales as $locale) {
            $json = json_decode(
                $this->source("mobile/locales/{$locale}/events.json"),
                true,
                512,
                JSON_THROW_ON_ERROR,
            );
            self::assertSame([
                'hint',
                'label',
                'options.any',
                'options.no',
                'options.unknown',
                'options.yes',
            ], array_keys($this->flatten($json['accessibilityFilter'] ?? [])), $locale);
            if ($locale !== 'en') {
                self::assertNotSame('Step-free venue access', $json['accessibilityFilter']['label'] ?? null, $locale);
            }
        }
    }

    /** @return array<string, scalar|null> */
    private function flatten(array $values, string $prefix = ''): array
    {
        $flat = [];
        foreach ($values as $key => $value) {
            $path = $prefix === '' ? (string) $key : "{$prefix}.{$key}";
            if (is_array($value)) {
                $flat += $this->flatten($value, $path);
            } else {
                $flat[$path] = is_scalar($value) || $value === null ? $value : null;
            }
        }
        ksort($flat);

        return $flat;
    }

    private function source(string $relative): string
    {
        $source = file_get_contents($this->root . '/' . $relative);
        self::assertIsString($source, $relative);

        return $source;
    }
}
