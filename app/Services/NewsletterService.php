<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Newsletter;
use App\Models\NewsletterSegment;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

// Define rate limit constant globally for cron/test access
if (!defined('NEWSLETTER_EMAIL_DELAY_MICROSECONDS')) {
    define('NEWSLETTER_EMAIL_DELAY_MICROSECONDS', 250000);
}

/**
 * NewsletterService — Laravel DI-based service for newsletter operations.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 *
 * sendNow, renderEmail, getSegmentRecipientCount, and getRecipientCount are
 * now fully converted to use DB::table() and the App\Core\Mailer.
 */
class NewsletterService
{
    /**
     * Rate limiting: microseconds between each email (250ms = max 4 emails/sec).
     *
     * A LITERAL, not the global NEWSLETTER_EMAIL_DELAY_MICROSECONDS, so the class
     * const is opcache-preload-safe. Under opcache.preload the top-level define()
     * (above) is compiled but never executed, so on the HTTP send path (where the
     * class is served from the preloaded image and the file is never require'd)
     * referencing the global constant threw a fatal "Undefined constant
     * App\Services\NEWSLETTER_EMAIL_DELAY_MICROSECONDS". Keep the two in sync.
     */
    private const EMAIL_DELAY_MICROSECONDS = 250000;

    /**
     * Maximum delivery attempts before a queue row is abandoned as permanently failed.
     * After this many failures, processQueue() will no longer re-claim the row.
     * Exponential backoff between attempts: pow(attempts, 2) * 60 seconds.
     */
    private const MAX_SEND_ATTEMPTS = 5;

    /**
     * How long sendNow() is allowed to keep sending inside the caller's request
     * before handing the rest of the queue to the every-minute cron drainer.
     *
     * sendNow() used to drain the WHOLE queue inline. At 250ms throttle per email
     * plus provider latency that is ~0.7s per recipient, so a 256-recipient send
     * held the HTTP request open for 184s (measured on production, newsletter 35,
     * 2026-08-18). The React admin aborts at 30s, so the admin saw "Request Timed
     * Out" while the send actually completed — and a scheduled send held the global
     * cron mutex for the same duration, skipping other exact-minute jobs.
     *
     * The budget is checked between batches, so a send can overshoot it by up to
     * one batch. Keep INLINE_SEND_BATCH_SIZE small enough that
     * budget + (batch * 0.7s) still leaves headroom under the frontend timeout
     * (30s default, raised to 60s for this one call in adminApi.ts).
     */
    private const INLINE_SEND_BUDGET_SECONDS = 10;

    /**
     * Batch size for the inline portion of a send. Deliberately much smaller than
     * the cron drainer's batch: it bounds how far past INLINE_SEND_BUDGET_SECONDS
     * the request can run, because the budget is only checked between batches.
     *
     * Worst case is one batch, and a batch is only as fast as the mail provider.
     * Postmark answers in ~0.7s per email in production (so ~3.5s per batch), but a
     * dead/slow SMTP host makes each attempt cost its connection timeout instead —
     * measured at ~4s per email against an unreachable host locally, i.e. ~21s for
     * one batch. That is why the frontend allows 60s for this call rather than
     * trimming the margin to the happy path.
     */
    private const INLINE_SEND_BATCH_SIZE = 5;

    public function __construct(
        private readonly Newsletter $newsletter,
    ) {}

    /**
     * Get newsletters with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $query = $this->newsletter->newQuery()
            ->with(['creator:id,first_name,last_name,profile_type,organization_name']);

        if (!empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
            $query->where('id', '<', (int) $cid);
        }

        $query->orderByDesc('id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items' => $items->toArray(),
            'cursor' => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get a single newsletter by ID.
     */
    public function getById(int $id): ?Newsletter
    {
        return $this->newsletter->newQuery()
            ->with(['creator'])
            ->find($id);
    }

    /**
     * Create a new newsletter draft.
     */
    public function create(int $createdBy, array $data): Newsletter
    {
        $newsletter = $this->newsletter->newInstance([
            'created_by' => $createdBy,
            'subject' => trim($data['subject']),
            'preview_text' => trim($data['preview_text'] ?? ''),
            'content' => $data['content'] ?? '',
            'status' => 'draft',
            'target_audience' => $data['target_audience'] ?? 'all_members',
            'segment_id' => $data['segment_id'] ?? null,
        ]);

        $newsletter->save();

        return $newsletter->fresh(['creator']);
    }

    /**
     * Mark a newsletter as queued for sending.
     */
    public function send(int $id): Newsletter
    {
        $newsletter = $this->newsletter->newQuery()->findOrFail($id);

        if ($newsletter->status === 'sent') {
            throw new \RuntimeException('Newsletter has already been sent.');
        }

        $newsletter->status = 'sending';
        $newsletter->save();

        return $newsletter;
    }

    // =========================================================================
    // SENDING
    // =========================================================================

    /**
     * Send a newsletter immediately to all eligible recipients.
     *
     * Resolves recipients from target audience or segment, queues them, and
     * processes the queue via App\Core\Mailer.
     *
     * @param int $newsletterId Newsletter ID
     * @param string $targetAudience 'all_members', 'subscribers_only', 'both', or 'segment'
     * @param int|null $segmentId Optional segment for filtered targeting
     * @param array $targeting Optional ['groups'=>int[], 'counties'=>string[], 'towns'=>string[]] filter.
     *                         When empty, self-loaded from the newsletter row's target_groups /
     *                         target_counties / target_towns columns (so cron paths inherit it).
     * @return int Number of recipients queued
     * @throws \Exception
     */
    public static function sendNow(int $newsletterId, string $targetAudience = 'all_members', ?int $segmentId = null, array $targeting = []): int
    {
        // Exclusive lock per newsletter — prevents concurrent sendNow() calls
        // (e.g., admin double-click, cron overlap, or processScheduled race).
        $lock = \Illuminate\Support\Facades\Cache::lock("newsletter:send:{$newsletterId}", 600);
        if (!$lock->get()) {
            throw new \Exception("Newsletter {$newsletterId} is already being sent by another process");
        }

        try {
            $newsletter = Newsletter::find($newsletterId);

            if (!$newsletter) {
                throw new \Exception('Newsletter not found');
            }
            $tenantId = (int) ($newsletter->tenant_id ?: TenantContext::getId());

            if ($newsletter->status === 'sent') {
                throw new \Exception('Newsletter already sent');
            }

            // Guard against re-send within a short window (email bombing fix, 2026-04-02).
            // If this newsletter was sent in the last 5 minutes, refuse to re-send.
            // This catches edge cases where recurring sends are re-claimed before
            // recurring_last_sent propagates.
            if ($newsletter->sent_at) {
                $secondsSinceLastSend = time() - strtotime($newsletter->sent_at);
                if ($secondsSinceLastSend < 300) {
                    throw new \Exception("Newsletter {$newsletterId} was sent {$secondsSinceLastSend}s ago — refusing re-send (dedup guard)");
                }
            }

            // Use segment_id from newsletter if not passed
            if (!$segmentId && !empty($newsletter->segment_id)) {
                $segmentId = (int) $newsletter->segment_id;
            }

            // Load stored group/geo targeting from the newsletter row when not passed —
            // cron paths (processScheduled/processRecurring) inherit the filter for free.
            if (empty($targeting)) {
                $targeting = self::extractTargeting($newsletter);
            }

            // A 'segment' audience without a segment is a misconfiguration: refuse
            // rather than silently falling through to all_members (targeting fix, 2026-07-03).
            if ($targetAudience === 'segment' && !$segmentId) {
                throw new \Exception("Newsletter {$newsletterId} targets a segment but no segment is selected");
            }

            return TenantContext::runForTenant($tenantId, function () use ($newsletter, $newsletterId, $targetAudience, $segmentId, $tenantId, $targeting): int {
            // Resolve recipients
            if ($segmentId) {
                $recipients = self::getSegmentRecipients($segmentId, $targeting);
            } else {
                $recipients = self::getRecipientsList($targetAudience, $targeting);
            }

            if (empty($recipients)) {
                throw new \Exception('No eligible recipients found');
            }

            // Clear old queue and queue new recipients.
            // Only clear items that haven't been sent — preserve 'sent' records
            // to avoid nuking the audit trail if sendNow() is called twice.
            DB::table('newsletter_queue')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->whereIn('status', ['pending', 'processing', 'failed'])
                ->delete();

            $queued = self::queueRecipientsWithTokens($newsletterId, $recipients);

            // Update newsletter status
            $newsletter->update([
                'status' => 'sending',
                'total_recipients' => $queued,
                'target_audience' => $targetAudience,
                'segment_id' => $segmentId,
            ]);

            // Send what fits in a short budget so small lists finish during the
            // caller's request, then leave the rest to the every-minute cron
            // drainer (CronJobRunner::processNewsletterQueueInternal). Draining
            // the whole queue here is what produced the 184s request / "Request
            // Timed Out" toast — see INLINE_SEND_BUDGET_SECONDS.
            self::processQueue($newsletterId, self::INLINE_SEND_BATCH_SIZE, self::INLINE_SEND_BUDGET_SECONDS);

            return $queued;
            });
        } finally {
            $lock->release();
        }
    }

    /**
     * Process the send queue for a newsletter.
     *
     * Sends emails in batches using App\Core\Mailer with rate limiting.
     *
     * @param int|null $maxSeconds Stop claiming new batches once this many seconds
     *                             have elapsed, leaving the remainder for the next
     *                             caller (the every-minute cron drainer). null means
     *                             drain the whole queue however long that takes —
     *                             only safe off the HTTP path. At least one batch
     *                             always runs, whatever the budget.
     * @return array{sent: int, failed: int, remaining?: int, locked?: bool}
     *         `remaining` counts rows still to be delivered (pending + in-flight +
     *         retry-eligible failures) when this call returned.
     */
    public static function processQueue(int $newsletterId, int $batchSize = 50, ?int $maxSeconds = null): array
    {
        $lockKey = "newsletter_queue:{$newsletterId}:runner_lock";
        if (!Cache::add($lockKey, getmypid() ?: uniqid('newsletter_', true), 300)) {
            return ['sent' => 0, 'failed' => 0, 'locked' => true];
        }

        try {
        $newsletter = Newsletter::find($newsletterId);
        if (!$newsletter) {
            return ['sent' => 0, 'failed' => 0];
        }

        $tenantId = (int) ($newsletter->tenant_id ?: TenantContext::getId());
        return TenantContext::runForTenant($tenantId, function () use ($newsletter, $newsletterId, $batchSize, $tenantId, $maxSeconds): array {
        $tenantName = DB::table('tenants')
            ->where('id', $tenantId)
            ->value('name') ?? 'Community';

        $sent = 0;
        $failed = 0;
        $suppressedEmails = self::getSuppressedEmails($tenantId);
        $deadline = $maxSeconds !== null ? microtime(true) + $maxSeconds : null;

        // Process all pending items in batches with ATOMIC CLAIMING.
        // Step 1: UPDATE status to 'processing' (claim) — prevents other runners
        //         from picking up the same items. Also re-claims previously
        //         'failed' rows whose exponential backoff window has elapsed
        //         and whose attempts counter is still under the permanent-fail
        //         threshold (MAX_SEND_ATTEMPTS).
        // Step 2: SELECT only 'processing' items (ours) — safe from races.
        do {
            $batchId = (string) Str::uuid();

            $claimed = DB::update(
                "UPDATE newsletter_queue
                 SET status = 'processing',
                     processing_batch_id = ?,
                     processing_started_at = NOW(),
                     last_attempted_at = NOW()
                 WHERE newsletter_id = ?
                   AND tenant_id = ?
                   AND (
                        status = 'pending'
                        OR (
                            status = 'failed'
                            AND attempts < ?
                            AND (last_attempted_at IS NULL
                                 OR NOW() >= last_attempted_at + INTERVAL (POW(attempts, 2) * 60) SECOND)
                        )
                        OR (
                            status = 'processing'
                            AND last_attempted_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                        )
                   )
                 ORDER BY id ASC LIMIT ?",
                [$batchId, $newsletterId, $tenantId, self::MAX_SEND_ATTEMPTS, $batchSize]
            );

            if ($claimed === 0) {
                break;
            }

            // Join with users so we can render emails in the subscriber's preferred_language.
            // Unregistered subscribers (user_id NULL) fall back to app default locale.
            $pending = DB::table('newsletter_queue as nq')
                ->leftJoin('users as u', function ($join) use ($tenantId) {
                    $join->on('nq.user_id', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->where('nq.newsletter_id', $newsletterId)
                ->where('nq.tenant_id', $tenantId)
                ->where('nq.status', 'processing')
                ->where('nq.processing_batch_id', $batchId)
                ->limit($batchSize)
                ->select('nq.*', 'u.preferred_language as subscriber_locale')
                ->get();

            foreach ($pending as $item) {
                try {
                    $email = strtolower(trim((string) $item->email));
                    if (isset($suppressedEmails[$email])) {
                        self::markSuppressedRecipientSkipped((int) $item->id, $tenantId);
                        continue;
                    }

                    $recipientData = [
                        'email' => $item->email,
                        'first_name' => $item->first_name ?? '',
                        'last_name' => $item->last_name ?? '',
                        'name' => $item->name ?? '',
                    ];

                    $unsubscribeToken = $item->unsubscribe_token ?? null;
                    $trackingToken = $item->tracking_token ?? null;

                    // Render email body + text/plain part (footer/unsubscribe links
                    // use __()) in the subscriber's language. For non-user
                    // subscribers, $subscriber_locale is NULL — LocaleContext
                    // treats that as a no-op.
                    [$emailHtml, $textBody] = LocaleContext::withLocale(
                        $item->subscriber_locale ?? null,
                        fn () => [
                            self::renderEmail(
                                (array) $newsletter->getAttributes(),
                                $tenantName,
                                $unsubscribeToken,
                                $recipientData,
                                $trackingToken
                            ),
                            self::renderPlainTextPart(
                                (array) $newsletter->getAttributes(),
                                $tenantName,
                                $unsubscribeToken,
                                $recipientData
                            ),
                        ]
                    );

                    $subject = $item->subject_override
                        ?: (($newsletter->ab_test_enabled && ($item->ab_variant ?? 'a') === 'b' && $newsletter->subject_b)
                            ? $newsletter->subject_b
                            : $newsletter->subject);

                    $apiUrl = rtrim(config('app.url', ''), '/');
                    $unsubscribeUrl = $unsubscribeToken
                        ? $apiUrl . '/v2/newsletter/unsubscribe?token=' . rawurlencode($unsubscribeToken)
                        : null;

                    $success = EmailDispatchService::sendRaw($item->email, $subject, $emailHtml, null, null, $unsubscribeUrl, 'newsletter', ['tenant_id' => $tenantId, 'textBody' => $textBody]);

                    if ($success) {
                        DB::table('newsletter_queue')
                            ->where('id', $item->id)
                            ->where('tenant_id', $tenantId)
                            ->where('processing_batch_id', $batchId)
                            ->update([
                                'status' => 'sent',
                                'sent_at' => now(),
                                'last_attempted_at' => now(),
                                'processing_batch_id' => null,
                                'processing_started_at' => null,
                                'error_message' => null,
                            ]);
                        // Bump attempts counter via raw statement so column stays accurate
                        DB::statement(
                            'UPDATE newsletter_queue SET attempts = attempts + 1 WHERE id = ? AND tenant_id = ?',
                            [$item->id, $tenantId]
                        );
                        $sent++;
                    } else {
                        self::markAttemptFailed((int) $item->id, $tenantId, 'Email send failed', $batchId);
                        $failed++;
                    }

                    usleep(self::EMAIL_DELAY_MICROSECONDS);
                } catch (\Exception $e) {
                    self::markAttemptFailed((int) $item->id, $tenantId, $e->getMessage(), $batchId);
                    $failed++;
                    Log::error("Newsletter send error for {$item->email}: " . $e->getMessage());
                }
            }

            // Budget spent — hand the rest of the queue to the next drainer tick.
            // Checked after the batch so at least one batch always goes out.
            if ($deadline !== null && microtime(true) >= $deadline) {
                break;
            }
        } while (true);

        // Update newsletter stats
        $stats = DB::table('newsletter_queue')
            ->where('newsletter_id', $newsletterId)
            ->where('tenant_id', $tenantId)
            ->selectRaw("
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status IN ('failed', 'suppressed') THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'failed' AND attempts < ? THEN 1 ELSE 0 END) as retryable_failed
            ", [self::MAX_SEND_ATTEMPTS])
            ->first();

        $newsletter->update([
            'total_sent' => (int) ($stats->sent ?? 0),
            'total_failed' => (int) ($stats->failed ?? 0),
        ]);

        // If queue is complete, mark newsletter as sent (or failed if nothing went out)
        if (
            ((int) ($stats->pending ?? 0)) === 0
            && ((int) ($stats->processing ?? 0)) === 0
            && ((int) ($stats->retryable_failed ?? 0)) === 0
        ) {
            $totalSent   = (int) ($stats->sent ?? 0);
            $totalFailed = (int) ($stats->failed ?? 0);
            $finalStatus = ($totalSent === 0 && $totalFailed > 0) ? 'failed' : 'sent';
            $newsletter->update([
                'status'  => $finalStatus,
                'sent_at' => now(),
            ]);
        }

        return [
            'sent' => $sent,
            'failed' => $failed,
            'remaining' => (int) ($stats->pending ?? 0)
                + (int) ($stats->processing ?? 0)
                + (int) ($stats->retryable_failed ?? 0),
        ];
        });
        } finally {
            Cache::forget($lockKey);
        }
    }

    /**
     * Record a failed send attempt on a newsletter_queue row.
     *
     * Increments `attempts`, stamps `last_attempted_at`, stores the error message,
     * and flips status back to 'failed'. Rows remain retry-eligible until
     * `attempts >= MAX_SEND_ATTEMPTS`, at which point processQueue() stops
     * re-claiming them (permanent failure).
     */
    private static function markAttemptFailed(int $queueId, int $tenantId, string $error, ?string $batchId = null): void
    {
        $batchWhere = $batchId !== null ? ' AND processing_batch_id = ?' : '';
        $params = [mb_substr($error, 0, 2000), $queueId, $tenantId];
        if ($batchId !== null) {
            $params[] = $batchId;
        }

        DB::statement(
            "UPDATE newsletter_queue
             SET status = 'failed',
                 attempts = attempts + 1,
                 last_attempted_at = NOW(),
                 processing_batch_id = NULL,
                 processing_started_at = NULL,
                 error_message = ?
             WHERE id = ? AND tenant_id = ?{$batchWhere}",
            $params
        );
    }

    private static function markSuppressedRecipientSkipped(int $queueId, int $tenantId): void
    {
        $row = DB::table('newsletter_queue')
            ->where('id', $queueId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'newsletter_id', 'user_id', 'email', 'subject_override']);

        DB::table('newsletter_queue')
            ->where('id', $queueId)
            ->where('tenant_id', $tenantId)
            ->update([
                'status' => 'suppressed',
                'attempts' => self::MAX_SEND_ATTEMPTS,
                'last_attempted_at' => now(),
                'processing_batch_id' => null,
                'processing_started_at' => null,
                'error_message' => 'Recipient is suppressed',
            ]);

        if ($row && Schema::hasTable('email_log')) {
            $subject = $row->subject_override;
            if ($subject === null && Schema::hasTable('newsletters')) {
                $subject = DB::table('newsletters')
                    ->where('id', $row->newsletter_id)
                    ->where('tenant_id', $tenantId)
                    ->value('subject');
            }

            DB::table('email_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $row->user_id,
                'recipient_email' => (string) $row->email,
                'category' => 'newsletter',
                'subject' => $subject,
                'provider' => null,
                'status' => 'suppressed',
                'error' => 'Recipient is suppressed',
                'sent_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Queue recipients with unsubscribe tokens.
     *
     * @return int Number of recipients queued
     */
    private static function queueRecipientsWithTokens(int $newsletterId, array $recipients): int
    {
        $queued = 0;

        // Build set of emails that were already successfully sent in this cycle.
        // This prevents re-queuing recipients if sendNow() is called twice
        // (email bombing fix, 2026-04-02).
        $newsletter = DB::table('newsletters')->where('id', $newsletterId)->first([
            'tenant_id',
            'ab_test_enabled',
            'ab_split_percentage',
            'is_recurring',
        ]);
        $tenantId = (int) (($newsletter->tenant_id ?? null) ?: TenantContext::getId());
        $alreadySent = [];
        if (empty($newsletter->is_recurring)) {
            $alreadySent = DB::table('newsletter_queue')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->where('status', 'sent')
                ->pluck('email')
                ->map(fn($email) => strtolower((string) $email))
                ->flip()
                ->all();
        }
        $suppressedEmails = self::getSuppressedEmails($tenantId);
        $abTestEnabled = (bool) ($newsletter->ab_test_enabled ?? false);
        $abSplitPercentage = max(0, min(100, (int) ($newsletter->ab_split_percentage ?? 50)));
        $rows = [];
        $queuedEmails = [];
        foreach ($recipients as $recipient) {
            $email = strtolower(trim($recipient['email'] ?? ''));
            if (empty($email) || isset($alreadySent[$email]) || isset($queuedEmails[$email]) || isset($suppressedEmails[$email])) {
                continue;
            }

            $queuedEmails[$email] = true;
            $token = $recipient['unsubscribe_token'] ?? bin2hex(random_bytes(32));

            $rows[] = [
                'tenant_id' => $tenantId,
                'newsletter_id' => $newsletterId,
                'email' => $email,
                'user_id' => $recipient['user_id'] ?? null,
                'name' => $recipient['name'] ?? '',
                'first_name' => $recipient['first_name'] ?? '',
                'last_name' => $recipient['last_name'] ?? '',
                'unsubscribe_token' => $token,
                'tracking_token' => bin2hex(random_bytes(32)),
                'ab_variant' => $abTestEnabled && mt_rand(1, 100) > $abSplitPercentage ? 'b' : 'a',
                'status' => 'pending',
                'created_at' => now(),
            ];
            $queued++;
        }

        if (!empty($rows)) {
            DB::table('newsletter_queue')->insert($rows);
        }

        return $queued;
    }

    // =========================================================================
    // EMAIL RENDERING
    // =========================================================================

    /**
     * Render the email HTML for a newsletter.
     *
     * Produces a professional, responsive HTML email with unsubscribe links.
     * Used for both preview (sendTest) and actual sending.
     *
     * @param array $newsletter Newsletter data as associative array
     * @param string $tenantName Tenant/community name for branding
     * @param string|null $unsubscribeToken Token for one-click unsubscribe
     * @param array|null $recipient Recipient data for personalization
     * @param string|null $trackingToken Unique per-queue-entry token for open tracking pixel
     * @return string Full HTML email
     */
    public static function renderEmail(array $newsletter, string $tenantName, ?string $unsubscribeToken = null, ?array $recipient = null, ?string $trackingToken = null): string
    {
        $format = $newsletter['content_format'] ?? 'richtext';

        $html = match ($format) {
            'plaintext' => self::renderPlaintextEmail($newsletter, $tenantName, $unsubscribeToken, $recipient, $trackingToken),
            'html', 'builder' => self::renderFullHtmlEmail($newsletter, $tenantName, $unsubscribeToken, $recipient, $trackingToken),
            default => self::renderRichtextEmail($newsletter, $tenantName, $unsubscribeToken, $recipient, $trackingToken),
        };

        // Inline CSS as the final step so every format ships Outlook/Gmail-safe
        // markup. Fail-open: a malformed body returns unchanged, never blocking a send.
        return EmailCssInliner::inline($html);
    }

    /**
     * Shared email chrome computed once per render, independent of format:
     * URLs, the inline {{unsubscribe_link}} replacement, the footer links, and
     * the open-tracking pixel.
     *
     * @return array{frontendUrl:string, apiUrl:string, inlineUnsubscribeLink:string, unsubscribeUrl:string, footerLinks:string, pixelHtml:string, year:string, allRightsReserved:string, subscriberNotice:string}
     */
    private static function prepareEmailChrome(string $tenantName, ?string $unsubscribeToken, ?string $trackingToken): array
    {
        // TenantContext is set per-newsletter by processQueue() before renderEmail() is called
        $frontendUrl = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');
        $apiUrl = rtrim(config('app.url', ''), '/');

        $inlineUnsubscribeLink = $unsubscribeToken
            ? '<a href="' . $frontendUrl . '/newsletter/unsubscribe?token=' . rawurlencode($unsubscribeToken) . '" style="color:#6366f1;">' . __('emails.newsletter.unsubscribe') . '</a>'
            : '';

        if ($unsubscribeToken) {
            $unsubscribeUrl = $frontendUrl . '/newsletter/unsubscribe?token=' . rawurlencode($unsubscribeToken);
            $footerLinks = '<a href="' . $unsubscribeUrl . '" style="color: #6b7280; text-decoration: underline;">' . __('emails.newsletter.unsubscribe') . '</a>'
                . ' <span style="color: #d1d5db; margin: 0 8px;">|</span> '
                . '<a href="' . $frontendUrl . '/settings" style="color: #6b7280; text-decoration: underline;">' . __('emails.newsletter.manage_preferences') . '</a>';
        } else {
            $unsubscribeUrl = $frontendUrl . '/settings';
            $footerLinks = '<a href="' . $unsubscribeUrl . '" style="color: #6b7280; text-decoration: underline;">' . __('emails.newsletter.manage_email_preferences') . '</a>';
        }

        // Tracking pixel (1×1 transparent GIF) — unique tracking_token per queue entry
        $pixelHtml = '';
        $pixelToken = $trackingToken ?? $unsubscribeToken;
        if ($pixelToken) {
            $pixelUrl = $apiUrl . '/v2/newsletter/pixel/' . rawurlencode($pixelToken);
            $pixelHtml = '<img src="' . $pixelUrl . '" width="1" height="1" border="0" alt=""'
                . ' style="height:1px!important;width:1px!important;border-width:0!important;'
                . 'margin-top:0!important;margin-bottom:0!important;'
                . 'margin-right:0!important;margin-left:0!important;'
                . 'padding-top:0!important;padding-bottom:0!important;'
                . 'padding-right:0!important;padding-left:0!important;display:block;" />';
        }

        return [
            'frontendUrl' => $frontendUrl,
            'apiUrl' => $apiUrl,
            'inlineUnsubscribeLink' => $inlineUnsubscribeLink,
            'unsubscribeUrl' => $unsubscribeUrl,
            'footerLinks' => $footerLinks,
            'pixelHtml' => $pixelHtml,
            'year' => date('Y'),
            'allRightsReserved' => __('emails.footer.all_rights_reserved'),
            'subscriberNotice' => __('emails.newsletter.subscriber_notice', ['community' => $tenantName]),
        ];
    }

    /**
     * Personalize + token-replace + tracked-link-wrap HTML-bearing content.
     * Shared by richtext, html and builder formats.
     */
    private static function prepareHtmlContent(string $content, string $tenantName, ?array $recipient, ?string $trackingToken, array $chrome): string
    {
        if ($recipient) {
            $content = self::personalizeContent($content, $recipient);
        }

        // {{unsubscribe_link}} → a full <a> element (drop into body text).
        // {{unsubscribe_url}}  → the bare URL (drop into an href="" attribute).
        $content = str_replace(
            ['{{tenant_name}}', '{{unsubscribe_link}}', '{{unsubscribe_url}}'],
            [$tenantName, $chrome['inlineUnsubscribeLink'], $chrome['unsubscribeUrl']],
            $content
        );

        if ($trackingToken) {
            $content = self::wrapTrackedLinks($content, $chrome['apiUrl'], $trackingToken);
        }

        return $content;
    }

    /**
     * The classic branded shell — used for `richtext` content (Lexical editor
     * output). Behavior is byte-identical to the pre-multi-format renderer.
     */
    private static function renderRichtextEmail(array $newsletter, string $tenantName, ?string $unsubscribeToken, ?array $recipient, ?string $trackingToken): string
    {
        $chrome = self::prepareEmailChrome($tenantName, $unsubscribeToken, $trackingToken);
        $content = self::prepareHtmlContent($newsletter['content'] ?? '', $tenantName, $recipient, $trackingToken, $chrome);

        $subject = $newsletter['subject'] ?? '';
        $previewText = $newsletter['preview_text'] ?? '';
        $year = $chrome['year'];
        $allRightsReserved = $chrome['allRightsReserved'];
        $subscriberNotice = $chrome['subscriberNotice'];
        $unsubscribeLinks = $chrome['footerLinks'];
        $pixelHtml = $chrome['pixelHtml'];

        // Brand colors
        $color = '#6366f1';
        $colorDark = '#4f46e5';

        return <<<HTML
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
    <title>{$subject}</title>
    <style type="text/css">
        body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f3f4f6; }
        body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        a { color: {$color}; }
        a:hover { color: {$colorDark}; }
        .content h1 { color: #1f2937; font-size: 28px; font-weight: 800; margin: 0 0 20px; line-height: 1.3; }
        .content h2 { color: #1f2937; font-size: 22px; font-weight: 700; margin: 25px 0 15px; line-height: 1.3; }
        .content h3 { color: #1f2937; font-size: 18px; font-weight: 700; margin: 20px 0 12px; line-height: 1.3; }
        .content p { color: #374151; font-size: 16px; line-height: 1.8; margin: 0 0 16px; }
        .content ul, .content ol { color: #374151; font-size: 16px; line-height: 1.8; margin: 0 0 16px; padding-left: 24px; }
        .content li { margin-bottom: 8px; }
        .content img { max-width: 100%; height: auto; border-radius: 12px; margin: 20px 0; display: block; }
        .content blockquote { margin: 20px 0; padding: 20px 25px; background-color: #f5f3ff; background-image: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border-left: 4px solid {$color}; border-radius: 0 12px 12px 0; font-style: italic; color: #4b5563; }
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .content { padding: 30px 20px !important; }
            .header { padding: 25px 20px !important; }
            .footer { padding: 25px 20px !important; }
        }
        @media (prefers-color-scheme: dark) {
            .email-bg { background-color: #1f2937 !important; }
            .email-container-inner { background-color: #374151 !important; }
            .content h1, .content h2, .content h3 { color: #f3f4f6 !important; }
            .content p, .content li { color: #d1d5db !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6;">
    <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        {$previewText}
        &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;" class="email-bg">
        <tr>
            <td style="padding: 40px 10px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" class="email-container" style="margin: auto;">
                    <tr>
                        <td class="header" style="padding: 35px 40px; text-align: center; background-color: {$color}; background-image: linear-gradient(135deg, {$color} 0%, {$colorDark} 100%); border-radius: 16px 16px 0 0;">
                            <h1 style="margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">{$tenantName}</h1>
                        </td>
                    </tr>
                    <tr>
                        <td class="content email-container-inner" style="background-color: #ffffff; padding: 40px;">
                            {$content}
                        </td>
                    </tr>
                    <tr>
                        <td class="footer" style="background-color: #f9fafb; padding: 30px 40px; border-radius: 0 0 16px 16px; border-top: 1px solid #e5e7eb;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 14px; color: #6b7280;">
                                            &copy; {$year} {$tenantName}. {$allRightsReserved}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center; padding-bottom: 15px;">
                                        <p style="margin: 0; font-size: 13px; color: #9ca3af; line-height: 1.6;">
                                            {$subscriberNotice}
                                        </p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="text-align: center;">
                                        {$unsubscribeLinks}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
    {$pixelHtml}
</body>
</html>
HTML;
    }

    /**
     * Render `html` / `builder` content: the admin authored (or the builder
     * exported) the whole email, so we do NOT wrap it in the branded shell.
     * We still guarantee an unsubscribe mechanism and the open-tracking pixel.
     */
    private static function renderFullHtmlEmail(array $newsletter, string $tenantName, ?string $unsubscribeToken, ?array $recipient, ?string $trackingToken): string
    {
        $chrome = self::prepareEmailChrome($tenantName, $unsubscribeToken, $trackingToken);
        $content = self::prepareHtmlContent($newsletter['content'] ?? '', $tenantName, $recipient, $trackingToken, $chrome);

        // Send-path safety net: absolutize root-relative /storage image URLs and
        // strip blob:/junk-data images so a delivered email never carries an
        // image the recipient's client can't fetch (builder image pipeline).
        $content = EmailHtmlSanitizer::normalizeEmailImageSources($content, $chrome['apiUrl']);

        // Compliance backstop: every bulk email needs a working unsubscribe. If
        // the author didn't include one (via {{unsubscribe_link}} or a literal
        // unsubscribe URL), append a minimal footer with it.
        $footer = '';
        if (!str_contains($content, '/newsletter/unsubscribe') && !str_contains($content, '/settings')) {
            $footer = '<div style="text-align:center;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;font-size:12px;color:#9ca3af;line-height:1.6;">'
                . '<p style="margin:0 0 6px;">' . $chrome['subscriberNotice'] . '</p>'
                . '<p style="margin:0;">' . $chrome['footerLinks'] . '</p>'
                . '</div>';
        }

        $injected = $footer . $chrome['pixelHtml'];

        // Complete document → inject before </body>; otherwise wrap the fragment
        // in a minimal, email-safe HTML skeleton (NOT the branded shell).
        if (preg_match('/<html[\s>]/i', $content) || stripos($content, '<!doctype') !== false) {
            if ($injected !== '' && preg_match('#</body\s*>#i', $content)) {
                return preg_replace('#</body\s*>#i', $injected . '</body>', $content, 1) ?? ($content . $injected);
            }
            return $content . $injected;
        }

        $subject = htmlspecialchars((string) ($newsletter['subject'] ?? ''), ENT_QUOTES, 'UTF-8');
        $previewText = $newsletter['preview_text'] ?? '';
        $preheader = $previewText !== ''
            ? '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' . htmlspecialchars($previewText, ENT_QUOTES, 'UTF-8') . '</div>'
            : '';

        return <<<HTML
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <title>{$subject}</title>
</head>
<body style="margin:0;padding:0;">
    {$preheader}
    {$content}
    {$injected}
</body>
</html>
HTML;
    }

    /**
     * Render `plaintext` content: the admin typed raw text. We produce a bare,
     * escaped HTML body (so opens still track and unsubscribe is present); the
     * authoritative text/plain part is produced by renderPlainTextPart().
     */
    private static function renderPlaintextEmail(array $newsletter, string $tenantName, ?string $unsubscribeToken, ?array $recipient, ?string $trackingToken): string
    {
        $chrome = self::prepareEmailChrome($tenantName, $unsubscribeToken, $trackingToken);

        $text = (string) ($newsletter['content'] ?? '');
        if ($recipient) {
            $text = self::personalizeContentRaw($text, $recipient);
        }
        $text = str_replace(
            ['{{tenant_name}}', '{{unsubscribe_link}}', '{{unsubscribe_url}}'],
            [$tenantName, $chrome['unsubscribeUrl'], $chrome['unsubscribeUrl']],
            $text
        );

        $body = nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8'));
        $previewText = $newsletter['preview_text'] ?? '';
        $preheader = $previewText !== ''
            ? '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' . htmlspecialchars($previewText, ENT_QUOTES, 'UTF-8') . '</div>'
            : '';
        $subscriberNotice = $chrome['subscriberNotice'];
        $footerLinks = $chrome['footerLinks'];
        $pixelHtml = $chrome['pixelHtml'];

        return <<<HTML
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#ffffff;">
    {$preheader}
    <div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.7;color:#374151;">
        {$body}
    </div>
    <div style="text-align:center;padding:0 16px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#9ca3af;line-height:1.6;">
        <p style="margin:0 0 6px;">{$subscriberNotice}</p>
        <p style="margin:0;">{$footerLinks}</p>
    </div>
    {$pixelHtml}
</body>
</html>
HTML;
    }

    /**
     * Produce the text/plain alternative part for a newsletter.
     *
     * For plaintext format the author's raw text is authoritative (tokens
     * replaced, unsubscribe URL appended). For HTML-bearing formats we convert
     * the FINAL rendered HTML so the text part carries the same content and the
     * unsubscribe URL (deliverability + compliance).
     */
    public static function renderPlainTextPart(array $newsletter, string $tenantName, ?string $unsubscribeToken = null, ?array $recipient = null): string
    {
        $format = $newsletter['content_format'] ?? 'richtext';
        $chrome = self::prepareEmailChrome($tenantName, $unsubscribeToken, null);

        if ($format === 'plaintext') {
            $text = (string) ($newsletter['content'] ?? '');
            if ($recipient) {
                $text = self::personalizeContentRaw($text, $recipient);
            }
            $text = str_replace(
                ['{{tenant_name}}', '{{unsubscribe_link}}'],
                [$tenantName, $chrome['unsubscribeUrl']],
                $text
            );

            return rtrim($text) . "\n\n" . __('emails.newsletter.unsubscribe') . ': ' . $chrome['unsubscribeUrl'];
        }

        // HTML formats — convert the rendered HTML (no tracking token so links
        // stay human-readable in the text part).
        $html = match ($format) {
            'html', 'builder' => self::renderFullHtmlEmail($newsletter, $tenantName, $unsubscribeToken, $recipient, null),
            default => self::renderRichtextEmail($newsletter, $tenantName, $unsubscribeToken, $recipient, null),
        };

        try {
            return \Soundasleep\Html2Text::convert($html, ['ignore_errors' => true, 'drop_links' => false]);
        } catch (\Throwable $e) {
            return trim(html_entity_decode(strip_tags($html), ENT_QUOTES, 'UTF-8'));
        }
    }

    /**
     * Wrap content links with the public click-tracking endpoint.
     */
    private static function wrapTrackedLinks(string $content, string $apiUrl, string $trackingToken): string
    {
        return preg_replace_callback(
            '/href=(["\'])(.*?)\1/i',
            function (array $matches) use ($apiUrl, $trackingToken): string {
                $quote = $matches[1];
                $href = html_entity_decode($matches[2], ENT_QUOTES, 'UTF-8');

                if (
                    $href === ''
                    || str_starts_with($href, '#')
                    || preg_match('/^(mailto|tel|sms):/i', $href)
                    || str_contains($href, '/v2/newsletter/')
                    || str_contains($href, '/newsletter/unsubscribe')
                    || str_contains($href, '/settings')
                ) {
                    return $matches[0];
                }

                $scheme = parse_url($href, PHP_URL_SCHEME);
                if ($scheme === null || !in_array(strtolower((string) $scheme), ['http', 'https'], true)) {
                    return $matches[0];
                }

                $signature = hash_hmac('sha256', $trackingToken . '|' . $href, (string) config('app.key'));
                $trackedUrl = rtrim($apiUrl, '/') . '/v2/newsletter/click/' . rawurlencode($trackingToken)
                    . '?url=' . rawurlencode($href)
                    . '&sig=' . rawurlencode($signature);

                return 'href=' . $quote . htmlspecialchars($trackedUrl, ENT_QUOTES, 'UTF-8') . $quote;
            },
            $content
        ) ?? $content;
    }

    /**
     * Personalize email content by replacing {{variable}} placeholders.
     */
    private static function personalizeContent(string $content, array $recipient): string
    {
        // Escape user-provided values to prevent stored XSS in newsletter emails
        $replacements = [
            '{{first_name}}' => htmlspecialchars($recipient['first_name'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{{last_name}}' => htmlspecialchars($recipient['last_name'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{{name}}' => htmlspecialchars($recipient['name'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{{email}}' => htmlspecialchars($recipient['email'] ?? '', ENT_QUOTES, 'UTF-8'),
        ];

        return str_replace(array_keys($replacements), array_values($replacements), $content);
    }

    /**
     * Personalize plaintext content — same tokens as personalizeContent() but
     * WITHOUT HTML-escaping, because the caller escapes the whole body afterward
     * (renderPlaintextEmail) or emits raw text (renderPlainTextPart).
     */
    private static function personalizeContentRaw(string $content, array $recipient): string
    {
        $replacements = [
            '{{first_name}}' => (string) ($recipient['first_name'] ?? ''),
            '{{last_name}}' => (string) ($recipient['last_name'] ?? ''),
            '{{name}}' => (string) ($recipient['name'] ?? ''),
            '{{email}}' => (string) ($recipient['email'] ?? ''),
        ];

        return str_replace(array_keys($replacements), array_values($replacements), $content);
    }

    // =========================================================================
    // RECIPIENT RESOLUTION
    // =========================================================================

    /**
     * Get the count of recipients matching a segment.
     *
     * Evaluates the segment's rules against the users table using
     * dynamic condition building.
     */
    public static function getSegmentRecipientCount(int $segmentId, array $targeting = []): int
    {
        $segment = NewsletterSegment::find($segmentId);

        if (!$segment || empty($segment->rules)) {
            return 0;
        }

        // With group/geo targeting active, count through the same resolver the
        // send path uses so the previewed count always matches reality.
        if (!empty($targeting['groups']) || !empty($targeting['counties']) || !empty($targeting['towns'])) {
            return count(self::getSegmentRecipients($segmentId, $targeting));
        }

        return self::countRecipientsByRules($segment->match_type ?? 'all', $segment->rules);
    }

    /**
     * Get the total recipient count for a target audience.
     *
     * @param string $targetAudience 'all_members', 'subscribers_only', or 'both'
     * @param array $targeting Optional ['groups'=>int[], 'counties'=>string[], 'towns'=>string[]] filter
     * @return int
     */
    public static function getRecipientCount(string $targetAudience = 'all_members', array $targeting = []): int
    {
        return count(self::getRecipientsList($targetAudience, $targeting));
    }

    /**
     * Extract the stored group/geo targeting from a newsletter row (object or array).
     *
     * target_groups / target_counties / target_towns are stored as JSON-encoded
     * lists (see AdminNewsletterController::normalizeJsonListInput()). Returns a
     * normalized ['groups'=>int[], 'counties'=>string[], 'towns'=>string[]] array.
     */
    public static function extractTargeting(object|array $newsletter): array
    {
        $get = static function (string $key) use ($newsletter) {
            return is_array($newsletter) ? ($newsletter[$key] ?? null) : ($newsletter->{$key} ?? null);
        };

        $decode = static function ($raw): array {
            if (is_array($raw)) {
                $list = $raw;
            } elseif (is_string($raw) && trim($raw) !== '') {
                $decoded = json_decode($raw, true);
                $list = is_array($decoded) ? $decoded : [];
            } else {
                return [];
            }

            return array_values(array_filter(
                array_map(static fn ($v) => is_string($v) ? trim($v) : $v, $list),
                static fn ($v) => $v !== null && $v !== ''
            ));
        };

        return [
            'groups' => array_values(array_filter(array_map('intval', $decode($get('target_groups'))), static fn (int $id) => $id > 0)),
            'counties' => array_map('strval', $decode($get('target_counties'))),
            'towns' => array_map('strval', $decode($get('target_towns'))),
        ];
    }

    /**
     * Resolve the set of user IDs matched by group/geo targeting.
     *
     * Returns null when no targeting is active (= no filtering), otherwise a
     * set (id => true) of matching user IDs — possibly empty, which means the
     * targeting matched nobody and every recipient should be excluded.
     *
     * Facets combine with OR (union): a newsletter targeted at "Group A" plus
     * "Co. Cork" reaches members in the group OR in the county. This mirrors the
     * independent list-based write path in the admin UI. Swap the implode
     * operator to ' AND ' if intersection semantics are ever wanted instead.
     */
    private static function filterUserIdsByTargeting(array $targeting): ?array
    {
        $groups = $targeting['groups'] ?? [];
        $locations = array_merge($targeting['counties'] ?? [], $targeting['towns'] ?? []);

        if (empty($groups) && empty($locations)) {
            return null;
        }

        $tenantId = TenantContext::getId();
        $conditions = [];
        $params = [$tenantId];

        if (!empty($groups)) {
            $clause = self::buildGroupMembershipCondition('member_of', $groups, $params);
            if ($clause) {
                $conditions[] = $clause;
            }
        }

        if (!empty($locations)) {
            $clause = self::buildLocationLikeCondition('in', $locations, $params);
            if ($clause) {
                $conditions[] = $clause;
            }
        }

        if (empty($conditions)) {
            return null;
        }

        $sql = "SELECT id FROM users WHERE tenant_id = ? AND (" . implode(' OR ', $conditions) . ")";

        $ids = [];
        foreach (DB::select($sql, $params) as $row) {
            $ids[(int) $row->id] = true;
        }

        return $ids;
    }

    /**
     * Whether a recipient's user_id passes the active targeting filter.
     *
     * Recipients without a user_id (unregistered subscribers) are excluded while
     * targeting is active — they cannot belong to a group or have a member location.
     */
    private static function passesTargeting(?array $allowedUserIds, mixed $userId): bool
    {
        if ($allowedUserIds === null) {
            return true;
        }

        return $userId !== null && $userId !== '' && isset($allowedUserIds[(int) $userId]);
    }

    /**
     * Get recipients list based on target audience.
     *
     * @param array $targeting Optional ['groups'=>int[], 'counties'=>string[], 'towns'=>string[]] filter
     * @return array Array of recipient arrays with email, user_id, name, etc.
     */
    private static function getRecipientsList(string $targetAudience = 'all_members', array $targeting = []): array
    {
        $tenantId = TenantContext::getId();
        $recipients = [];
        $suppressedEmails = self::getSuppressedEmails($tenantId);
        $allowedUserIds = self::filterUserIdsByTargeting($targeting);

        switch ($targetAudience) {
            case 'subscribers_only':
                $subscribers = DB::table('newsletter_subscribers')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->get();

                foreach ($subscribers as $sub) {
                    if (isset($suppressedEmails[strtolower((string) $sub->email)])) {
                        continue;
                    }
                    if (!self::passesTargeting($allowedUserIds, $sub->user_id)) {
                        continue;
                    }
                    $recipients[] = [
                        'email' => $sub->email,
                        'user_id' => $sub->user_id,
                        'unsubscribe_token' => $sub->unsubscribe_token,
                        'name' => UserDisplayName::resolve($sub),
                        'first_name' => $sub->first_name ?? '',
                        'last_name' => $sub->last_name ?? '',
                    ];
                }
                break;

            case 'both':
                $seen = [];

                // Add active subscribers first
                $subscribers = DB::table('newsletter_subscribers')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->get();

                // Also collect unsubscribed emails to exclude members who opted out
                $unsubscribedEmails = DB::table('newsletter_subscribers')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'unsubscribed')
                    ->pluck('email')
                    ->map(fn($e) => strtolower($e))
                    ->flip()
                    ->all();

                foreach ($subscribers as $sub) {
                    $email = strtolower($sub->email);
                    if (isset($suppressedEmails[$email])) {
                        continue;
                    }
                    if (!self::passesTargeting($allowedUserIds, $sub->user_id)) {
                        continue;
                    }
                    $seen[$email] = true;
                    $recipients[] = [
                        'email' => $sub->email,
                        'user_id' => $sub->user_id,
                        'unsubscribe_token' => $sub->unsubscribe_token,
                        'name' => UserDisplayName::resolve($sub),
                        'first_name' => $sub->first_name ?? '',
                        'last_name' => $sub->last_name ?? '',
                    ];
                }

                // Add active members not already in subscribers and not unsubscribed.
                // The admin "all/both" audiences are member broadcasts; explicit
                // unsubscribes and suppressions are still respected below.
                $users = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('is_approved', 1)
                    ->where('status', 'active')
                    ->whereNotNull('email')
                    ->where('email', '!=', '')
                    ->get(['id', 'email', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name']);

                foreach ($users as $user) {
                    $email = strtolower($user->email);
                    if (isset($seen[$email]) || isset($unsubscribedEmails[$email]) || isset($suppressedEmails[$email])) {
                        continue;
                    }
                    if (!self::passesTargeting($allowedUserIds, $user->id)) {
                        continue;
                    }

                    $recipients[] = [
                        'email' => $user->email,
                        'user_id' => $user->id,
                        'unsubscribe_token' => null,
                        'name' => $user->name ?? UserDisplayName::resolve($user),
                        'first_name' => $user->first_name ?? '',
                        'last_name' => $user->last_name ?? '',
                    ];
                }
                break;

            case 'all_members':
            default:
                // Collect emails that have explicitly unsubscribed so we can exclude them
                $unsubscribedEmails = DB::table('newsletter_subscribers')
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'unsubscribed')
                    ->pluck('email')
                    ->map(fn($e) => strtolower($e))
                    ->flip()
                    ->all();

                $users = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('is_approved', 1)
                    ->where('status', 'active')
                    ->whereNotNull('email')
                    ->where('email', '!=', '')
                    ->get(['id', 'email', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name']);

                foreach ($users as $user) {
                    // Skip users who have unsubscribed from newsletters
                    $email = strtolower((string) $user->email);
                    if (isset($unsubscribedEmails[$email]) || isset($suppressedEmails[$email])) {
                        continue;
                    }
                    if (!self::passesTargeting($allowedUserIds, $user->id)) {
                        continue;
                    }

                    // Look up subscriber record for unsubscribe token
                    $subscriber = DB::table('newsletter_subscribers')
                        ->where('tenant_id', $tenantId)
                        ->where('email', $user->email)
                        ->first(['unsubscribe_token']);

                    $recipients[] = [
                        'email' => $user->email,
                        'user_id' => $user->id,
                        'unsubscribe_token' => $subscriber->unsubscribe_token ?? null,
                        'name' => $user->name ?? UserDisplayName::resolve($user),
                        'first_name' => $user->first_name ?? '',
                        'last_name' => $user->last_name ?? '',
                    ];
                }
                break;
        }

        return $recipients;
    }

    /**
     * Get recipients from a newsletter segment by evaluating its rules.
     *
     * @param array $targeting Optional ['groups'=>int[], 'counties'=>string[], 'towns'=>string[]] filter
     * @return array Array of recipient arrays
     */
    public static function getSegmentRecipients(int $segmentId, array $targeting = []): array
    {
        $segment = NewsletterSegment::find($segmentId);

        if (!$segment || empty($segment->rules)) {
            return [];
        }

        $rules = self::normalizeSegmentRules($segment->rules, $segment->match_type ?? 'all');
        $users = self::queryUsersByRules($rules);

        $tenantId = TenantContext::getId();
        $recipients = [];
        $suppressedEmails = self::getSuppressedEmails($tenantId);
        $allowedUserIds = self::filterUserIdsByTargeting($targeting);

        // Collect unsubscribed emails to exclude from segment sends
        $unsubscribedEmails = DB::table('newsletter_subscribers')
            ->where('tenant_id', $tenantId)
            ->where('status', 'unsubscribed')
            ->pluck('email')
            ->map(fn($e) => strtolower($e))
            ->flip()
            ->all();

        foreach ($users as $user) {
            if (empty($user->email)) {
                continue;
            }

            // Skip users who have unsubscribed from newsletters
            $email = strtolower((string) $user->email);
            if (isset($unsubscribedEmails[$email]) || isset($suppressedEmails[$email])) {
                continue;
            }
            if (!self::passesTargeting($allowedUserIds, $user->id)) {
                continue;
            }

            $subscriber = DB::table('newsletter_subscribers')
                ->where('tenant_id', $tenantId)
                ->where('email', $user->email)
                ->first(['unsubscribe_token']);

            $recipients[] = [
                'email' => $user->email,
                'user_id' => $user->id,
                'unsubscribe_token' => $subscriber->unsubscribe_token ?? null,
                'name' => UserDisplayName::resolve($user),
                'first_name' => $user->first_name ?? '',
                'last_name' => $user->last_name ?? '',
            ];
        }

        return $recipients;
    }

    public static function countRecipientsByRules(string $matchType, array $rules): int
    {
        $tenantId = TenantContext::getId();
        $users = self::queryUsersByRules(self::normalizeSegmentRules($rules, $matchType));

        $unsubscribedEmails = DB::table('newsletter_subscribers')
            ->where('tenant_id', $tenantId)
            ->where('status', 'unsubscribed')
            ->pluck('email')
            ->map(fn ($email) => strtolower((string) $email))
            ->flip()
            ->all();
        $suppressedEmails = self::getSuppressedEmails($tenantId);

        return $users
            ->filter(function ($user) use ($unsubscribedEmails, $suppressedEmails) {
                $email = strtolower((string) ($user->email ?? ''));
                return $email !== '' && !isset($unsubscribedEmails[$email]) && !isset($suppressedEmails[$email]);
            })
            ->count();
    }

    private static function getSuppressedEmails(int $tenantId): array
    {
        $suppressed = [];

        if (Schema::hasTable('newsletter_suppression_list')) {
            $suppressed = DB::table('newsletter_suppression_list')
                ->where('tenant_id', $tenantId)
                ->where(function ($query) {
                    $query->whereNull('expires_at')
                        ->orWhere('expires_at', '>', now());
                })
                ->pluck('email')
                ->map(fn ($email) => strtolower((string) $email))
                ->flip()
                ->all();
        }

        if (Schema::hasTable('email_suppression')) {
            $globalSuppressed = DB::table('email_suppression')
                ->pluck('email')
                ->map(fn ($email) => strtolower((string) $email))
                ->flip()
                ->all();

            $suppressed = $suppressed + $globalSuppressed;
        }

        return $suppressed;
    }

    // =========================================================================
    // SEGMENT RULE EVALUATION
    // =========================================================================

    /**
     * Normalize segment rules to the {match, conditions} format expected by
     * queryUsersByRules() / countUsersByRules().
     *
     * React saves rules as a flat array [{field, operator, value}, ...] alongside
     * a separate match_type column. The service query methods expect the nested
     * format {match: 'all'|'any', conditions: [...]}.
     */
    private static function normalizeSegmentRules(mixed $rules, string $matchType = 'all'): array
    {
        if (!is_array($rules)) {
            return ['match' => $matchType, 'conditions' => []];
        }

        // Already in nested format: {match: ..., conditions: [...]}
        if (isset($rules['conditions'])) {
            // Ensure match key reflects the segment's match_type column
            $rules['match'] = $rules['match'] ?? $matchType;
            return $rules;
        }

        // Flat array format [{field, operator, value}, ...] — wrap it
        return [
            'match' => $matchType,
            'conditions' => array_values($rules),
        ];
    }

    /**
     * Query users matching segment rules.
     *
     * @return \Illuminate\Support\Collection
     */
    private static function queryUsersByRules(array $rules): \Illuminate\Support\Collection
    {
        $tenantId = TenantContext::getId();
        $conditions = [];
        $params = [$tenantId];
        $matchType = $rules['match'] ?? 'all';

        foreach ($rules['conditions'] ?? [] as $condition) {
            $clause = self::buildConditionClause($condition, $params);
            if ($clause) {
                $conditions[] = $clause;
            }
        }

        $baseWhere = "tenant_id = ? AND is_approved = 1 AND status = 'active'";
        $baseWhere .= Schema::hasColumn('users', 'newsletter_opt_in')
            ? " AND newsletter_opt_in = 1"
            : " AND 1 = 0";

        if (!empty($conditions)) {
            $operator = ($matchType === 'all') ? ' AND ' : ' OR ';
            $baseWhere .= ' AND (' . implode($operator, $conditions) . ')';
        }

        $sql = "SELECT id, email, first_name, last_name FROM users WHERE {$baseWhere} ORDER BY email";

        return collect(DB::select($sql, $params));
    }

    /**
     * Count users matching segment rules.
     */
    private static function countUsersByRules(array $rules): int
    {
        $tenantId = TenantContext::getId();
        $conditions = [];
        $params = [$tenantId];
        $matchType = $rules['match'] ?? 'all';

        foreach ($rules['conditions'] ?? [] as $condition) {
            $clause = self::buildConditionClause($condition, $params);
            if ($clause) {
                $conditions[] = $clause;
            }
        }

        $baseWhere = "tenant_id = ? AND is_approved = 1 AND status = 'active'";
        $baseWhere .= Schema::hasColumn('users', 'newsletter_opt_in')
            ? " AND newsletter_opt_in = 1"
            : " AND 1 = 0";

        if (!empty($conditions)) {
            $operator = ($matchType === 'all') ? ' AND ' : ' OR ';
            $baseWhere .= ' AND (' . implode($operator, $conditions) . ')';
        }

        $sql = "SELECT COUNT(*) as total FROM users WHERE {$baseWhere}";
        $result = DB::selectOne($sql, $params);

        return (int) ($result->total ?? 0);
    }

    /**
     * Build a single SQL condition clause from a segment rule condition.
     *
     *
     * @param array $condition ['field' => string, 'operator' => string, 'value' => mixed]
     * @param array &$params Bind parameters (appended to)
     * @return string|null SQL clause or null if unsupported
     */
    private static function buildConditionClause(array $condition, array &$params): ?string
    {
        $field = $condition['field'] ?? '';
        $operator = $condition['operator'] ?? '';
        $value = $condition['value'] ?? '';

        switch ($field) {
            case 'role':
            case 'user_role':
                return self::buildStringCondition('role', $operator, $value, $params);

            case 'profile_type':
                return self::buildStringCondition('profile_type', $operator, $value, $params);

            case 'location':
                return self::buildStringCondition('location', $operator, $value, $params);

            case 'created_at':
            case 'member_since':
                return self::buildDateCondition('created_at', $operator, $value, $params);

            case 'has_listings':
                if ($value == '1' || $value === true || $value === 'yes') {
                    return "id IN (SELECT DISTINCT user_id FROM listings WHERE listings.tenant_id = users.tenant_id AND status = 'active')";
                }
                return "id NOT IN (SELECT DISTINCT user_id FROM listings WHERE listings.tenant_id = users.tenant_id AND status = 'active')";

            case 'listing_count':
                return self::buildNumericSubqueryCondition(
                    "(SELECT COUNT(*) FROM listings WHERE listings.user_id = users.id AND listings.tenant_id = users.tenant_id AND listings.status = 'active')",
                    $operator, $value, $params
                );

            case 'geo_radius':
                return self::buildGeoRadiusCondition($value, $params);

            case 'county':
                return self::buildLocationLikeCondition($operator, $value, $params);

            case 'town':
                return self::buildLocationLikeCondition($operator, $value, $params);

            case 'group_membership':
                return self::buildGroupMembershipCondition($operator, $value, $params);

            case 'activity_score':
                return self::buildNumericSubqueryCondition(
                    "(SELECT COALESCE(activity_score, 0) FROM user_metrics WHERE user_metrics.user_id = users.id LIMIT 1)",
                    $operator, $value, $params
                );

            case 'login_recency':
                return self::buildLoginRecencyCondition($operator, $value);

            case 'bio':
                return self::buildStringCondition('bio', $operator, $value, $params);

            case 'avatar':
                return self::buildStringCondition('avatar_url', $operator, $value, $params);

            default:
                return null;
        }
    }

    /**
     * Build a string comparison condition.
     */
    private static function buildStringCondition(string $field, string $operator, string $value, array &$params): ?string
    {
        switch ($operator) {
            case 'equals':
                $params[] = $value;
                return "{$field} = ?";

            case 'not_equals':
                $params[] = $value;
                return "{$field} != ?";

            case 'contains':
                $params[] = '%' . $value . '%';
                return "{$field} LIKE ?";

            case 'starts_with':
                $params[] = $value . '%';
                return "{$field} LIKE ?";

            case 'is_empty':
                return "({$field} IS NULL OR {$field} = '')";

            case 'is_not_empty':
                return "({$field} IS NOT NULL AND {$field} != '')";

            default:
                return null;
        }
    }

    /**
     * Build a date comparison condition.
     */
    private static function buildDateCondition(string $field, string $operator, mixed $value, array &$params): ?string
    {
        switch ($operator) {
            case 'older_than_days':
                $params[] = (int) $value;
                return "{$field} < DATE_SUB(NOW(), INTERVAL ? DAY)";

            case 'newer_than_days':
                $params[] = (int) $value;
                return "{$field} > DATE_SUB(NOW(), INTERVAL ? DAY)";

            case 'before':
                $params[] = $value;
                return "{$field} < ?";

            case 'after':
                $params[] = $value;
                return "{$field} > ?";

            case 'between':
                if (is_array($value) && count($value) >= 2) {
                    $params[] = $value[0];
                    $params[] = $value[1];
                    return "{$field} BETWEEN ? AND ?";
                }
                return null;

            default:
                return null;
        }
    }

    /**
     * Build a numeric comparison against a subquery expression.
     */
    private static function buildNumericSubqueryCondition(string $subquery, string $operator, mixed $value, array &$params): ?string
    {
        switch ($operator) {
            case 'equals':
                $params[] = (int) $value;
                return "{$subquery} = ?";
            case 'greater_than':
                $params[] = (int) $value;
                return "{$subquery} > ?";
            case 'less_than':
                $params[] = (int) $value;
                return "{$subquery} < ?";
            case 'at_least':
                $params[] = (int) $value;
                return "{$subquery} >= ?";
            case 'at_most':
                $params[] = (int) $value;
                return "{$subquery} <= ?";
            default:
                return null;
        }
    }

    /**
     * Build a geographic radius condition using Haversine formula.
     */
    private static function buildGeoRadiusCondition(mixed $value, array &$params): ?string
    {
        if (!is_array($value) || !isset($value['lat'], $value['lng'], $value['radius_km'])) {
            return null;
        }

        $params[] = (float) $value['lat'];
        $params[] = (float) $value['lng'];
        $params[] = (float) $value['lat'];
        $params[] = (float) $value['radius_km'];

        return "(
            latitude IS NOT NULL
            AND longitude IS NOT NULL
            AND (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) <= ?
        )";
    }

    /**
     * Build a LIKE condition for location-based fields (county, town).
     */
    private static function buildLocationLikeCondition(string $operator, mixed $value, array &$params): ?string
    {
        $locations = is_array($value) ? $value : array_map('trim', explode(',', (string) $value));
        $locations = array_filter($locations);

        if (empty($locations)) {
            return null;
        }

        $conditions = [];
        foreach ($locations as $loc) {
            $params[] = '%' . trim($loc) . '%';
            $conditions[] = "location LIKE ?";
        }

        if ($operator === 'not_in') {
            return "NOT (" . implode(' OR ', $conditions) . ")";
        }

        return "(" . implode(' OR ', $conditions) . ")";
    }

    /**
     * Build a group membership condition.
     */
    private static function buildGroupMembershipCondition(string $operator, mixed $value, array &$params): ?string
    {
        $groupIds = is_array($value) ? $value : [$value];
        $groupIds = array_filter(array_map('intval', $groupIds));

        if (empty($groupIds)) {
            return null;
        }

        $placeholders = implode(',', array_fill(0, count($groupIds), '?'));
        foreach ($groupIds as $gid) {
            $params[] = $gid;
        }

        $subquery = "id IN (SELECT user_id FROM group_members WHERE tenant_id = users.tenant_id AND group_id IN ({$placeholders}) AND status = 'active')";

        if ($operator === 'not_member_of') {
            return "NOT ({$subquery})";
        }

        return $subquery;
    }

    /**
     * Build a login recency condition.
     */
    private static function buildLoginRecencyCondition(string $operator, mixed $value): ?string
    {
        if ($value === 'never') {
            return "(last_login_at IS NULL)";
        }

        if ($operator === 'older_than_days') {
            return "(last_login_at IS NOT NULL AND last_login_at < DATE_SUB(NOW(), INTERVAL " . (int) $value . " DAY))";
        }

        if ($operator === 'newer_than_days') {
            return "(last_login_at IS NOT NULL AND last_login_at > DATE_SUB(NOW(), INTERVAL " . (int) $value . " DAY))";
        }

        return null;
    }

    // =========================================================================
    // CRON ENTRY POINTS
    // =========================================================================

    /**
     * Process scheduled newsletters that are ready to send.
     *
     * @return int Number of newsletters processed
     */
    public static function processScheduled(): int
    {
        $processed = 0;

        try {
            // Query ALL tenants — this runs from cron where tenant context is unreliable.
            $newsletters = DB::table('newsletters')
                ->where('status', 'scheduled')
                ->where('scheduled_at', '<=', now())
                ->get();

            foreach ($newsletters as $newsletter) {
                // Set correct tenant context for this newsletter's tenant
                TenantContext::runForTenant((int) $newsletter->tenant_id, function () use ($newsletter, &$processed): void {

                // Atomically claim by flipping status from 'scheduled' → 'sending'.
                // If another cron process already claimed this newsletter the UPDATE
                // will match 0 rows and we skip it, preventing duplicate sends.
                $claimed = DB::table('newsletters')
                    ->where('id', $newsletter->id)
                    ->where('status', 'scheduled')
                    ->update(['status' => 'sending', 'updated_at' => now()]);

                if (!$claimed) {
                    return;
                }
                try {
                    $service = app(self::class);
                    $service->sendNow(
                        (int) $newsletter->id,
                        $newsletter->target_audience ?? 'all_members',
                        $newsletter->segment_id ? (int) $newsletter->segment_id : null
                    );
                    $processed++;
                } catch (\Exception $e) {
                    Log::error("Failed to process scheduled newsletter {$newsletter->id}: " . $e->getMessage());
                    // Revert status so it can be retried
                    DB::table('newsletters')
                        ->where('id', $newsletter->id)
                        ->where('status', 'sending')
                        ->update(['status' => 'scheduled', 'updated_at' => now()]);
                }
                });
            }
        } catch (\Exception $e) {
            Log::error('processScheduled error: ' . $e->getMessage());
        }

        return $processed;
    }

    /**
     * Process recurring newsletters.
     *
     * @return int Number of newsletters processed
     */
    public static function processRecurring(): int
    {
        $processed = 0;

        try {
            // Query ALL tenants — this runs from cron where tenant context is unreliable.
            $newsletters = DB::table('newsletters')
                ->where('is_recurring', true)
                ->whereIn('status', ['scheduled', 'sent'])
                ->where(function ($query) {
                    $query->whereNull('recurring_end_date')
                        ->orWhere('recurring_end_date', '>=', now()->toDateString());
                })
                ->where(function ($query) {
                    $query->whereNull('recurring_next_send')
                        ->orWhere('recurring_next_send', '<=', now());
                })
                ->get();

            foreach ($newsletters as $newsletter) {
                // Set correct tenant context for this newsletter's tenant
                TenantContext::runForTenant((int) $newsletter->tenant_id, function () use ($newsletter, &$processed): void {

                // Atomically claim by flipping status to 'sending'. Recurring
                // sent markers are written only after sendNow() succeeds, so
                // retries are not hidden behind a false delivery claim.
                $claimed = DB::table('newsletters')
                    ->where('id', $newsletter->id)
                    ->whereIn('status', ['scheduled', 'sent'])
                    ->where(function ($query) {
                        $query->whereNull('recurring_next_send')
                            ->orWhere('recurring_next_send', '<=', now());
                    })
                    ->update([
                        'status' => 'sending',
                        'updated_at' => now(),
                    ]);

                if (!$claimed) {
                    return; // Another runner already claimed it
                }
                try {
                    $service = app(self::class);
                    $service->sendNow(
                        (int) $newsletter->id,
                        $newsletter->target_audience ?? 'all_members',
                        $newsletter->segment_id ? (int) $newsletter->segment_id : null
                    );
                    // Restore to 'scheduled' for the next recurring cycle and
                    // record the recurring sent markers after successful send.
                    DB::table('newsletters')
                        ->where('id', $newsletter->id)
                        ->update([
                            'status' => 'scheduled',
                            'recurring_next_send' => self::nextRecurringSend($newsletter),
                            'recurring_last_sent' => now(),
                            'last_recurring_sent' => now(),
                            'updated_at' => now(),
                        ]);
                    $processed++;
                } catch (\Exception $e) {
                    // Revert status so it can be retried next cycle.
                    // last_sent_at stays set — this prevents re-send storms on error.
                    DB::table('newsletters')
                        ->where('id', $newsletter->id)
                        ->where('status', 'sending')
                        ->update(['status' => 'scheduled', 'updated_at' => now()]);
                    Log::error("Failed to process recurring newsletter {$newsletter->id}: " . $e->getMessage());
                }
                });
            }
        } catch (\Exception $e) {
            Log::error('processRecurring error: ' . $e->getMessage());
        }

        return $processed;
    }

    private static function nextRecurringSend(object $newsletter): string
    {
        $timezone = new \DateTimeZone($newsletter->recurring_timezone ?: config('app.timezone', 'UTC'));
        $now = new \DateTimeImmutable('now', $timezone);
        $next = $now;

        $frequency = $newsletter->recurring_frequency ?: 'weekly';
        $next = match ($frequency) {
            'daily' => $next->modify('+1 day'),
            'biweekly' => $next->modify('+2 weeks'),
            'monthly' => $next->modify('+1 month'),
            default => $next->modify('+1 week'),
        };

        if (!empty($newsletter->recurring_time)) {
            [$hour, $minute] = array_pad(explode(':', (string) $newsletter->recurring_time), 2, 0);
            $next = $next->setTime((int) $hour, (int) $minute);
        }

        if ($frequency === 'weekly' && $newsletter->recurring_day_of_week !== null) {
            $targetDay = max(1, min(7, (int) $newsletter->recurring_day_of_week));
            while ((int) $next->format('N') !== $targetDay) {
                $next = $next->modify('+1 day');
            }
        }

        if ($frequency === 'monthly' && $newsletter->recurring_day_of_month !== null) {
            $targetDay = max(1, min(28, (int) $newsletter->recurring_day_of_month));
            $next = $next->setDate((int) $next->format('Y'), (int) $next->format('m'), $targetDay);
            if ($next <= $now) {
                $next = $next->modify('+1 month');
            }
        }

        return $next->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    /**
     * Schedule a newsletter for future sending.
     *
     * @param int $newsletterId Newsletter ID
     * @param string $scheduledAt DateTime string for scheduled send
     * @return bool
     */
    public static function schedule(int $newsletterId, string $scheduledAt): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $affected = DB::table('newsletters')
                ->where('id', $newsletterId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'scheduled',
                    'scheduled_at' => $scheduledAt,
                    'updated_at' => now(),
                ]);

            return $affected > 0;
        } catch (\Exception $e) {
            Log::error('schedule error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get recipients based on target audience.
     *
     * @param string $targetAudience 'all_members', 'subscribers_only', 'both'
     * @return array
     */
    public static function getRecipients(string $targetAudience = 'all_members'): array
    {
        return self::getRecipientsList($targetAudience);
    }

    /**
     * Get statistics for a newsletter.
     *
     * @param int $newsletterId Newsletter ID
     * @return array
     */
    public static function getStats(int $newsletterId): array
    {
        $tenantId = TenantContext::getId();

        try {
            $newsletter = DB::table('newsletters')
                ->where('id', $newsletterId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$newsletter) {
                return [];
            }

            $stats = DB::table('newsletter_queue')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->selectRaw("
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
                ")
                ->first();

            $opened = DB::table('newsletter_opens')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->distinct('email')
                ->count('email');

            $clicked = DB::table('newsletter_clicks')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->distinct('email')
                ->count('email');

            return [
                'total' => (int) ($stats->total ?? 0),
                'sent' => (int) ($stats->sent ?? 0),
                'failed' => (int) ($stats->failed ?? 0),
                'pending' => (int) ($stats->pending ?? 0),
                'opened' => (int) $opened,
                'clicked' => (int) $clicked,
                'open_rate' => ($stats->sent ?? 0) > 0 ? round($opened / $stats->sent * 100, 1) : 0,
                'click_rate' => ($stats->sent ?? 0) > 0 ? round($clicked / $stats->sent * 100, 1) : 0,
            ];
        } catch (\Exception $e) {
            Log::warning('[Newsletter] Failed to fetch newsletter stats: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get filtered recipients based on criteria.
     *
     * @param array $filters Filter criteria (location, group, etc.)
     * @return array
     */
    public static function getFilteredRecipients(array $filters = []): array
    {
        $tenantId = TenantContext::getId();

        try {
            $query = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('is_approved', 1)
                ->whereNotNull('email')
                ->where('email', '!=', '');

            if (!empty($filters['location'])) {
                $query->where('location', 'LIKE', '%' . $filters['location'] . '%');
            }

            if (!empty($filters['group_id'])) {
                $query->whereIn('id', function ($q) use ($filters, $tenantId) {
                    $q->select('user_id')
                        ->from('group_members')
                        ->where('tenant_id', $tenantId)
                        ->where('group_id', $filters['group_id'])
                        ->where('status', 'active');
                });
            }

            return $query->get(['id', 'email', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name'])
                ->map(fn ($u) => (array) $u)
                ->toArray();
        } catch (\Exception $e) {
            Log::warning('[Newsletter] Failed to fetch filtered recipients: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // A/B TESTING
    // =========================================================================

    /**
     * Initialize A/B test statistics for a newsletter.
     *
     * @param int $newsletterId Newsletter ID
     * @return bool
     */
    public static function initializeABStats(int $newsletterId): bool
    {
        try {
            // Table is per-variant-row: one row each for variant 'a' and 'b'.
            $tenantId = (int) DB::table('newsletters')->where('id', $newsletterId)->value('tenant_id');
            foreach (['a', 'b'] as $variant) {
                DB::table('newsletter_ab_stats')->updateOrInsert(
                    ['newsletter_id' => $newsletterId, 'variant' => $variant],
                    [
                        'tenant_id' => $tenantId,
                        'total_sent' => 0,
                        'total_opens' => 0,
                        'unique_opens' => 0,
                        'total_clicks' => 0,
                        'unique_clicks' => 0,
                        'updated_at' => now(),
                    ]
                );
            }
            return true;
        } catch (\Exception $e) {
            Log::error('initializeABStats error: ' . $e->getMessage());
            return false;
        }
    }

    // NOTE (2026-07-09 audit): getABTestResults(), selectABWinner() and
    // resendToNonOpeners() were removed here — they had no callers (the admin
    // resend/AB workflow lives in AdminNewsletterController with its own
    // tenant-scoped queries) and mutated newsletters by bare id, which would
    // have been a cross-tenant IDOR the moment one was wired to a route.

    /**
     * Get resend eligibility info for a newsletter.
     *
     * @param int $newsletterId Newsletter ID
     * @return array
     */
    public static function getResendInfo(int $newsletterId): array
    {
        try {
            $newsletter = DB::table('newsletters')->where('id', $newsletterId)->first();
            if (!$newsletter) {
                return ['eligible' => false, 'reason' => 'Newsletter not found'];
            }
            $tenantId = (int) $newsletter->tenant_id;

            $nonOpenerCount = DB::table('newsletter_queue')
                ->where('tenant_id', $tenantId)
                ->where('newsletter_id', $newsletterId)
                ->where('status', 'sent')
                ->whereNotIn('email', function ($query) use ($newsletterId, $tenantId) {
                    $query->select('email')
                        ->from('newsletter_opens')
                        ->where('tenant_id', $tenantId)
                        ->where('newsletter_id', $newsletterId);
                })
                ->count();

            return [
                'eligible' => $newsletter->status === 'sent' && $nonOpenerCount > 0,
                'non_opener_count' => $nonOpenerCount,
                'sent_at' => $newsletter->sent_at,
            ];
        } catch (\Exception $e) {
            return ['eligible' => false, 'reason' => 'Error checking eligibility'];
        }
    }

    /**
     * Get the current email sending method.
     *
     * @return string 'Gmail API' or 'SMTP'
     */
    public static function getSendingMethod(): string
    {
        // Gmail config lives at mail.gmail_api.* (Mailer::forCurrentTenant uses
        // this path). `services.gmail.client_id` never existed — the check
        // always returned null, so the sending-method display said 'SMTP' even
        // when Gmail API was configured and actually being used.
        if (config('mail.default') === 'gmail' || !empty(config('mail.gmail_api.client_id'))) {
            return 'Gmail API';
        }
        return 'SMTP';
    }

    /**
     * Process template variables in newsletter content.
     *
     * @param string $content Raw content with placeholders
     * @param array $variables Variable name => value mapping
     * @return string Processed content
     */
    public static function processTemplateVariables(string $content, array $variables = []): string
    {
        foreach ($variables as $key => $value) {
            $content = str_replace('{{' . $key . '}}', (string) $value, $content);
        }
        return $content;
    }
}
