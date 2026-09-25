<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Services\EmailDispatchService;

/**
 * CoreController -- Contact form, members, listings, groups, notifications.
 *
 * Legacy messaging endpoints removed — all clients use /v2/messages (MessagesController).
 */
class CoreController extends BaseApiController
{
    protected bool $isV2Api = true;

    // ──────────────────────────────────────────────
    // Contact form
    // ──────────────────────────────────────────────

    /** POST /api/contact */
    public function apiSubmit(): JsonResponse
    {
        $this->rateLimit('contact_form', 5, 60);

        // Cloudflare Turnstile gate. Verifier short-circuits when
        // TURNSTILE_SECRET_KEY is unset (dev mode).
        $allInput = $this->getAllInput();
        $turnstileToken = $allInput['turnstile_token']
            ?? $allInput['cf-turnstile-response']
            ?? $allInput['cfTurnstileResponse']
            ?? null;
        if (! app(\App\Services\TurnstileService::class)->verify($turnstileToken, request()?->ip())) {
            return $this->respondWithError(\App\Core\ApiErrorCodes::TURNSTILE_FAILED, __('api.turnstile_failed'), null, 422);
        }

        $headerKey = request()->header('Idempotency-Key');
        $bodyKey = $allInput['idempotency_key'] ?? null;
        if (($headerKey !== null && ! is_string($headerKey))
            || ($bodyKey !== null && ! is_string($bodyKey))
            || ($headerKey !== null && $bodyKey !== null && ! hash_equals(trim($headerKey), trim($bodyKey)))) {
            return $this->respondWithError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422);
        }
        $idempotencyKey = trim((string) ($headerKey ?: $bodyKey ?: ''));
        if ($idempotencyKey !== '' && (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191)) {
            return $this->respondWithError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422);
        }

        $name = trim($this->input('name', ''));
        $email = trim($this->input('email', ''));
        $subject = trim($this->input('subject', __('govuk_alpha.contact.form.subjects.general')));
        $message = trim($this->input('message', ''));

        $errors = [];
        if (empty($name)) $errors[] = __('govuk_alpha.contact.errors.name_required');
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = __('govuk_alpha.contact.errors.email_required');
        if (empty($message)) $errors[] = __('govuk_alpha.contact.errors.message_required');

        if (!empty($errors)) {
            return $this->respondWithError('VALIDATION_ERROR', implode(' ', $errors), null, 400);
        }

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? config('app.name');
        $tenantEmail = $tenant['contact_email'] ?? '';

        if (empty($tenantEmail)) {
            return $this->respondWithError('SERVER_ERROR', __('api.no_contact_email_configured'), null, 500);
        }

        $emailSubject = "[{$tenantName}] {$subject}";
        $emailBody = __('govuk_alpha.contact.form.name_label') . ": {$name}\n"
            . __('govuk_alpha.contact.form.email_label') . ": {$email}\n"
            . __('govuk_alpha.contact.form.subject_label') . ": {$subject}\n\n"
            . __('govuk_alpha.contact.form.message_label') . ":\n{$message}";

        $tenantId = TenantContext::getId();
        $requestHash = hash('sha256', json_encode([$name, mb_strtolower($email), $subject, $message], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
        $submission = DB::transaction(function () use ($tenantId, $name, $email, $subject, $message, $idempotencyKey, $requestHash): array {
            if ($idempotencyKey !== '') {
                DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->exists();
                $keyHash = hash('sha256', $idempotencyKey);
                $existing = DB::table('contact_submissions')
                    ->where('tenant_id', $tenantId)
                    ->where('idempotency_key_hash', $keyHash)
                    ->first();
                if ($existing !== null) {
                    return hash_equals((string) $existing->request_hash, $requestHash)
                        ? ['id' => (int) $existing->id, 'replayed' => true, 'sent' => (bool) $existing->email_sent]
                        : ['error' => 'IDEMPOTENCY_CONFLICT'];
                }
            }

            $id = (int) DB::table('contact_submissions')->insertGetId([
                'tenant_id' => $tenantId,
                'name' => $name,
                'email' => $email,
                'subject' => $subject,
                'message' => $message,
                'email_sent' => 0,
                'idempotency_key_hash' => $idempotencyKey !== '' ? hash('sha256', $idempotencyKey) : null,
                'request_hash' => $idempotencyKey !== '' ? $requestHash : null,
                'delivery_started_at' => now(),
                'created_at' => now(),
            ]);
            return ['id' => $id, 'replayed' => false, 'sent' => false];
        });

        if (isset($submission['error'])) {
            return $this->respondWithError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'), 'idempotency_key', 409);
        }
        if ($submission['replayed']) {
            return $this->respondWithData(['message' => $submission['sent']
                ? __('api_controllers_1.contact_form.sent_successfully')
                : __('api_controllers_1.contact_form.received_fallback')]);
        }

        $sent = false;
        try {
            $replyTo = "{$name} <{$email}>";
            $sent = EmailDispatchService::sendRaw($tenantEmail, $emailSubject, $emailBody, null, $replyTo, null, 'contact_form', [
                'tenant_id' => $tenantId,
                'idempotency_key' => $idempotencyKey !== '' ? $idempotencyKey : null,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Contact form email error: " . $e->getMessage());
        }

        DB::table('contact_submissions')->where('id', $submission['id'])->update(['email_sent' => $sent ? 1 : 0]);

        return $this->respondWithData(['message' => $sent ? __('api_controllers_1.contact_form.sent_successfully') : __('api_controllers_1.contact_form.received_fallback')]);
    }

    // ──────────────────────────────────────────────
    // Notifications — converted to DB facade
    // (legacy GET /api/members, /api/listings, /api/groups retired: F-145)
    // ──────────────────────────────────────────────

    /** GET /api/notifications */
    public function notifications(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('notifications', 120, 60);

        $notifs = DB::table('notifications')
            ->where('user_id', $userId)
            ->where('tenant_id', $this->getTenantId())
            ->orderByDesc('created_at')
            ->limit(50)
            ->get()
            ->map(fn ($n) => (array) $n)
            ->all();

        return $this->respondWithData($notifs);
    }

    /** GET /api/notifications/check */
    public function checkNotifications(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('check_notifications', 120, 60);

        $count = \App\Models\Notification::countUnread($userId);

        return $this->respondWithData(['unread_count' => $count]);
    }

    /** GET /api/notifications/unread-count */
    public function unreadCount(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('unread_count', 120, 60);

        $messagesCount = 0;
        try {
            if (class_exists('App\Models\MessageThread')) {
                $threads = \App\Models\MessageThread::getForUser($userId);
                foreach ($threads as $thread) {
                    if (!empty($thread['unread_count'])) {
                        $messagesCount += (int) $thread['unread_count'];
                    }
                }
            }
        } catch (\Exception) {
            $messagesCount = 0;
        }

        $notificationsCount = \App\Models\Notification::countUnread($userId);

        return $this->respondWithData([
            'messages' => $messagesCount,
            'notifications' => $notificationsCount,
            'total' => $messagesCount + $notificationsCount,
        ]);
    }

}
