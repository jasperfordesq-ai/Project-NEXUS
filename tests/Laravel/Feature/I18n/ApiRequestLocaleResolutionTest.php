<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\I18n;

use App\Models\User;
use App\Services\TokenService;
use Tests\Laravel\TestCase;

/**
 * Pins how SetLocale resolves the locale for API requests.
 *
 * Every translated API message depends on this, so it is worth pinning rather
 * than assuming. SetLocale documents four tiers: ?locale=, the authenticated
 * user's preferred_language, Accept-Language, then the app default.
 *
 * The subtlety these tests exist to capture: SetLocale is prepended to the api
 * middleware GROUP, so it runs BEFORE route middleware such as auth:sanctum.
 * Whether tier 2 can fire therefore depends on whether the default guard has
 * resolved a user by that point. Sanctum::actingAs() calls shouldUse('sanctum'),
 * which makes Auth::user() resolve in tests and would hide a production gap, so
 * these tests deliberately use a real bearer token instead.
 *
 * The observable is the Content-Language response header, which SetLocale sets
 * from whatever it resolved.
 */
class ApiRequestLocaleResolutionTest extends TestCase
{
    public function test_explicit_locale_query_parameter_wins(): void
    {
        $response = $this->getJson('/api/v2/health?locale=fr');

        self::assertSame('fr', $response->headers->get('Content-Language'));
    }

    public function test_accept_language_header_is_honoured_for_anonymous_requests(): void
    {
        $response = $this->getJson('/api/v2/health', ['Accept-Language' => 'de']);

        self::assertSame('de', $response->headers->get('Content-Language'));
    }

    public function test_unsupported_accept_language_falls_back_to_english(): void
    {
        $response = $this->getJson('/api/v2/health', ['Accept-Language' => 'xx-ZZ']);

        self::assertSame('en', $response->headers->get('Content-Language'));
    }

    /**
     * The one that matters for translated server messages.
     *
     * A user whose saved language differs from their browser language should get
     * their SAVED language. If this resolves 'fr' (the browser) rather than 'de'
     * (the saved preference), tier 2 never fires for real API requests and every
     * translated API string is quietly following the browser instead.
     *
     * Uses a real short-lived JWT from TokenService, which is what the React app
     * actually sends. Sanctum personal access tokens were retired (see the class
     * comment on App\Http\Middleware\Authenticate), so createToken() would 401 —
     * and Sanctum::actingAs() would call shouldUse('sanctum') and mask the bug.
     */
    public function test_saved_language_preference_beats_the_browser_header(): void
    {
        $user = User::factory()->create([
            'tenant_id' => 2,
            'preferred_language' => 'de',
            'status' => 'active',
            'is_approved' => 1,
        ]);

        $token = app(TokenService::class)->generateToken((int) $user->id, 2);

        $response = $this->getJson('/api/v2/users/me', [
            'Authorization' => 'Bearer ' . $token,
            'Accept-Language' => 'fr',
        ]);

        // Guard the guard: if this request is not authenticated then the locale
        // assertion below proves nothing about tier 2.
        self::assertSame(
            200,
            $response->getStatusCode(),
            'Test setup problem, not a locale finding: the JWT did not authenticate, so this says '
            . 'nothing about the authenticated locale tier. Body: ' . substr((string) $response->getContent(), 0, 200)
        );

        $resolved = $response->headers->get('Content-Language');

        self::assertSame(
            'de',
            $resolved,
            'An authenticated API request resolved the locale as "' . $resolved . '" (the Accept-Language '
            . 'header) instead of "de" (the user\'s saved preferred_language). SetLocale is registered on the '
            . 'api middleware GROUP, so it runs before the route\'s Authenticate middleware validates the JWT '
            . 'and resolves the user. Server-rendered API messages therefore follow the browser language, not '
            . 'the language the member chose in the app.'
        );
    }
}
