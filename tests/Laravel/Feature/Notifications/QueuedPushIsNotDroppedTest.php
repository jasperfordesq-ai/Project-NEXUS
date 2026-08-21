<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Notifications;

use App\Services\NotificationDispatcher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * 🔴 A push dispatched outside an HTTP request must actually send.
 *
 * `NotificationDispatcher::fanOutPush()` defers the send with
 * `dispatch($send)->afterResponse()` so a web request never waits on a push provider.
 * That is correct for HTTP. It is silently fatal everywhere else: in a queue worker or an
 * artisan command there is no response to come after, so the closure is registered against
 * nothing and discarded.
 *
 * The guard was `try { … } catch { $send(); }`, which never fired, because
 * `afterResponse()` does not throw outside a request — it succeeds and waits forever.
 *
 * **What it cost.** `App\Listeners\NotifyMessageReceived` is `ShouldQueue`, so every
 * "someone sent you a message" push was dropped. Confirmed in production on 2026-08-21:
 * bell notification 6175 (`new_message`, 2026-08-20 18:41:34) exists for the owner and
 * `push_log` holds no row for that moment — not a failed send, no send at all. Pushes that
 * did arrive (`like`, `new_user_registered`, `achievement`) all originated inside an HTTP
 * request.
 *
 * This test asserts the observable consequence — a `push_log` row exists — rather than
 * mocking the dispatcher, because the defect was precisely that a mocked-looking success
 * produced no real effect. The test suite runs in console context, which is the same
 * context a queue worker uses, so it exercises the fixed branch directly.
 */
class QueuedPushIsNotDroppedTest extends TestCase
{
    use DatabaseTransactions;

    /** Isolated from tenant 2 so pre-existing rows cannot satisfy the assertion. */
    protected int $pushTenantId = 997;

    /**
     * 🔴 The recipient MUST have a device token, or this test proves nothing.
     *
     * `PushLog::record()` deliberately returns without writing when nothing was sent and
     * nothing failed ("no targets / push disabled — not a delivery event"). A recipient
     * with no token therefore produces no row even when the send closure runs perfectly,
     * so an assertion on row count would pass or fail for the wrong reason. Seeding a
     * token guarantees a send is ATTEMPTED — it will fail for want of credentials in the
     * test environment, and a failure is a delivery event, which is what makes the row
     * appear and the test meaningful.
     */
    private function seedRecipient(): int
    {
        // 🔴 The tenant MUST be created here, not assumed. Without this the insert
        // below fails on `users_ibfk_1` (tenant_id -> tenants.id) and the whole
        // class errors. It passed locally only because tenant 997 happened to
        // already exist in the developer's test database, left behind by a
        // sibling suite that DOES create it
        // (ResendStuckVerificationEmailsTest::seedPendingUser). In CI's fresh
        // database, and in any sharded subset that does not happen to include
        // that suite, tenant 997 does not exist — which is exactly the
        // order-dependent isolation debt the quarantine list already tracks.
        // `insertOrIgnore` keeps it safe when both suites run in the same shard.
        DB::table('tenants')->insertOrIgnore([
            'id' => $this->pushTenantId,
            'name' => 'Queued Push Test Tenant ' . $this->pushTenantId,
            'slug' => 'queued-push-test-' . $this->pushTenantId,
            'domain' => null,
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->pushTenantId,
            'email' => 'queued-push-' . uniqid('', false) . '@project-nexus.local',
            'password_hash' => password_hash('irrelevant', PASSWORD_BCRYPT),
            'first_name' => 'Queued',
            'last_name' => 'Push',
            'status' => 'active',
            'created_at' => now(),
        ]);

        DB::table('fcm_device_tokens')->insert([
            'user_id' => $userId,
            'tenant_id' => $this->pushTenantId,
            'token' => 'ExponentPushToken[queued-push-regression-probe]',
            'platform' => 'android',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $userId;
    }

    public function test_a_push_from_console_context_is_recorded_rather_than_discarded(): void
    {
        // The suite runs in console context — the same context as `queue:work`.
        $this->assertTrue(
            app()->runningInConsole(),
            'This test only means anything in console context, which is what a queue worker uses.'
        );

        $userId = $this->seedRecipient();

        // 🔴 Set the tenant, because the queued listener does. `NotifyMessageReceived`
        // calls `TenantContext::setById($event->tenantId)` before `fanOutPush` — so a test
        // with no tenant context is not reproducing the real path, and its token lookup
        // would find nothing for a reason the product never hits. An earlier version of
        // this test omitted it and failed for that wrong reason.
        \App\Core\TenantContext::setById($this->pushTenantId);

        $before = (int) DB::table('push_log')->where('user_id', $userId)->count();
        $this->assertSame(0, $before, 'Fresh recipient should start with no push_log rows.');

        NotificationDispatcher::fanOutPush(
            $userId,
            'new_message',
            'Queued push regression probe',
            '/messages/1'
        );

        $after = (int) DB::table('push_log')->where('user_id', $userId)->count();

        $this->assertSame(
            1,
            $after,
            'fanOutPush() produced no push_log row from console context. That is the '
            . 'regression: the send was deferred to an HTTP response that never arrives '
            . 'outside a web request, so every push from a queued listener is dropped '
            . 'with nothing reporting it.'
        );
    }

    /**
     * 🔴 A SHAPE guard, and it says so, because this one cannot be exercised from here.
     *
     * The send is wrapped in `TenantContext::runForTenant($tid, …)` so it finds the
     * recipient's device tokens even when the ambient tenant has moved on — which is the
     * case on the HTTP path, where the closure runs after the response and after the
     * caller restored its previous tenant.
     *
     * Removing that wrapper does NOT fail the behavioural test above, because in console
     * context the send runs inline while the listener's tenant is still set. So the wrap
     * is belt to the braces, unproven by execution here, and guarded by shape instead of
     * being left to survive on someone remembering why it is there. If a future change
     * makes the deferred path testable, replace this with a real assertion.
     */
    public function test_the_send_is_wrapped_in_the_captured_tenant(): void
    {
        $source = file_get_contents(base_path('app/Services/NotificationDispatcher.php'));

        $this->assertIsString($source);
        $this->assertStringContainsString(
            'TenantContext::runForTenant($tid, $deliver)',
            $source,
            'The push send is no longer wrapped in the captured tenant. FCMPushService looks '
            . 'tokens up by TenantContext::getId(), so on the deferred HTTP path it would '
            . 'find none, report "sent 0, failed 0", and PushLog would write no row — a '
            . 'silent non-delivery that looks like nothing happened.'
        );
    }

    public function test_new_message_has_a_curated_push_title_so_the_auto_path_does_not_skip_it(): void
    {
        // 🔴 `fanOutPush(..., onlyCurated: true)` skips any activity type with no
        // `notifications.push_<type>` title. If this key were ever removed, message pushes
        // would stop again — by a completely different mechanism, and just as silently.
        $key = 'notifications.push_new_message';

        $this->assertNotSame(
            $key,
            __($key),
            'notifications.push_new_message is missing, so the curated-only push path will '
            . 'skip message notifications entirely.'
        );
    }
}
