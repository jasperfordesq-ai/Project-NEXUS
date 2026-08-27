<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\NewsletterAnalytics;
use App\Models\User;
use App\Services\NewsletterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * NewsletterController — Newsletter management and distribution.
 *
 * All endpoints migrated to native DB facade — no legacy delegation.
 */
class NewsletterController extends BaseApiController
{
    protected bool $isV2Api = true;

    private function newsletterService(): NewsletterService
    {
        return app(NewsletterService::class);
    }

    /** GET /api/v2/newsletters */
    public function index(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $status = $this->query('status');

        $result = $this->newsletterService()->getAll($tenantId, $page, $perPage, $status);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $page,
            $perPage
        );
    }

    /** GET /api/v2/newsletters/{id} */
    public function show(int $id): JsonResponse
    {
        $tenantId = $this->getTenantId();

        $newsletter = $this->newsletterService()->getById($id, $tenantId);

        if ($newsletter === null) {
            return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
        }

        return $this->respondWithData($newsletter);
    }

    /** POST /api/v2/newsletters */
    public function store(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('newsletter_create', 5, 60);

        $data = $this->getAllInput();

        $newsletter = $this->newsletterService()->create($tenantId, $data);

        return $this->respondWithData($newsletter, null, 201);
    }

    /**
     * POST /api/v2/newsletters/{id}/send
     *
     * Send/queue a newsletter for distribution (admin only).
     */
    public function send(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('newsletter_send', 2, 300);

        $result = $this->newsletterService()->send($id, $tenantId);

        if ($result === null) {
            return $this->respondWithError('NOT_FOUND', __('api.newsletter_not_found'), null, 404);
        }

        return $this->respondWithData($result);
    }

    /**
     * POST /api/v2/newsletter/unsubscribe
     *
     * Processes a newsletter unsubscribe using a token from an email link.
     * No authentication required — token acts as the credential.
     *
     * Body: { "token": "..." }
     * Returns: { "success": true } or { "success": false, "message": "..." }
     */
    public function unsubscribe(): JsonResponse
    {
        $input = $this->getAllInput();
        $token = trim($input['token'] ?? $this->query('token', ''));

        if (empty($token)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.unsubscribe_token_required'), 'token', 400);
        }

        $subscriberQuery = DB::table('newsletter_subscribers')
            ->where('unsubscribe_token', $token);

        $resolvedTenant = TenantContext::get();
        $hasExplicitTenant = request()->headers->has('X-Tenant-ID')
            || request()->headers->has('X-Tenant-Slug')
            || (int) ($resolvedTenant['id'] ?? 1) > 1;
        $tenantId = $hasExplicitTenant ? (int) ($resolvedTenant['id'] ?? 0) : null;
        if ($tenantId) {
            $subscriberQuery->where('tenant_id', $tenantId);
        }

        $subscriber = $subscriberQuery->first();

        if (! $subscriber) {
            $queueQuery = DB::table('newsletter_queue as q')
                ->join('newsletters as n', 'n.id', '=', 'q.newsletter_id')
                ->where('q.unsubscribe_token', $token);

            if ($tenantId) {
                $queueQuery->where('n.tenant_id', $tenantId);
            }

            $queue = $queueQuery
                ->orderByDesc('q.id')
                ->first([
                    'q.email',
                    'q.user_id',
                    'q.first_name',
                    // NOT widened with profile_type/organization_name: `q` is
                    // newsletter_queue, which carries its own first_name/last_name
                    // snapshot and has no organisation columns.
                    'q.last_name',
                    'q.unsubscribe_token',
                    'n.tenant_id',
                ]);

            if ($queue) {
                $tenantId = (int) $queue->tenant_id;
                TenantContext::setById($tenantId);

                $subscriber = DB::table('newsletter_subscribers')
                    ->where('tenant_id', $tenantId)
                    ->where('email', $queue->email)
                    ->first();

                if (! $subscriber) {
                    $subscriberId = DB::table('newsletter_subscribers')->insertGetId([
                        'tenant_id' => $tenantId,
                        'email' => strtolower(trim((string) $queue->email)),
                        'user_id' => $queue->user_id,
                        'first_name' => $queue->first_name,
                        'last_name' => $queue->last_name,
                        'status' => 'active',
                        'confirmation_token' => bin2hex(random_bytes(32)),
                        'confirmed_at' => now(),
                        'unsubscribe_token' => $token,
                        'source' => 'manual',
                        'is_active' => 1,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);

                    $subscriber = DB::table('newsletter_subscribers')->where('id', $subscriberId)->first();
                }
            }
        }

        if (! $subscriber) {
            return $this->respondWithError('NOT_FOUND', __('api.invalid_unsubscribe_link'), null, 404);
        }

        $tenantId = (int) ($subscriber->tenant_id ?? $tenantId);
        TenantContext::setById($tenantId);

        if ($subscriber->status === 'unsubscribed') {
            return $this->respondWithData([
                'message' => __('api_controllers_2.newsletter.already_unsubscribed'),
                'already_done' => true,
            ]);
        }

        $updated = DB::table('newsletter_subscribers')
            ->where('id', (int) $subscriber->id)
            ->where('tenant_id', $tenantId)
            ->update([
                'status'             => 'unsubscribed',
                'is_active'          => 0,
                'unsubscribed_at'    => now(),
                'unsubscribe_reason' => 'email_link',
                'updated_at'         => now(),
            ]);

        if ($updated) {
            // Send unsubscribe confirmation email — render in subscriber's preferred locale
            // (request locale may be wrong if the link is hit by an email pre-fetcher / scanner)
            try {
                $email = $subscriber->email ?? null;
                if (!empty($email) && filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $community = DB::table('tenants')->where('id', $tenantId)->value('name') ?? config('app.name');
                    $recipient = !empty($subscriber->user_id)
                        ? User::select('id', 'preferred_language')->find($subscriber->user_id)
                        : null;
                    LocaleContext::withLocale($recipient, function () use ($email, $community, $tenantId) {
                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails.newsletter.unsubscribed_title'))
                            ->paragraph(__('emails.newsletter.unsubscribed_body', ['community' => $community]))
                            ->paragraph(__('emails.newsletter.unsubscribed_body_contact'))
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $email,
                            __('emails.newsletter.unsubscribed_subject', ['community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'newsletter_unsubscribe',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[NewsletterController] unsubscribe confirmation email returned false', [
                                'email' => $email,
                            ]);
                        }
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[NewsletterController] unsubscribe confirmation email failed', ['error' => $e->getMessage()]);
            }

            return $this->respondWithData(['unsubscribed' => true]);
        }

        return $this->respondWithError('SERVER_ERROR', __('api.unable_to_process_request'), null, 500);
    }

    public function trackClick(string $token): Response|RedirectResponse
    {
        $url = trim((string) $this->query('url', ''));
        $signature = trim((string) $this->query('sig', ''));
        $frontendUrl = config('app.frontend_url', config('app.url'));

        if (
            $url === ''
            || $signature === ''
            || !filter_var($url, FILTER_VALIDATE_URL)
            || !in_array(strtolower((string) parse_url($url, PHP_URL_SCHEME)), ['http', 'https'], true)
        ) {
            return redirect($frontendUrl);
        }

        $expectedSignature = hash_hmac('sha256', $token . '|' . $url, (string) config('app.key'));
        if (!hash_equals($expectedSignature, $signature)) {
            return redirect($frontendUrl);
        }

        try {
            $queue = DB::table('newsletter_queue')
                ->where('tracking_token', $token)
                ->orderByDesc('id')
                ->first(['newsletter_id', 'email']);

            if (!$queue) {
                $queue = DB::table('newsletter_queue')
                    ->where('unsubscribe_token', $token)
                    ->orderByDesc('id')
                    ->first(['newsletter_id', 'email']);
            }
        } catch (\Throwable $e) {
            Log::warning('Newsletter click token lookup failed', ['token' => $token, 'error' => $e->getMessage()]);
            return redirect($frontendUrl);
        }

        if (!$queue instanceof \stdClass) {
            return redirect($frontendUrl);
        }

        try {
            NewsletterAnalytics::recordClick(
                (int) $queue->newsletter_id,
                $token,
                (string) $queue->email,
                $url,
                hash('sha256', $url),
                request()->header('User-Agent'),
                request()->ip()
            );
        } catch (\Throwable $e) {
            Log::warning('Newsletter click tracking failed', ['token' => $token, 'error' => $e->getMessage()]);
        }

        return redirect()->away($url);
    }

    /**
     * GET /v2/newsletter/pixel/{token}
     *
     * Tracking pixel — records an email open event and returns a 1×1
     * transparent GIF. No authentication required; the token identifies
     * the specific queue entry (unsubscribe_token used as tracking key).
     */
    public function trackOpen(string $token): Response
    {
        // 1×1 transparent GIF
        $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

        // Per-IP rate limit so the unauthenticated tracking pixel can't be
        // abused as an unauthenticated DB-lookup amplifier. 60/min is well
        // above any realistic email-client preview rate.
        $ip = request()->ip() ?: 'unknown';
        if (!\App\Core\RateLimiter::attempt('nl_track_open:' . $ip, 60, 60)) {
            // Silently serve the pixel; never reveal rate-limit state to bots.
            return response($gif, 200, [
                'Content-Type' => 'image/gif',
                'Cache-Control' => 'private, no-cache, no-store, must-revalidate',
                'Pragma' => 'no-cache',
            ]);
        }

        try {
            // Try tracking_token first (new per-send unique tokens), fall back
            // to unsubscribe_token (legacy shared tokens) for older emails.
            $queue = DB::table('newsletter_queue')
                ->where('tracking_token', $token)
                ->first(['newsletter_id', 'email']);

            if (!$queue) {
                $queue = DB::table('newsletter_queue')
                    ->where('unsubscribe_token', $token)
                    ->orderByDesc('id')
                    ->first(['newsletter_id', 'email']);
            }

            if ($queue instanceof \stdClass) {
                NewsletterAnalytics::recordOpen(
                    (int) $queue->newsletter_id,
                    $token,
                    (string) $queue->email,
                    request()->header('User-Agent'),
                    request()->ip()
                );
            }
        } catch (\Throwable $e) {
            Log::warning('Newsletter pixel tracking failed', ['token' => $token, 'error' => $e->getMessage()]);
        }

        return response($gif, 200, [
            'Content-Type'  => 'image/gif',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma'        => 'no-cache',
        ]);
    }
}
