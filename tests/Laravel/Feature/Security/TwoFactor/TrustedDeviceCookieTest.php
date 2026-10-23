<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\TwoFactor;

use App\Models\User;
use App\Services\AuthenticationConfigurationService as Settings;
use App\Services\TotpService;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * "Trust this device" in a browser must keep working for every account the
 * browser has trusted, whatever else the browser signs into.
 *
 * Until 23 Oct 2026 a browser held ONE remembered-device cookie per website
 * address. A second account trusted on the same address (another community on
 * app.project-nexus.ie, or a staff member's second login) overwrote the first,
 * and the first account was asked for its code again with nothing revoked and
 * nothing logged.
 */
class TrustedDeviceCookieTest extends TwoFactorAuditTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Settings::set(Settings::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES, true, $this->testTenantId);
    }

    /** Complete a browser sign-in with "trust this device" ticked; returns the cookie set. */
    private function trustInBrowser(User $user, string $secret, int $step = 0): Cookie
    {
        $this->browserCookies([]);
        $response = $this->apiPost('/totp/verify', [
            'two_factor_token' => $this->challenge($user),
            'code' => $this->code($secret, $step),
            'trust_device' => true,
        ])->assertOk();
        $cookies = array_values(array_filter(
            $response->headers->getCookies(),
            fn (Cookie $c) => str_starts_with($c->getName(), '__Host-nexus_td_')
        ));
        $this->assertCount(1, $cookies, 'one remembered-device cookie per trusted sign-in');

        return $cookies[0];
    }

    /** Replace the browser's cookie jar for the next request. */
    private function browserCookies(array $cookies): void
    {
        $this->withCredentials();
        $this->unencryptedCookies = $cookies;
        $this->defaultCookies = [];
    }

    private function loginAsks(User $user): bool
    {
        return $this->apiPost('/auth/login', ['email' => $user->email, 'password' => 'test-password'])
            ->assertOk()->json('requires_2fa') === true;
    }

    public function test_two_accounts_trusted_in_one_browser_both_stay_trusted(): void
    {
        $alice = $this->member();
        $bob = $this->member();
        $aliceCookie = $this->trustInBrowser($alice, $this->enrol($alice));
        $bobCookie = $this->trustInBrowser($bob, $this->enrol($bob));

        $this->assertNotSame($aliceCookie->getName(), $bobCookie->getName(), 'each account needs its own cookie, or the second overwrites the first');

        $jar = [$aliceCookie->getName() => $aliceCookie->getValue(), $bobCookie->getName() => $bobCookie->getValue()];
        $this->browserCookies($jar);
        $this->assertFalse($this->loginAsks($alice), 'Alice was asked for a code on a device she trusted');
        $this->browserCookies($jar);
        $this->assertFalse($this->loginAsks($bob), 'Bob was asked for a code on a device he trusted');
    }

    public function test_one_accounts_cookie_never_vouches_for_another(): void
    {
        $alice = $this->member();
        $bob = $this->member();
        $this->enrol($bob);
        $aliceCookie = $this->trustInBrowser($alice, $this->enrol($alice));

        // Even presented under Bob's cookie name, Alice's token is Alice's.
        $this->browserCookies([TotpService::trustedDeviceCookieName($this->testTenantId, $bob->id) => $aliceCookie->getValue()]);
        $this->assertTrue($this->loginAsks($bob));
    }

    public function test_cookie_is_host_only_secure_and_lax_whatever_the_session_domain(): void
    {
        // A configured session domain must never leak onto this cookie: on a
        // community's own domain the browser would silently refuse to store it.
        config(['session.domain' => '.project-nexus.ie', 'session.same_site' => 'strict']);
        $member = $this->member();
        $cookie = $this->trustInBrowser($member, $this->enrol($member));

        $this->assertNull($cookie->getDomain(), 'host-only: no Domain attribute');
        $this->assertSame('/', $cookie->getPath());
        $this->assertTrue($cookie->isSecure());
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', strtolower((string) $cookie->getSameSite()));

        // The cookie lasts exactly as long as the server will honour it.
        $row = DB::table('user_trusted_devices')->where('user_id', $member->id)->orderByDesc('id')->first();
        $this->assertEqualsWithDelta(strtotime((string) $row->expires_at), $cookie->getExpiresTime(), 120);
        $this->assertEqualsWithDelta(time() + 30 * 86400, $cookie->getExpiresTime(), 120);
    }

    public function test_devices_trusted_before_this_change_are_still_honoured(): void
    {
        // Browsers already holding the old single cookie must not be asked again.
        $member = $this->member();
        $this->enrol($member);
        $legacy = TotpService::trustDevice($member->id, null, $this->testTenantId);
        $this->assertIsString($legacy);

        $this->browserCookies(['nexus_trusted_device' => $legacy]);
        $this->assertFalse($this->loginAsks($member));
    }

    public function test_forgetting_devices_clears_this_accounts_cookie_and_the_legacy_one(): void
    {
        $member = $this->member();
        $cookie = $this->trustInBrowser($member, $this->enrol($member));

        $this->browserCookies([]);
        $response = $this->apiPost('/v2/auth/2fa/trusted-devices/revoke', [], $this->bearer($member, true))->assertOk();
        $cleared = collect($response->headers->getCookies())
            ->filter(fn (Cookie $c) => $c->isCleared())
            ->map(fn (Cookie $c) => $c->getName())
            ->all();
        $this->assertContains($cookie->getName(), $cleared);
        $this->assertContains('nexus_trusted_device', $cleared);

        $this->browserCookies([$cookie->getName() => $cookie->getValue()]);
        $this->assertTrue($this->loginAsks($member));
    }

    public function test_expiry_is_measured_by_the_database_clock(): void
    {
        // expires_at used to come from PHP's clock and be compared with the
        // database's NOW(). Any timezone difference between the two shortened
        // or lengthened every trusted device by that many hours.
        $member = $this->member();
        $this->trustInBrowser($member, $this->enrol($member));
        $row = DB::selectOne(
            "SELECT TIMESTAMPDIFF(MINUTE, trusted_at, expires_at) AS minutes
             FROM user_trusted_devices WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            [$member->id]
        );
        $this->assertEqualsWithDelta(30 * 1440, (int) $row->minutes, 2);
    }
}
