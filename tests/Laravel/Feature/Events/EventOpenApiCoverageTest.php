<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use Illuminate\Routing\Route;
use JsonException;
use Tests\Laravel\TestCase;

/** Keeps the published Events API inventory synchronized with Laravel routes. */
final class EventOpenApiCoverageTest extends TestCase
{
    public function test_every_maintained_event_api_operation_is_published_without_stale_paths(): void
    {
        $spec = $this->spec();
        /** @var array<string,mixed> $publishedPaths */
        $publishedPaths = $spec['paths'];

        /** @var array<string,list<string>> $live */
        $live = [];
        foreach (app('router')->getRoutes()->getRoutes() as $route) {
            if (! $route instanceof Route) {
                continue;
            }
            $path = '/' . ltrim($route->uri(), '/');
            if (! self::isMaintainedEventPath($path)) {
                continue;
            }
            $methods = array_values(array_filter(
                array_map('strtolower', $route->methods()),
                static fn (string $method): bool => in_array(
                    $method,
                    ['get', 'post', 'put', 'patch', 'delete'],
                    true,
                ),
            ));
            $live[$path] = array_values(array_unique(array_merge(
                $live[$path] ?? [],
                $methods,
            )));
        }

        self::assertNotEmpty($live);
        foreach ($live as $path => $methods) {
            self::assertArrayHasKey($path, $publishedPaths, "OpenAPI is missing {$path}");
            foreach ($methods as $method) {
                self::assertArrayHasKey(
                    $method,
                    $publishedPaths[$path],
                    "OpenAPI is missing " . strtoupper($method) . " {$path}",
                );
                self::assertNotEmpty(
                    $publishedPaths[$path][$method]['operationId'] ?? null,
                    "OpenAPI operationId is missing for " . strtoupper($method) . " {$path}",
                );
            }
        }

        $publishedEventPaths = array_values(array_filter(
            array_keys($publishedPaths),
            self::isMaintainedEventPath(...),
        ));
        sort($publishedEventPaths);
        $livePaths = array_keys($live);
        sort($livePaths);
        self::assertSame($livePaths, $publishedEventPaths);
    }

    public function test_event_security_and_lifecycle_history_contracts_are_explicit(): void
    {
        $spec = $this->spec();
        self::assertSame('https://api.project-nexus.ie', $spec['servers'][0]['url'] ?? null);
        self::assertSame(
            'Sanctum or legacy JWT',
            $spec['components']['securitySchemes']['bearerAuth']['bearerFormat'] ?? null,
        );
        self::assertSame(
            'Federation API key',
            $spec['components']['securitySchemes']['federationBearerAuth']['bearerFormat'] ?? null,
        );
        self::assertSame(
            [],
            $spec['paths']['/api/v2/events/calendar/personal/{tenantSlug}/{secret}.ics']['get']['security'] ?? null,
        );
        self::assertSame(
            [],
            $spec['paths']['/api/v2/events/safety/guardian-consents/grant']['post']['security'] ?? null,
        );
        self::assertSame(
            ['token', 'guardian_email'],
            $spec['paths']['/api/v2/events/safety/guardian-consents/grant']['post']
                ['requestBody']['content']['application/json']['schema']['required'] ?? null,
        );
        self::assertSame(
            [['federationBearerAuth' => []]],
            $spec['paths']['/api/v2/federation/ingest/events']['post']['security'] ?? null,
        );
        self::assertSame(
            [['bearerAuth' => []]],
            $spec['paths']['/api/v2/events/{id}/lifecycle-history']['get']['security'] ?? null,
        );

        $parameters = collect(
            $spec['paths']['/api/v2/events/{id}/lifecycle-history']['get']['parameters'] ?? [],
        )->keyBy('name');
        self::assertSame(256, $parameters->get('cursor')['schema']['maxLength'] ?? null);
        self::assertSame(1, $parameters->get('per_page')['schema']['minimum'] ?? null);
        self::assertSame(100, $parameters->get('per_page')['schema']['maximum'] ?? null);
        self::assertSame(20, $parameters->get('per_page')['schema']['default'] ?? null);
    }

    public function test_recurrence_capability_contract_is_exact_and_fail_safe(): void
    {
        $spec = $this->spec();
        $operation = $spec['paths']['/api/v2/events/recurrence-capabilities']['get'] ?? [];

        self::assertSame([['bearerAuth' => []]], $operation['security'] ?? null);
        self::assertSame(
            'App\\Http\\Controllers\\Api\\EventRecurrenceCapabilityController@show',
            $operation['x-controller-action'] ?? null,
        );
        self::assertSame(
            '#/components/schemas/EventRecurrenceCapabilitiesEnvelope',
            $operation['responses']['200']['content']['application/json']['schema']['$ref'] ?? null,
        );
        self::assertArrayHasKey('401', $operation['responses'] ?? []);
        self::assertArrayHasKey('403', $operation['responses'] ?? []);

        $schema = $spec['components']['schemas']['EventRecurrenceCapabilities'] ?? [];
        $fields = [
            'contract_version',
            'engine',
            'structured_input',
            'supported_frequencies',
            'max_occurrences',
            'supported_end_types',
            'supports_rolling_never',
            'supports_effective_revisions',
            'supports_definition_blueprints',
            'schema_ready',
            'rollout_state',
        ];
        self::assertFalse($schema['additionalProperties'] ?? true);
        self::assertSame($fields, $schema['required'] ?? null);
        self::assertSame($fields, array_keys($schema['properties'] ?? []));
        self::assertSame([1], $schema['properties']['contract_version']['enum'] ?? null);
        self::assertSame(['legacy', 'v2'], $schema['properties']['engine']['enum'] ?? null);
        self::assertSame([true], $schema['properties']['structured_input']['enum'] ?? null);
        self::assertSame(
            ['daily', 'weekly', 'monthly', 'yearly'],
            $schema['properties']['supported_frequencies']['items']['enum'] ?? null,
        );
        self::assertSame(4, $schema['properties']['supported_frequencies']['minItems'] ?? null);
        self::assertSame(4, $schema['properties']['supported_frequencies']['maxItems'] ?? null);
        self::assertSame(1, $schema['properties']['max_occurrences']['minimum'] ?? null);
        self::assertSame(5000, $schema['properties']['max_occurrences']['maximum'] ?? null);
        self::assertSame(
            ['after_count', 'on_date', 'never'],
            $schema['properties']['supported_end_types']['items']['enum'] ?? null,
        );
        self::assertSame(
            ['legacy', 'v2_degraded', 'v2_finite', 'v2_rolling'],
            $schema['properties']['rollout_state']['enum'] ?? null,
        );

        $envelope = $spec['components']['schemas']['EventRecurrenceCapabilitiesEnvelope'] ?? [];
        self::assertFalse($envelope['additionalProperties'] ?? true);
        self::assertSame(['data', 'meta'], $envelope['required'] ?? null);
        self::assertSame(['data', 'meta'], array_keys($envelope['properties'] ?? []));
        self::assertFalse($envelope['properties']['meta']['additionalProperties'] ?? true);
    }

    /** @return array<string,mixed> */
    private function spec(): array
    {
        $contents = file_get_contents(base_path('openapi.json'));
        self::assertIsString($contents);

        try {
            $decoded = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            self::fail('openapi.json is invalid JSON: ' . $exception->getMessage());
        }
        self::assertIsArray($decoded);
        self::assertSame('3.0.3', $decoded['openapi'] ?? null);
        self::assertIsArray($decoded['paths'] ?? null);

        return $decoded;
    }

    private static function isMaintainedEventPath(string $path): bool
    {
        // `public/events` is named explicitly: the original pattern matched
        // `events...` and `admin/events...` but not `public/events...`, so the
        // public endpoints shipped without spec entries and this test — whose
        // whole purpose is spec ⇄ routes in both directions — structurally
        // could not notice. A new events surface must extend this list.
        return preg_match(
            '#^/api/v2/(?:admin/events(?:/|$)|admin/prerender/events$|events(?:/|$)|public/events(?:/|$)|event-broadcasts(?:/|$)|event-templates(?:/|$)|federation/(?:ingest/)?events$)#D',
            $path,
        ) === 1;
    }
}
