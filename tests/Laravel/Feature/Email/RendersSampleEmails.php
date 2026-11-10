<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;

/**
 * Sample emails for the readability tests: every block the shared builder
 * has, and the three match emails. Use inside a test with DatabaseTransactions
 * (setCommunityColour() writes the test tenant's configuration).
 */
trait RendersSampleEmails
{
    protected function setCommunityColour(?string $colour): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = json_decode((string) $raw, true) ?: [];
        if ($colour === null) {
            unset($config['primary_color']);
        } else {
            $config['primary_color'] = $colour;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);
    }

    /** Every kind of block the builder has, with a link in running text. */
    protected function everyBlock(string $theme): string
    {
        $ownLink = EmailTemplateBuilder::tenantUrl('/wallet');

        return EmailTemplateBuilder::make()
            ->theme($theme)
            ->title('Title')
            ->greeting('Sam')
            ->paragraph('Body text with <a href="' . $ownLink . '">a link to the community</a>.')
            ->infoCard(['From' => 'Alex Example', 'Hours' => '2'], 'Details')
            ->statCards([['value' => '12', 'label' => 'Hours', 'icon' => '⏱️']])
            ->bulletList(['First point', 'Second point'], 'What happens next')
            ->blockquote('Thank you so much!', 'Alex')
            ->highlight('A highlighted note', '💡')
            ->badges([['text' => 'Helper', 'color' => '#10b981'], ['text' => 'Pale', 'color' => '#fde047'], ['text' => 'Deep', 'color' => '#1e3a8a']])
            ->divider()
            ->button('Open', $ownLink)
            ->render();
    }

    /** @param 'hot'|'mutual'|'digest' $which */
    protected function matchEmail(string $which): string
    {
        $match = ['title' => 'Gardening help', 'user_name' => 'Alex', 'match_score' => 90, 'listing_id' => 1, 'match_type' => 'mutual', 'distance_km' => 2.5];

        return match ($which) {
            'hot' => $this->invokeDispatcher('buildHotMatchEmail', [$match, 90]),
            'mutual' => $this->invokeDispatcher('buildMutualMatchEmail', [$match, ['they_offer' => 'Gardening', 'you_offer' => 'Bike repair']]),
            'digest' => $this->invokeDispatcher('buildMatchDigestEmail', [[
                $match,
                array_merge($match, ['title' => 'Bike repair', 'match_score' => 72, 'match_type' => 'one_way']),
                array_merge($match, ['title' => 'Dog walking', 'match_score' => 60, 'match_type' => 'one_way']),
            ], 'weekly', 1, 1, 0]),
        };
    }

    /** @param list<mixed> $args */
    private function invokeDispatcher(string $method, array $args): string
    {
        $ref = new \ReflectionMethod(NotificationDispatcher::class, $method);
        $ref->setAccessible(true);

        return (string) $ref->invoke(null, ...$args);
    }
}
