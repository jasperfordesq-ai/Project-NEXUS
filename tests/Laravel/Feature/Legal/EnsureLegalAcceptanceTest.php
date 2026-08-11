<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Legal;

use App\Http\Middleware\EnsureLegalAcceptance;
use App\Models\User;
use App\Services\LegalEnforcementService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The server-side legal-acceptance gate.
 *
 * Before this existed there was NO server-side enforcement: React gated
 * client-side, so the accessible frontend, the mobile app and any bare API caller
 * with a valid token ignored a pending acceptance entirely.
 *
 * Three properties matter more than the happy path, and each has its own test:
 *
 *  🔴 The exemption list must let the acceptance flow itself through, or the gate
 *     locks the door with the key inside.
 *  🔴 Accepting must take effect IMMEDIATELY. The verdict is cached, so a stale
 *     positive is an accept → still blocked → accept loop with no way out.
 *  🔴 It must fail OPEN. A gate on ordinary member writes that fires because a
 *     cache blinked is a self-inflicted outage.
 */
class EnsureLegalAcceptanceTest extends TestCase
{
    use DatabaseTransactions;

    private int $documentId;
    private int $versionId;

    protected function setUp(): void
    {
        parent::setUp();

        // Default mode for the suite; individual tests override it.
        config(['legal.enforcement_mode' => 'write']);

        $this->documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Community Terms',
            'slug' => 'terms',
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'login',
            'notify_on_update' => 1,
            'is_active' => 1,
        ]);

        $this->versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $this->documentId,
            'version_number' => '2.0',
            'content' => '<p>Use time credits fairly.</p>',
            'content_plain' => 'Use time credits fairly.',
            'effective_date' => '2026-01-01',
            'is_draft' => 0,
            'is_current' => 1,
            'published_at' => now(),
        ]);

        DB::table('legal_documents')
            ->where('id', $this->documentId)
            ->update(['current_version_id' => $this->versionId]);

        // The gate caches per (tenant, revision, user); a fresh revision keeps one
        // test's verdicts out of the next one's.
        LegalEnforcementService::bumpRevision($this->testTenantId);
    }

    private function member(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => 1,
        ], $attributes));

        Sanctum::actingAs($user, ['*']);
        LegalEnforcementService::forgetVerdict((int) $user->id, $this->testTenantId);

        return $user;
    }

    private function accept(User $user): void
    {
        DB::table('user_legal_acceptances')->insert([
            'user_id' => $user->id,
            'document_id' => $this->documentId,
            'version_id' => $this->versionId,
            'version_number' => '2.0',
            'acceptance_method' => 'login_prompt',
            'accepted_at' => now(),
        ]);
        LegalEnforcementService::forgetVerdict((int) $user->id, $this->testTenantId);
    }

    /** A gated write endpoint that needs no valid payload to reach the middleware. */
    private function guardedWrite()
    {
        return $this->apiPost('/v2/comments', []);
    }

    // ------------------------------------------------------------------
    //  Modes
    // ------------------------------------------------------------------

    public function test_off_mode_never_blocks(): void
    {
        config(['legal.enforcement_mode' => 'off']);
        $this->member();

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_an_unrecognised_mode_falls_back_to_enforcing(): void
    {
        // 🔴 This REVERSED on 2026-08-11 with the default. While the default was
        // `off`, the hazard was a typo silently starting to block members. Now that
        // enforcement is the legal baseline, the hazard is a typo silently switching
        // an obligation OFF — so it fails toward the obligation instead.
        config(['legal.enforcement_mode' => 'enforce-everything']);
        $this->member();

        $this->assertSame('write', EnsureLegalAcceptance::mode());
        $this->assertSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_an_unrecognised_mode_is_logged_rather_than_silently_accepted(): void
    {
        // Failing toward the obligation is right, but the operator still has to be
        // told their setting is wrong.
        config(['legal.enforcement_mode' => 'wrtie']);
        Log::spy();

        // The warning is guarded to fire once per process, so reset the guard to
        // make this test independent of whichever test ran before it.
        $guard = new \ReflectionProperty(EnsureLegalAcceptance::class, 'warnedAboutMode');
        $guard->setAccessible(true);
        $guard->setValue(null, false);

        EnsureLegalAcceptance::mode();

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => $message === 'legal.gate.invalid_mode'
                && ($context['configured'] ?? null) === 'wrtie'
                && ($context['using'] ?? null) === 'write');
    }

    public function test_the_shipped_default_mode_is_enforcing(): void
    {
        // 🔴 The whole point of the 2026-08-11 change: an installation that sets
        // nothing gets the COMPLIANT state. If this ever ships as `off` again, every
        // new installation silently stops meeting a legal obligation.
        //
        // Asserts the literal default in the config file rather than the resolved
        // value, because the resolved value depends on whichever `.env` the machine
        // happens to have — which would make this pass or fail for reasons that have
        // nothing to do with what we ship.
        $source = file_get_contents(base_path('config/legal.php'));

        $this->assertMatchesRegularExpression(
            "/'enforcement_mode'\s*=>\s*env\(\s*'LEGAL_ENFORCEMENT_MODE'\s*,\s*'write'\s*\)/",
            (string) $source,
            'The shipped default for LEGAL_ENFORCEMENT_MODE must be write (enforced).'
        );
    }

    public function test_write_mode_blocks_with_the_machine_code(): void
    {
        $this->member();

        $response = $this->guardedWrite();

        $response->assertStatus(403);
        $this->assertSame('LEGAL_ACCEPTANCE_REQUIRED', $response->json('errors.0.code'));
        $this->assertFalse($response->json('success'));
    }

    public function test_the_status_is_403_and_never_401(): void
    {
        // 🔴 A 401 tells every client the token is bad: web-uk clears all auth
        // cookies and burns a refresh token retrying something that cannot
        // succeed. The member IS authenticated — they have not agreed to
        // something.
        $this->member();

        $this->assertSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_report_mode_allows_the_request_but_flags_it(): void
    {
        config(['legal.enforcement_mode' => 'report']);
        $this->member();

        $response = $this->guardedWrite();

        $this->assertNotSame(403, $response->getStatusCode());
        $this->assertSame('1', $response->headers->get('X-Legal-Acceptance-Pending'));
    }

    public function test_report_mode_logs_above_the_default_log_threshold(): void
    {
        // 🔴 This is the whole point of report mode, and it was silently broken:
        // `Log::info` was used, but `config/logging.php` defaults every channel to
        // `level => env('LOG_LEVEL', 'warning')`, so the line was dropped on every
        // environment that has not deliberately lowered the threshold — including
        // production. The response header is set either way, so the mode LOOKED
        // like it worked while producing no evidence at all.
        config(['legal.enforcement_mode' => 'report']);
        $user = $this->member();

        // A spy rather than a strict expectation: it reports what WAS logged when
        // the assertion fails, instead of only that a matcher went unmatched.
        Log::spy();

        $this->guardedWrite();

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) use ($user) {
                return $message === 'legal.gate.would_block'
                    && (int) ($context['user_id'] ?? 0) === (int) $user->id
                    // Which client the member is using is the reason report mode
                    // exists: it says who would be bricked by enforcing.
                    && array_key_exists('client', $context)
                    && array_key_exists('user_agent', $context)
                    && array_key_exists('path', $context);
            });

        // 🔴 And never at `info`, which the default threshold discards.
        Log::shouldNotHaveReceived('info');
    }

    public function test_report_mode_sets_no_header_when_nothing_is_pending(): void
    {
        config(['legal.enforcement_mode' => 'report']);
        $user = $this->member();
        $this->accept($user);

        $this->assertNull($this->guardedWrite()->headers->get('X-Legal-Acceptance-Pending'));
    }

    // ------------------------------------------------------------------
    //  Who is exempt
    // ------------------------------------------------------------------

    public function test_a_member_who_has_accepted_passes_through(): void
    {
        $user = $this->member();
        $this->accept($user);

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_an_admin_passes_through_so_they_can_fix_the_documents(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'onboarding_completed' => 1,
        ]);
        Sanctum::actingAs($admin, ['*']);
        LegalEnforcementService::forgetVerdict((int) $admin->id, $this->testTenantId);

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_a_document_set_to_none_is_never_enforced(): void
    {
        // 🔴 `acceptance_required_for` has been written and validated since the
        // feature was built and read by NOTHING. A community setting a document to
        // `none` has been saying "do not gate on this" and being ignored.
        DB::table('legal_documents')
            ->where('id', $this->documentId)
            ->update(['acceptance_required_for' => 'none']);

        $this->member();

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_an_inactive_document_is_never_enforced(): void
    {
        DB::table('legal_documents')->where('id', $this->documentId)->update(['is_active' => 0]);

        $this->member();

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_a_document_not_requiring_acceptance_is_never_enforced(): void
    {
        DB::table('legal_documents')
            ->where('id', $this->documentId)
            ->update(['requires_acceptance' => 0]);

        $this->member();

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    // ------------------------------------------------------------------
    //  🔴 The exemption list — the gate must not lock the key inside
    // ------------------------------------------------------------------

    public function test_a_blocked_member_can_still_read_the_documents_and_accept(): void
    {
        $this->member();

        $this->apiGet('/v2/legal/terms')->assertStatus(200);
        $this->apiGet('/v2/legal/acceptance/status')->assertStatus(200);
        $this->assertContains(
            $this->apiPost('/v2/legal/acceptance/accept-all')->getStatusCode(),
            [200, 201]
        );
    }

    public function test_a_blocked_member_can_still_load_the_shell_chrome(): void
    {
        // 🔴 web-uk requests these on EVERY render, including the acceptance
        // interstitial. Gate them and the interstitial cannot render, so the
        // member can never reach the button that clears the gate.
        $this->member();

        foreach ([
            '/v2/users/me',
            '/v2/notifications/counts',
            '/v2/messages/unread-count',
        ] as $path) {
            $this->assertNotSame(
                403,
                $this->apiGet($path)->getStatusCode(),
                "{$path} is shell chrome and must never be gated."
            );
        }
    }

    public function test_a_blocked_member_can_still_sign_out(): void
    {
        $this->member();

        $this->assertNotSame(403, $this->apiPost('/auth/logout')->getStatusCode());
    }

    // ------------------------------------------------------------------
    //  🔴 Cache invalidation — the loop this must not create
    // ------------------------------------------------------------------

    public function test_accepting_then_immediately_retrying_the_blocked_action_succeeds(): void
    {
        // 🔴 THE test. Without verdict invalidation in acceptAll the member
        // accepts, retries, and is blocked again by their own cached verdict —
        // accept → blocked → accept, with no way out but waiting for the TTL.
        $this->member();

        $this->assertSame(403, $this->guardedWrite()->getStatusCode());

        $this->apiPost('/v2/legal/acceptance/accept-all');

        $this->assertNotSame(
            403,
            $this->guardedWrite()->getStatusCode(),
            'Accepting did not clear the cached verdict — this is the accept/blocked loop.'
        );
    }

    public function test_publishing_a_new_version_blocks_a_member_who_had_already_accepted(): void
    {
        $user = $this->member();
        $this->accept($user);
        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());

        $newVersionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $this->documentId,
            'version_number' => '3.0',
            'content' => '<p>Updated wording.</p>',
            'content_plain' => 'Updated wording.',
            'effective_date' => '2026-06-01',
            'is_draft' => 1,
        ]);

        \App\Services\LegalDocumentService::publishVersion($newVersionId);

        // The revision bump inside publishVersion is what makes this work with no
        // per-user fan-out. A missed bump means the newly published document does
        // not block anybody, which is the case the gate exists for.
        $this->assertSame(
            403,
            $this->guardedWrite()->getStatusCode(),
            'Publishing a version did not invalidate cached verdicts.'
        );
    }

    // ------------------------------------------------------------------
    //  🔴 Failing open
    // ------------------------------------------------------------------

    public function test_no_enforced_modes_configured_means_nothing_is_enforced(): void
    {
        config(['legal.enforced_acceptance_modes' => []]);
        $this->member();

        $this->assertNotSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_a_verdict_failure_lets_the_request_through(): void
    {
        // 🔴 Opposite of EnsureOnboardingComplete, which ENFORCES when its config
        // lookup throws. This gate sits on ordinary member writes: firing because
        // a dependency blinked would take the product down, which is worse than
        // one more write landing before somebody accepts.
        //
        // A real throw, not an empty-config short-circuit — the cache is replaced
        // with one that fails the way a dead Redis would.
        $this->app->bind(\App\Services\RedisCache::class, fn () => new class extends \App\Services\RedisCache {
            public function get(string $key, ?int $tenantId = null): mixed
            {
                throw new \RuntimeException('Connection refused');
            }
        });

        $user = $this->member();

        // Proves this is not passing for the wrong reason: the database really does
        // hold a pending document for this member, so the only thing letting them
        // through is the swallowed cache failure.
        $this->assertNotSame(
            [],
            LegalEnforcementService::pendingForEnforcement((int) $user->id, $this->testTenantId),
            'Fixture is wrong: nothing was pending, so this test proves nothing.'
        );
        $this->assertFalse(LegalEnforcementService::isBlocked((int) $user->id, $this->testTenantId));

        $this->assertNotSame(
            403,
            $this->guardedWrite()->getStatusCode(),
            'The gate must fail OPEN — a cache outage must not stop members using the platform.'
        );
    }

    public function test_a_blocked_member_is_still_blocked_when_only_the_verdict_write_fails(): void
    {
        // The inverse guard: failing open must be about not being ABLE to decide,
        // never about the decision itself. A cache that can read but not write
        // still produces a correct verdict, so the member stays blocked.
        $this->app->bind(\App\Services\RedisCache::class, fn () => new class extends \App\Services\RedisCache {
            public function set(string $key, mixed $value, int $ttl = 300, ?int $tenantId = null): bool
            {
                return false;
            }
        });

        $this->member();

        $this->assertSame(403, $this->guardedWrite()->getStatusCode());
    }

    public function test_enforcement_ignores_another_tenants_documents(): void
    {
        // The document belongs to the test tenant; a member of a different tenant
        // must not be gated by it.
        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        if (!$otherTenantId) {
            $this->markTestSkipped('No second tenant in the test database.');
        }

        $pending = LegalEnforcementService::pendingForEnforcement(999999, $otherTenantId);

        $this->assertSame([], $pending);
    }
}
