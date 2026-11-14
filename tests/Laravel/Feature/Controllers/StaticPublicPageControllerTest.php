<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

class StaticPublicPageControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_foundation_page_content_is_public_and_tenant_aware(): void
    {
        $response = $this->apiGet('/v2/public-page-content/about');

        $response->assertStatus(200);
        $response->assertJsonPath('data.route_key', 'about');
        $response->assertJsonPath('data.page_key', 'about');
        $response->assertJsonPath('data.path', '/about');
        $response->assertJsonPath('data.content_source', 'laravel_public_translations');
        $response->assertJsonPath('data.tenant.id', $this->testTenantId);
        $response->assertJsonPath('data.tenant.slug', $this->testTenantSlug);
        $response->assertJsonPath('data.tenant.name', 'Hour Timebank');
        $this->assertStringContainsString('Hour Timebank', $response->json('data.title'));
        $this->assertNotEmpty($response->json('data.lead'));
        $this->assertNotEmpty($response->json('data.sections'));
    }

    public function test_timebanking_guide_returns_structured_public_sections(): void
    {
        $response = $this->apiGet('/v2/public-page-content/timebanking-guide');

        $response->assertStatus(200);
        $response->assertJsonPath('data.route_key', 'timebankingGuide');
        $response->assertJsonPath('data.path', '/timebanking-guide');
        $response->assertJsonPath('data.translation_namespace', 'govuk_alpha.guide');
        $this->assertContains('steps', array_column($response->json('data.sections'), 'key'));
        $this->assertContains('getting_started', array_column($response->json('data.sections'), 'key'));
    }

    /**
     * The guide tells where timebanking came from, and lists Edgar Cahn's five
     * values (owner, 14 Nov 2026). The phone app draws these sections as they
     * arrive, so the shape matters: a title and a description on each item.
     */
    public function test_timebanking_guide_tells_where_timebanking_came_from(): void
    {
        $response = $this->apiGet('/v2/public-page-content/timebanking-guide');

        $response->assertStatus(200);
        $sections = array_column($response->json('data.sections'), null, 'key');

        $this->assertSame(
            ['equal_time', 'steps', 'origins', 'timeline', 'values', 'getting_started'],
            array_keys($sections)
        );

        $origins = $sections['origins'];
        $this->assertSame('Where timebanking comes from', $origins['title']);
        $this->assertSame('founder', $origins['items'][0]['key']);
        $this->assertSame('Edgar S. Cahn (1935–2022)', $origins['items'][0]['title']);
        $this->assertStringContainsString('Jean Camper Cahn', $origins['items'][0]['description']);
        $this->assertCount(4, $origins['items']);
        $this->assertStringContainsString('Teruko Mizushima', $origins['items'][3]['description']);

        $timeline = $sections['timeline']['items'];
        $this->assertSame(
            ['1973', '1980', '1992', '1995', '2000', 'Today'],
            array_column($timeline, 'title')
        );
        $this->assertStringContainsString('among them', $timeline[5]['description']);
        $this->assertStringNotContainsString(':community', $timeline[5]['description']);

        $values = $sections['values']['items'];
        $this->assertSame(
            [
                'Everyone has something to give',
                'Some work is beyond price',
                'Helping goes both ways',
                'We need each other',
                'Respect for every person',
            ],
            array_column($values, 'title')
        );
        foreach ($values as $value) {
            $this->assertNotSame('', trim((string) $value['description']));
        }
    }

    public function test_legal_hub_returns_public_document_summaries(): void
    {
        $response = $this->apiGet('/v2/public-page-content/legal');

        $response->assertStatus(200);
        $response->assertJsonPath('data.route_key', 'legal');
        $response->assertJsonPath('data.path', '/legal');
        $response->assertJsonPath('data.translation_namespace', 'govuk_alpha.legal');
        $this->assertStringContainsString('Hour Timebank', $response->json('data.lead'));
        $this->assertContains('documents', array_column($response->json('data.sections'), 'key'));
        $this->assertContains('terms', array_column($response->json('data.sections.0.items'), 'key'));
        $this->assertContains('privacy', array_column($response->json('data.sections.0.items'), 'key'));
        $this->assertContains('acceptable_use', array_column($response->json('data.sections.0.items'), 'key'));
    }

    public function test_private_and_unknown_pages_are_not_exposed(): void
    {
        $this->apiGet('/v2/public-page-content/dashboard')->assertStatus(404);
        $this->apiGet('/v2/public-page-content/coupon-detail')->assertStatus(404);
    }
}
