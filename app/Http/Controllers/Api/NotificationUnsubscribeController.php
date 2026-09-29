<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Generic one-click unsubscribe for ANY bulk / notification email the
 * platform sends. The link embedded in those emails is an HMAC-signed URL
 * naming the user, tenant, and notification category to disable.
 *
 * Required by Gmail / Yahoo bulk-sender rules (Feb 2024) — every notification
 * email needs a working `List-Unsubscribe` header pointing here.
 *
 * Endpoints:
 *   GET  /v2/notifications/unsubscribe?token=<base64>  — browser link; READ-ONLY
 *        confirmation page with a button (F-321: a bare GET must never
 *        change anything, or a link scanner unsubscribes the member)
 *   POST /v2/notifications/unsubscribe                 — the page's button
 *        (`confirm=1`, HTML result) or a mail client's one-click
 *        `List-Unsubscribe-Post` (JSON ack)
 *
 * Both verify the HMAC against APP_KEY and look up the user; only the POST
 * sets the matching notification preference to false.
 *
 * Categories map to keys in `users.notification_preferences`:
 *
 *   all              → flips every email_* key to false
 *   messages         → email_messages
 *   connections      → email_connections
 *   transactions     → email_transactions
 *   reviews          → email_reviews
 *   listings         → email_listings
 *   events           → email_events
 *   digest           → email_digest
 *   gamification     → email_gamification_digest + email_gamification_milestones
 *   org              → email_org_payments + email_org_transfers + email_org_membership + email_org_admin
 *   federation       → federation_notifications_enabled (column, not JSON)
 *
 * Idempotent: re-clicking the link returns the same confirmation.
 */
class NotificationUnsubscribeController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** All email_* keys flipped by category=all. */
    private const ALL_EMAIL_KEYS = [
        'email_messages',
        'email_listings',
        'email_digest',
        'email_connections',
        'email_transactions',
        'email_reviews',
        'email_events',
        'email_gamification_digest',
        'email_gamification_milestones',
        'email_org_payments',
        'email_org_transfers',
        'email_org_membership',
        'email_org_admin',
    ];

    /** category => list of JSON keys to flip false (federation handled separately). */
    private const CATEGORY_TO_KEYS = [
        'all'           => self::ALL_EMAIL_KEYS,
        'messages'      => ['email_messages'],
        'connections'   => ['email_connections'],
        'transactions'  => ['email_transactions'],
        'reviews'       => ['email_reviews'],
        'listings'      => ['email_listings'],
        'events'        => ['email_events'],
        'digest'        => ['email_digest'],
        'gamification'  => ['email_gamification_digest', 'email_gamification_milestones'],
        'org'           => ['email_org_payments', 'email_org_transfers', 'email_org_membership', 'email_org_admin'],
    ];

    /**
     * Build a signed unsubscribe URL for use in an email's List-Unsubscribe
     * header. Caller should be inside a tenant context.
     */
    public static function buildSignedUrl(int $userId, int $tenantId, string $category = 'all'): string
    {
        $payload = $userId . '.' . $tenantId . '.' . $category;
        $sig     = hash_hmac('sha256', $payload, (string) config('app.key'));
        $token   = rtrim(strtr(base64_encode($payload . '.' . $sig), '+/', '-_'), '=');

        // Use the tenant's frontend URL so the unsubscribe page lives under
        // the same domain as the email's other links.
        $baseUrl  = TenantContext::getFrontendUrl();
        $basePath = TenantContext::getSlugPrefix();
        return $baseUrl . $basePath . '/api/v2/notifications/unsubscribe?token=' . $token;
    }

    /**
     * GET handler — READ-ONLY. Verifies the link and renders a page asking
     * the member to confirm; nothing is changed until they press the button,
     * which POSTs back here (F-321). A bare GET used to perform the
     * unsubscribe, so any corporate link scanner or mail-preview fetch that
     * followed the link silently turned the member's email off. Same shape as
     * the co_decide emailed-token flow (SupportPendingActionService):
     * read-only GET, confirming POST.
     *
     * Links in emails already sent keep working: they carry the same token
     * and now land on this confirmation step.
     */
    public function show(Request $request): \Illuminate\Http\Response
    {
        $token = (string) $request->query('token', '');
        $result = $this->inspectToken($token);
        $status = $result['status']; // 'confirm' | 'invalid' | 'already'

        return $this->htmlResponse($status, $result, $token);
    }

    /**
     * POST handler — performs the unsubscribe.
     *
     * Two callers: the confirmation page's button (form field `confirm=1`,
     * answered with the HTML result page), and a mail client's RFC 8058
     * one-click `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, which
     * Mailer sends with every List-Unsubscribe header (answered with JSON, as
     * before).
     */
    public function oneClick(Request $request): JsonResponse|\Illuminate\Http\Response
    {
        // The token can arrive in the query string or the body depending on
        // how the mail client formats the one-click POST.
        $token = (string) ($request->input('token') ?? $request->query('token', ''));
        $result = $this->processToken($token);

        if ((string) $request->input('confirm', '') === '1') {
            return $this->htmlResponse($result['status'], $result, $token);
        }

        if ($result['status'] === 'invalid') {
            return $this->respondWithError('INVALID_TOKEN', __('api.notification_unsubscribe.invalid_token'), null, 400);
        }
        return $this->respondWithData(['unsubscribed' => true, 'category' => $result['category'] ?? 'all']);
    }

    /** @param array<string, mixed> $result */
    private function htmlResponse(string $status, array $result, string $token): \Illuminate\Http\Response
    {
        $html = LocaleContext::withLocale(
            $result['locale'] ?? null,
            fn (): string => $this->renderConfirmationHtml(
                $status,
                $result['tenant_name'] ?? null,
                $result['locale'] ?? null,
                $token,
            ),
        );
        return response($html, $status === 'invalid' ? 400 : 200)
            ->header('Content-Type', 'text/html; charset=utf-8')
            ->header('Cache-Control', 'no-store');
    }

    /**
     * Decode and verify a token without changing anything.
     *
     * @return array{user_id: int, tenant_id: int, category: string}|null
     */
    private function parseToken(string $token): ?array
    {
        if ($token === '') {
            return null;
        }

        $decoded = base64_decode(strtr($token, '-_', '+/'), true);
        if ($decoded === false) {
            return null;
        }

        $parts = explode('.', $decoded);
        if (count($parts) !== 4) {
            return null;
        }
        [$userIdStr, $tenantIdStr, $category, $sig] = $parts;

        $userId   = (int) $userIdStr;
        $tenantId = (int) $tenantIdStr;
        if ($userId <= 0 || $tenantId <= 0 || $category === '') {
            return null;
        }

        if (!isset(self::CATEGORY_TO_KEYS[$category]) && $category !== 'federation') {
            return null;
        }

        $expected = hash_hmac('sha256', $userId . '.' . $tenantId . '.' . $category, (string) config('app.key'));
        if (!hash_equals($expected, $sig)) {
            return null;
        }

        return ['user_id' => $userId, 'tenant_id' => $tenantId, 'category' => $category];
    }

    /** Whether every preference the category covers is already off. */
    private function isAlreadyOff(object $user, string $category): bool
    {
        if ($category === 'federation') {
            return (int) ($user->federation_notifications_enabled ?? 1) === 0;
        }

        $prefs = json_decode($user->notification_preferences ?? '{}', true) ?: [];
        foreach (self::CATEGORY_TO_KEYS[$category] as $key) {
            if (($prefs[$key] ?? 1) !== false && (int) ($prefs[$key] ?? 1) !== 0) {
                return false;
            }
        }

        return true;
    }

    /**
     * Read-only counterpart of processToken() for the GET confirmation page.
     *
     * @return array{status: 'confirm'|'already'|'invalid', category?: string, tenant_name?: string, locale?: string}
     */
    private function inspectToken(string $token): array
    {
        $parsed = $this->parseToken($token);
        if ($parsed === null) {
            return ['status' => 'invalid'];
        }

        TenantContext::setById($parsed['tenant_id']);
        try {
            $user = DB::table('users')
                ->where('id', $parsed['user_id'])
                ->where('tenant_id', $parsed['tenant_id'])
                ->first(['id', 'notification_preferences', 'federation_notifications_enabled', 'preferred_language']);
            if (!$user) {
                return ['status' => 'invalid'];
            }

            $tenant = TenantContext::get();

            return [
                'status' => $this->isAlreadyOff($user, $parsed['category']) ? 'already' : 'confirm',
                'category' => $parsed['category'],
                'tenant_name' => (string) ($tenant['name'] ?? ''),
                'locale' => (string) ($user->preferred_language ?? config('app.locale', 'en')),
            ];
        } finally {
            TenantContext::reset();
        }
    }

    /**
     * Verify token and flip the relevant preferences. Returns:
     *   ['status' => 'ok'|'already'|'invalid', 'category' => ?string,
     *    'tenant_name' => ?string, 'locale' => ?string]
     */
    private function processToken(string $token): array
    {
        $parsed = $this->parseToken($token);
        if ($parsed === null) {
            return ['status' => 'invalid'];
        }
        $userId   = $parsed['user_id'];
        $tenantId = $parsed['tenant_id'];
        $category = $parsed['category'];

        TenantContext::setById($tenantId);

        try {
            return DB::transaction(function () use ($userId, $tenantId, $category): array {
                // Serialize with settings writes so an unsubscribe can never
                // overwrite a concurrent toggle (or be overwritten by one).
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first(['id', 'notification_preferences', 'federation_notifications_enabled', 'preferred_language']);
                if (!$user) {
                    return ['status' => 'invalid'];
                }

                $tenant = TenantContext::get();
                $resultContext = [
                    'category' => $category,
                    'tenant_name' => (string) ($tenant['name'] ?? ''),
                    'locale' => (string) ($user->preferred_language ?? config('app.locale', 'en')),
                ];

                // 'federation' category: flip a column, not the JSON.
                if ($category === 'federation') {
                    if ((int) ($user->federation_notifications_enabled ?? 1) === 0) {
                        return array_merge(['status' => 'already'], $resultContext);
                    }
                    DB::table('users')
                        ->where('id', $userId)
                        ->where('tenant_id', $tenantId)
                        ->update([
                            'federation_notifications_enabled' => 0,
                            'updated_at' => now(),
                        ]);
                    Log::info('NotificationUnsubscribe: federation flipped off', [
                        'user_id'   => $userId,
                        'tenant_id' => $tenantId,
                    ]);
                    return array_merge(['status' => 'ok'], $resultContext);
                }

                $prefs = json_decode($user->notification_preferences ?? '{}', true) ?: [];
                $keysToFlip = self::CATEGORY_TO_KEYS[$category];
                $alreadyAllOff = true;
                foreach ($keysToFlip as $key) {
                    if (($prefs[$key] ?? 1) !== false && (int) ($prefs[$key] ?? 1) !== 0) {
                        $alreadyAllOff = false;
                    }
                    $prefs[$key] = false;
                }
                if ($alreadyAllOff) {
                    return array_merge(['status' => 'already'], $resultContext);
                }

                DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'notification_preferences' => json_encode($prefs, JSON_THROW_ON_ERROR),
                        'updated_at' => now(),
                    ]);

                Log::info('NotificationUnsubscribe: preferences flipped off', [
                    'user_id'   => $userId,
                    'tenant_id' => $tenantId,
                    'category'  => $category,
                    'keys'      => $keysToFlip,
                ]);

                return array_merge(['status' => 'ok'], $resultContext);
            }, 3);
        } finally {
            TenantContext::reset();
        }
    }

    private function renderConfirmationHtml(string $status, ?string $tenantName, ?string $locale, string $token = ''): string
    {
        $tenant = htmlspecialchars(
            $tenantName !== null && $tenantName !== ''
                ? $tenantName
                : __('api.notification_unsubscribe.fallback_tenant'),
            ENT_QUOTES,
            'UTF-8',
        );
        $titleText = match ($status) {
            'confirm' => __('api.notification_unsubscribe.title_confirm'),
            'ok' => __('api.notification_unsubscribe.title_unsubscribed'),
            'already' => __('api.notification_unsubscribe.title_already'),
            default => __('api.notification_unsubscribe.title_invalid'),
        };
        $body = match ($status) {
            'confirm' => __('api.notification_unsubscribe.body_confirm', ['tenant' => $tenant]),
            'ok' => __('api.notification_unsubscribe.body_unsubscribed', ['tenant' => $tenant]),
            'already' => __('api.notification_unsubscribe.body_already', ['tenant' => $tenant]),
            default => __('api.notification_unsubscribe.body_invalid'),
        };
        // The confirm step's only control: a POST back to this same URL
        // (empty action = the current address, token query included), so the
        // change happens only when a person presses the button.
        $form = '';
        if ($status === 'confirm') {
            $safeToken = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');
            $button = htmlspecialchars((string) __('api.notification_unsubscribe.button_confirm'), ENT_QUOTES, 'UTF-8');
            $form = '<form method="post" action="">'
                . '<input type="hidden" name="token" value="' . $safeToken . '">'
                . '<input type="hidden" name="confirm" value="1">'
                . '<button type="submit">' . $button . '</button>'
                . '</form>';
        }
        $title = htmlspecialchars((string) $titleText, ENT_QUOTES, 'UTF-8');
        $htmlLocale = htmlspecialchars((string) ($locale ?: config('app.locale', 'en')), ENT_QUOTES, 'UTF-8');
        $direction = str_starts_with(strtolower($htmlLocale), 'ar') ? 'rtl' : 'ltr';
        return <<<HTML
<!DOCTYPE html>
<html lang="{$htmlLocale}" dir="{$direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{$title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:540px;margin:64px auto;padding:0 16px;color:#1f2937;line-height:1.5;}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.04);}
  h1{font-size:22px;margin:0 0 12px;}
  p{margin:0;color:#4b5563;}
  form{margin:24px 0 0;}
  button{font:inherit;font-weight:600;color:#fff;background:#1f2937;border:0;border-radius:8px;padding:10px 20px;cursor:pointer;}
  button:focus-visible{outline:3px solid #2563eb;outline-offset:2px;}
</style>
</head>
<body>
<div class="card">
<h1>{$title}</h1>
<p>{$body}</p>
{$form}
</div>
</body>
</html>
HTML;
    }
}
