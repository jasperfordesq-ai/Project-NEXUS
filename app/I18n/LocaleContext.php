<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\I18n;

use Carbon\Carbon;
use Illuminate\Support\Facades\App;

/**
 * LocaleContext — temporarily switch Laravel's active locale for a block of work.
 *
 * Laravel's `__()` helper resolves translations against `App::getLocale()` at call
 * time. Without this helper, email/notification services that loop over recipients
 * call `__('emails.foo')` in the *caller's* locale, not the recipient's — so every
 * notification goes out in whatever language the sender or cron worker happens to
 * be in, regardless of the recipient's `users.preferred_language`.
 *
 * Usage — wrap the render + send sequence so every nested `__()` call resolves
 * against the recipient's locale:
 *
 *   LocaleContext::withLocale($user->preferred_language, function () use ($user) {
 *       $subject = __('emails.events.update_subject', ['title' => $event->title]);
 *       $body    = EmailTemplateBuilder::make()->greeting($user->first_name)->...->render();
 *       $mailer->send($user->email, $subject, $body);
 *   });
 *
 * The locale is restored in a `finally` block even if the callable throws, so the
 * caller's locale is never leaked.
 *
 * Accepts a string locale code ('en', 'ga', etc.), a User-like object exposing
 * `->preferred_language`, or null (treated as the app default 'en').
 *
 * Nested invocations are safe — each level saves and restores its own snapshot.
 */
final class LocaleContext
{
    /**
     * Run a callable with the active Laravel locale temporarily switched.
     *
     * @template T
     * @param  string|object|null $locale  Locale code ('en'), a User-like object with
     *                                     `->preferred_language`, or null (no switch).
     * @param  callable(): T      $fn      Work to run under the switched locale.
     * @return T
     */
    public static function withLocale(string|object|null $locale, callable $fn): mixed
    {
        $resolved = self::resolve($locale);

        // Null means "no switch" — caller passed null explicitly, run as-is.
        if ($resolved === null) {
            return $fn();
        }

        $previous = App::getLocale();
        $previousJsonLocale = Translator::getLocale();
        $previousDateLocale = Carbon::getLocale();
        $dateLocale = FormattingLocale::carbon($resolved);

        // No-op fast path: already in the target locale.
        if (
            $resolved === $previous
            && $resolved === $previousJsonLocale
            && $dateLocale === $previousDateLocale
        ) {
            return $fn();
        }

        App::setLocale($resolved);
        Translator::setLocale($resolved);
        // Dates must follow the recipient too. Carbon's own locale is what
        // `isoFormat()`/`translatedFormat()` read, and a bare language code
        // resolves to American formatting — see FormattingLocale.
        Carbon::setLocale($dateLocale);
        try {
            return $fn();
        } finally {
            App::setLocale($previous);
            Translator::setLocale($previousJsonLocale);
            Carbon::setLocale($previousDateLocale);
        }
    }

    /**
     * Resolve the input to a normalised locale string, or null if not resolvable.
     *
     * - string: trimmed; empty strings return null
     * - object with `->preferred_language`: the string value, or null if empty
     * - null: returns null (caller opts out of switching)
     */
    private static function resolve(string|object|null $input): ?string
    {
        if ($input === null) {
            return null;
        }
        if (is_string($input)) {
            $trimmed = trim($input);
            return $trimmed === '' ? null : $trimmed;
        }
        // Object path — look for preferred_language property
        $lang = $input->preferred_language ?? null;
        if (is_string($lang)) {
            $trimmed = trim($lang);
            return $trimmed === '' ? null : $trimmed;
        }
        return null;
    }
}
