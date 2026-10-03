<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Http\Middleware\RequireRecentSecondFactor;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Support\Facades\Route;

/**
 * Security register E-085: before a high-risk staff action the server asks for
 * a second factor entered recently. A remembered device or a password alone
 * is not enough; a fresh code, or a confirmation minted from one, is.
 */
class StaffStepUpTest extends TwoFactorAuditTestCase
{
    private const CODE = RequireRecentSecondFactor::ERROR_CODE;

    /** @return array<string,string> */
    private function bearerWith(User $user, string $method, int $verifiedAt): array
    {
        return ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $user->id,
            $user->tenant_id,
            ['mfa_method' => $method, 'mfa_verified_at' => $verifiedAt]
        )];
    }

    private function confirmation(User $user, string $method): string
    {
        return app(TokenService::class)->generateSecurityConfirmationToken($user->id, $user->tenant_id, $method);
    }

    public function test_remembered_device_session_is_asked_to_confirm_before_banning(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();

        $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $this->bearerWith($admin, 'trusted_device', time() - 60))
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE)
            ->assertJsonPath('errors.0.field', 'security_confirmation');
        $this->assertNotSame('banned', User::query()->whereKey($target->id)->value('status'));
    }

    public function test_code_entered_long_ago_is_asked_again(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();

        $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $this->bearerWith($admin, 'totp', time() - 3600))
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
    }

    public function test_code_entered_recently_passes_without_a_prompt(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();

        $response = $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $this->bearerWith($admin, 'totp', time() - 60));
        $this->assertNotSame(self::CODE, $response->json('errors.0.code'));
        $response->assertOk();
    }

    public function test_confirmation_from_a_code_unlocks_the_action(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();
        $headers = $this->bearerWith($admin, 'trusted_device', time() - 86400)
            + ['X-Security-Confirmation' => $this->confirmation($admin, 'totp')];

        $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $headers)->assertOk();
    }

    public function test_password_only_confirmation_is_not_a_second_factor(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();
        $headers = $this->bearerWith($admin, 'trusted_device', time() - 86400)
            + ['X-Security-Confirmation' => $this->confirmation($admin, 'password')];

        $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $headers)
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
    }

    public function test_another_users_confirmation_is_refused(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $otherAdmin = $this->member(['role' => 'admin']);
        $target = $this->member();
        $headers = $this->bearerWith($admin, 'trusted_device', time() - 86400)
            + ['X-Security-Confirmation' => $this->confirmation($otherAdmin, 'totp')];

        $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $headers)
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
    }

    public function test_a_member_is_refused_by_the_role_gate_not_prompted(): void
    {
        $member = $this->member();
        $target = $this->member();

        $response = $this->apiPost("/v2/admin/users/{$target->id}/ban", ['reason' => 'Repeated abuse of members'], $this->bearerWith($member, 'totp', time() - 3600));
        $response->assertStatus(403);
        $this->assertNotSame(self::CODE, $response->json('errors.0.code'));
    }

    public function test_resetting_someone_elses_2fa_keeps_its_five_minute_rule(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member();
        $this->enrol($target);
        $body = ['reason' => 'Member lost their phone and asked for help'];

        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", $body, $this->bearerWith($admin, 'totp', time() - 600))
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
        $this->apiPost("/v2/admin/users/{$target->id}/reset-2fa", $body, $this->bearerWith($admin, 'totp', time() - 30))
            ->assertOk();
    }

    public function test_changing_a_role_asks_but_saving_an_unchanged_profile_does_not(): void
    {
        $admin = $this->member(['role' => 'admin']);
        $target = $this->member(['role' => 'member', 'first_name' => 'Old']);
        $stale = $this->bearerWith($admin, 'trusted_device', time() - 86400);

        $this->apiPut("/v2/admin/users/{$target->id}", [
            'first_name' => 'New', 'role' => 'member', 'email' => $target->email,
        ], $stale)->assertOk();

        $this->apiPut("/v2/admin/users/{$target->id}", ['role' => 'broker'], $stale)
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
        $this->assertSame('member', User::query()->whereKey($target->id)->value('role'));

        $this->apiPut("/v2/admin/users/{$target->id}", ['email' => 'changed-' . $target->email], $stale)
            ->assertStatus(403)->assertJsonPath('errors.0.code', self::CODE);
    }

    public function test_every_listed_high_risk_route_carries_the_check(): void
    {
        $expected = [
            'POST v2/admin/users/{id}/reset-2fa',
            'DELETE v2/admin/users/{id}',
            'POST v2/admin/users/{id}/ban',
            'POST v2/admin/users/{id}/password',
            'PUT v2/admin/users/{id}/super-admin',
            'PUT v2/admin/users/{id}/global-super-admin',
            'POST v2/admin/users/{id}/impersonate',
            'POST v2/admin/super/users/{id}/impersonate',
            'PUT v2/admin/config/authentication/bulk',
            'POST v2/admin/timebanking/adjust-balance',
            'POST v2/admin/wallet/grant',
            'POST v2/admin/broker/exchanges/{id}/reverse',
            'POST v2/admin/super/users/{id}/grant-super-admin',
            'POST v2/admin/super/users/{id}/grant-global-super-admin',
            'POST v2/admin/super/tenants/{id}/purge',
            'PUT v2/admin/sso/providers/{providerKey}',
            'POST v2/admin/api-partners/{id}/regenerate-credentials',
        ];
        $guarded = [];
        foreach (Route::getRoutes() as $route) {
            $hasStepUp = collect($route->gatherMiddleware())
                ->contains(fn ($m) => is_string($m) && str_starts_with($m, 'step-up'));
            if ($hasStepUp) {
                foreach ($route->methods() as $method) {
                    $guarded[] = $method . ' ' . preg_replace('#^api/#', '', $route->uri());
                }
            }
        }
        foreach ($expected as $route) {
            $this->assertContains($route, $guarded, "{$route} must ask for a recent second factor");
        }
    }
}
