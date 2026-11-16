<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

/**
 * Platform team panel → Keys and connections.
 *
 * For a fixed list of outside services: whether this server has the key that
 * service needs. Each check reads the same config key (or, where the code that
 * uses the service reads the environment directly, the same environment value,
 * the same way) as the code that uses it.
 *
 * 🔴 Booleans only. Never a value, a masked value, a length, or any character
 * of one: every row is built from a bool, so nothing else can leave.
 * Platform-wide: these are server settings, not any community's.
 */
final class ConnectionsService
{
    /**
     * @return array{connections: list<array{key: string, group: string, configured: bool}>}
     */
    public function report(): array
    {
        $rows = [];
        foreach ($this->checks() as $key => [$group, $check]) {
            $rows[] = ['key' => $key, 'group' => $group, 'configured' => (bool) $check()];
        }

        return ['connections' => $rows];
    }

    /**
     * Ordered as the page shows them.
     *
     * @return array<string, array{0: string, 1: callable(): bool}>
     */
    private function checks(): array
    {
        $set = fn (string ...$configKeys): bool => $this->allSet(array_map(fn (string $k) => config($k), $configKeys));

        return [
            // GmailApiService runs only with the switch on and all three values.
            'gmail_api' => ['email', fn () => (bool) config('mail.gmail_api.enabled')
                && $set('mail.gmail_api.client_id', 'mail.gmail_api.client_secret', 'mail.gmail_api.refresh_token')],
            'postmark' => ['email', fn () => $set('mail.postmark.server_token')],
            // mail.mailers.smtp.host falls back to a built-in default, so it is
            // always "set"; read the two environment values it is built from.
            // getenv(), not env(): env() outside config/ is a blocking PHPStan
            // finding, and config is not cached here, so both read the same value.
            'smtp' => ['email', fn () => $this->envSet('SMTP_HOST') || $this->envSet('MAIL_HOST')],
            'pusher' => ['live_updates', fn () => $set('services.pusher.key', 'services.pusher.secret', 'services.pusher.app_id')],
            // As FCMPushService::isConfiguredStatic(): the service account file, or the legacy server key.
            'fcm' => ['notifications', fn () => $this->fileExists(config('services.fcm.service_account_path'))
                || $set('services.fcm.server_key')],
            'expo' => ['notifications', fn () => $set('services.expo.access_token')],
            'web_push' => ['notifications', fn () => $set('services.vapid.public_key', 'services.vapid.private_key')],
            'stripe' => ['payments', fn () => $set('services.stripe.secret')],
            'stripe_webhook' => ['payments', fn () => $set('services.stripe.webhook_secret')],
            'openai' => ['ai', fn () => $set('services.openai.api_key')],
            'anthropic' => ['ai', fn () => $set('services.anthropic.api_key')],
            'gemini' => ['ai', fn () => $set('services.gemini.api_key')],
            // MapsConfigController reads the environment directly with getenv(); a
            // community's own key in its settings is not counted here.
            'google_maps' => ['maps_translation', fn () => $this->envSet('GOOGLE_MAPS_API_KEY')],
            'google_translate' => ['maps_translation', fn () => $set('services.google_translate.api_key')],
            // SearchService reads the environment directly, with a built-in host
            // default: read the host without that default, and the key.
            'meilisearch' => ['search', fn () => $this->envSet('MEILISEARCH_HOST') && $this->envSet('MEILISEARCH_KEY')],
            'sentry' => ['error_reports', fn () => $set('sentry.dsn')],
            // Reading counts back (Recent errors page): a separate read-only key,
            // the organisation and the server's project id, checked exactly as
            // that page checks them, so the two pages never disagree.
            'sentry_api' => ['error_reports', fn () => RecentErrorsService::isConnected()],
            'cloudflare_origin' => ['protection', fn () => $set('services.cloudflare.origin_secret')],
            'turnstile' => ['protection', fn () => $set('turnstile.secret', 'turnstile.site_key')],
            'clamav' => ['protection', fn () => $set('services.clamav.address')],
            'slack_slo_alerts' => ['alerts', fn () => $set('services.slack.slo_alerts_webhook')],
            'slack_email_alerts' => ['alerts', fn () => $set('services.slack.email_alerts_webhook')],
            'google_sign_in' => ['sign_in', fn () => $set('services.google.client_id')],
            'facebook_sign_in' => ['sign_in', fn () => $set('services.facebook.client_id')],
            'apple_sign_in' => ['sign_in', fn () => $set('services.apple.client_id')],
            'mailchimp' => ['other', fn () => $set('services.mailchimp.api_key')],
            // Files are always kept somewhere; which disk is not shown.
            'file_storage' => ['other', fn () => true],
        ];
    }

    /** @param list<mixed> $values */
    private function allSet(array $values): bool
    {
        foreach ($values as $value) {
            if (!is_scalar($value) || trim((string) $value) === '') {
                return false;
            }
        }

        return $values !== [];
    }

    private function envSet(string $name): bool
    {
        $value = getenv($name);

        return $value !== false && trim($value) !== '';
    }

    private function fileExists(mixed $path): bool
    {
        return is_string($path) && $path !== '' && is_file($path);
    }
}
