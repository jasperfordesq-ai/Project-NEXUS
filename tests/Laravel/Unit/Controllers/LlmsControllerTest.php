<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Controllers;

use App\Http\Controllers\LlmsController;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * llms.txt links only to pages a signed-out reader can open (2026-10-23).
 * It used to link listings, events, groups, volunteering, jobs and
 * organisations — all behind sign-in — and these tests pinned the
 * organisations link; they now pin its absence.
 */
class LlmsControllerTest extends TestCase
{
    public function test_short_context_never_links_sign_in_only_modules_whatever_is_switched_on(): void
    {
        $body = $this->renderShort([
            'events' => true,
            'groups' => true,
            'job_vacancies' => true,
            'organisations' => true,
            'volunteering' => true,
        ]);

        foreach (['/listings', '/events', '/groups', '/volunteering', '/jobs', '/organisations', '/explore'] as $private) {
            $this->assertStringNotContainsString('(https://example.test' . $private . ')', $body);
        }
        $this->assertStringContainsString('[About](https://example.test/about)', $body);
    }

    public function test_short_context_lists_whats_on_only_when_public_events_are_on(): void
    {
        $this->assertStringContainsString('(https://example.test/whats-on)', $this->renderShort(['events' => true, 'public_events' => true]));
        $this->assertStringNotContainsString('/whats-on', $this->renderShort(['events' => true, 'public_events' => false]));
    }

    /**
     * @param array<string, bool> $features
     */
    private function renderShort(array $features): string
    {
        $tenant = (object) [
            'id' => 999999,
            'description' => '',
            'features' => json_encode($features),
            'meta_description' => '',
            'name' => 'Test Timebank',
            'slug' => 'test-timebank',
            'tagline' => '',
        ];

        $controller = new LlmsController();
        $method = new ReflectionMethod($controller, 'renderShort');
        $method->setAccessible(true);

        return (string) $method->invoke($controller, $tenant, 'https://example.test');
    }
}
