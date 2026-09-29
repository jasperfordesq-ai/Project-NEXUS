<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Core\TenantContext;
use App\Http\Controllers\Api\NotificationUnsubscribeController;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-321 (E-062 L-2): the unsubscribe link on platform email performed the
 * change on a bare GET, so a corporate link scanner or a mail-preview fetch
 * silently turned a member's notifications off. The GET must now be
 * read-only and show a confirmation; the change happens only on a POST —
 * either the confirmation page's button or a mail client's RFC 8058
 * one-click `List-Unsubscribe-Post`, which Mailer sends and which must keep
 * working. A link from an email already sent (same token format) must still
 * reach the confirmation step.
 */
class F321UnsubscribeRequiresConfirmationTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'preferred_language' => 'en',
            'notification_preferences' => [
                'email_messages' => true,
                'email_events' => true,
                'email_transactions' => true,
            ],
        ]);
    }

    private function token(User $user, string $category = 'all'): string
    {
        TenantContext::setById($this->testTenantId);
        $url = NotificationUnsubscribeController::buildSignedUrl((int) $user->id, $this->testTenantId, $category);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        return (string) ($query['token'] ?? '');
    }

    /** @return array<string, mixed> */
    private function prefs(User $user): array
    {
        $raw = DB::table('users')->where('id', $user->id)->value('notification_preferences');

        return json_decode((string) $raw, true) ?: [];
    }

    public function test_a_bare_get_changes_nothing_and_asks_for_confirmation(): void
    {
        $user = $this->member();
        $token = $this->token($user);

        // Two fetches, as a link scanner and then a preview pane would do.
        $first = $this->apiGet('/v2/notifications/unsubscribe?token=' . rawurlencode($token));
        $this->apiGet('/v2/notifications/unsubscribe?token=' . rawurlencode($token));

        $first->assertStatus(200);
        $first->assertSee('<form method="post"', false);
        $first->assertSee('name="confirm" value="1"', false);
        $first->assertSee(__('api.notification_unsubscribe.button_confirm'));
        $first->assertDontSee(__('api.notification_unsubscribe.title_unsubscribed'));

        $prefs = $this->prefs($user);
        $this->assertTrue((bool) $prefs['email_messages'], 'a GET must not turn email off');
        $this->assertTrue((bool) $prefs['email_events']);
        $this->assertTrue((bool) $prefs['email_transactions']);
    }

    public function test_control_confirming_on_the_page_unsubscribes(): void
    {
        $user = $this->member();
        $token = $this->token($user);

        $response = $this->post('/api/v2/notifications/unsubscribe?token=' . rawurlencode($token), [
            'token' => $token,
            'confirm' => '1',
        ], $this->withTenantHeader());

        $response->assertStatus(200);
        $this->assertStringContainsString('text/html', (string) $response->headers->get('Content-Type'));
        $response->assertSee(__('api.notification_unsubscribe.title_unsubscribed'));

        $prefs = $this->prefs($user);
        $this->assertFalse((bool) $prefs['email_messages']);
        $this->assertFalse((bool) $prefs['email_events']);
        $this->assertFalse((bool) $prefs['email_transactions']);
    }

    public function test_control_rfc8058_one_click_post_still_unsubscribes(): void
    {
        $user = $this->member();
        $token = $this->token($user, 'messages');

        // What a mail client sends for List-Unsubscribe-Post: a form body of
        // List-Unsubscribe=One-Click to the List-Unsubscribe URL.
        $response = $this->post('/api/v2/notifications/unsubscribe?token=' . rawurlencode($token), [
            'List-Unsubscribe' => 'One-Click',
        ], $this->withTenantHeader());

        $response->assertStatus(200);
        $response->assertJsonPath('data.unsubscribed', true);
        $response->assertJsonPath('data.category', 'messages');

        $prefs = $this->prefs($user);
        $this->assertFalse((bool) $prefs['email_messages']);
        $this->assertTrue((bool) $prefs['email_events'], 'only the named category changes');
    }

    public function test_control_a_forged_token_is_refused_on_both_verbs(): void
    {
        $user = $this->member();
        $token = $this->token($user);
        $forged = rtrim(strtr(base64_encode($user->id . '.' . $this->testTenantId . '.all.' . str_repeat('0', 64)), '+/', '-_'), '=');

        $this->apiGet('/v2/notifications/unsubscribe?token=' . rawurlencode($forged))
            ->assertStatus(400)
            ->assertDontSee('<form', false);
        $this->post('/api/v2/notifications/unsubscribe', ['token' => $forged, 'confirm' => '1'], $this->withTenantHeader())
            ->assertStatus(400);
        $this->post('/api/v2/notifications/unsubscribe?token=' . rawurlencode($forged), [], $this->withTenantHeader())
            ->assertStatus(400);

        $this->assertTrue((bool) $this->prefs($user)['email_messages']);
        $this->assertNotSame('', $token);
    }

    public function test_an_already_unsubscribed_member_is_told_so_without_a_button(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'notification_preferences' => ['email_events' => false],
        ]);
        $token = $this->token($user, 'events');

        $response = $this->apiGet('/v2/notifications/unsubscribe?token=' . rawurlencode($token));

        $response->assertStatus(200);
        $response->assertSee(__('api.notification_unsubscribe.title_already'));
        $response->assertDontSee('<form', false);
    }
}
