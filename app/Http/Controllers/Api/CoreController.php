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

        $name = trim($this->input('name', ''));
        $email = trim($this->input('email', ''));
        $subject = trim($this->input('subject', 'General Inquiry'));
        $message = trim($this->input('message', ''));

        $errors = [];
        if (empty($name)) $errors[] = 'Name is required.';
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = 'A valid email address is required.';
        if (empty($message)) $errors[] = 'Message is required.';

        if (!empty($errors)) {
            return $this->respondWithError('VALIDATION_ERROR', implode(' ', $errors), null, 400);
        }

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Project NEXUS';
        $tenantEmail = $tenant['contact_email'] ?? '';

        if (empty($tenantEmail)) {
            return $this->respondWithError('SERVER_ERROR', __('api.no_contact_email_configured'), null, 500);
        }

        $emailSubject = "[{$tenantName}] Contact Form: {$subject}";
        $emailBody = "Name: {$name}\nEmail: {$email}\nSubject: {$subject}\n\nMessage:\n{$message}";

        $sent = false;
        try {
            $replyTo = "{$name} <{$email}>";
            $sent = EmailDispatchService::sendRaw($tenantEmail, $emailSubject, $emailBody, null, $replyTo, null, 'contact_form', ['tenant_id' => TenantContext::getId()]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Contact form email error: " . $e->getMessage());
        }

        // Log submission
        try {
            DB::insert(
                "INSERT INTO contact_submissions (tenant_id, name, email, subject, message, email_sent, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
                [TenantContext::getId(), $name, $email, $subject, $message, $sent ? 1 : 0]
            );
        } catch (\Throwable $e) {
            // Table may not exist — non-critical
        }

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
