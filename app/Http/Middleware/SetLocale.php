<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Carbon\Carbon;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Auth;
use App\I18n\FormattingLocale;
use App\I18n\Translator;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolve the request locale for API responses and admin views.
 *
 * Priority (highest first):
 *   1. ?locale=xx  query parameter
 *   2. Authenticated user's saved language preference
 *   3. Accept-Language header (best match)
 *   4. Application default ('en')
 */
class SetLocale
{
    public const SUPPORTED_LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];

    public function handle(Request $request, Closure $next): Response
    {
        $locale = $this->resolveLocale($request);

        App::setLocale($locale);
        Translator::setLocale($locale);
        // Dates rendered during this request follow the same locale, with the
        // community's region supplied — a bare language code formats as US
        // English. See App\I18n\FormattingLocale.
        Carbon::setLocale(FormattingLocale::carbon($locale));

        /** @var Response $response */
        $response = $next($request);
        // Read the locale back rather than reusing the value resolved above: the
        // request may have refined it once the JWT holder became known (see
        // applyUserPreference), and the header must describe what was actually
        // rendered.
        $response->headers->set('Content-Language', App::getLocale());

        return $response;
    }

    /**
     * Re-resolve the locale once the authenticated user is known.
     *
     * This middleware is registered on the api middleware GROUP, which wraps and
     * therefore runs before route middleware. At that point the bearer JWT has
     * not been validated and no guard holds a user, so tier 2 below cannot fire
     * and resolution silently falls through to Accept-Language — following the
     * browser's language instead of the one the member chose in the app.
     *
     * App\Http\Middleware\Authenticate calls this as soon as it resolves the
     * token holder, which is the earliest point the saved preference is known.
     * Reordering middleware instead would change behaviour for every
     * unauthenticated route as well, so the refinement happens here.
     *
     * An explicit, supported ?locale= still wins: that is tier 1, used for
     * deliberate overrides such as previewing another language.
     */
    public static function applyUserPreference(Request $request, mixed $user): void
    {
        $queryLocale = $request->query('locale');
        if (is_string($queryLocale) && in_array($queryLocale, self::SUPPORTED_LOCALES, true)) {
            return;
        }

        $language = is_object($user) ? ($user->preferred_language ?? null) : null;
        if (!is_string($language) || $language === '' || !in_array($language, self::SUPPORTED_LOCALES, true)) {
            return;
        }

        App::setLocale($language);
        Translator::setLocale($language);
        Carbon::setLocale(FormattingLocale::carbon($language));
    }

    private function resolveLocale(Request $request): string
    {
        // 1. Explicit query parameter
        $queryLocale = $request->query('locale');
        if ($queryLocale && in_array($queryLocale, self::SUPPORTED_LOCALES, true)) {
            return $queryLocale;
        }

        // 2. Authenticated user's saved preference
        $user = Auth::user();
        if ($user && !empty($user->preferred_language) && in_array($user->preferred_language, self::SUPPORTED_LOCALES, true)) {
            return $user->preferred_language;
        }

        // 3. Accept-Language header
        $preferred = $request->getPreferredLanguage(self::SUPPORTED_LOCALES);
        if ($preferred) {
            return $preferred;
        }

        // 4. Fallback
        return config('app.locale', 'en');
    }
}
