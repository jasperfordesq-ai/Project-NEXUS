<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Publication and the START of its recipient ledger commit together; the rest
 * of the ledger is written in the background and the scheduler sends later.
 *
 * F-471: the whole ledger — one row per active member — used to be written
 * inside the administrator's request and inside the publication transaction,
 * which holds a row lock on the version. Now only the first chunk is written
 * there. That chunk is also the durable marker: a version with at least one
 * delivery row is known to be mid-fan-out, so if the background job is lost
 * (queue down, worker killed) the every-minute send command resumes it. A
 * version with no delivery row at all is never touched by that repair, so a
 * policy published before this feature existed can never start emailing.
 */
final class LegalPublicationDeliveryService
{
    /** Rows per insert, and the number written synchronously at publication. */
    public const FANOUT_CHUNK = 250;

    /** How far back the scheduler looks for a fan-out to resume. */
    private const FANOUT_REPAIR_DAYS = 3;

    /** Resume work done per scheduler run, so one run cannot stall sending. */
    private const FANOUT_REPAIR_MAX_ROWS = 2000;

    /**
     * Start the recipient ledger for a just-published version in the current
     * community: write the first chunk now, queue the rest after commit.
     *
     * @return int rows written now; any remainder is written by
     *             RecordLegalPublicationDeliveries.
     */
    public static function record(int $versionId): int
    {
        return DB::transaction(function () use ($versionId) {
            $version = DB::table('legal_document_versions as v')
                ->join('legal_documents as d', 'd.id', '=', 'v.document_id')
                ->where('v.id', $versionId)->where('d.tenant_id', TenantContext::getId())
                ->where('v.is_draft', 0)->where('d.is_active', 1)
                ->whereColumn('d.current_version_id', 'v.id')
                ->select('v.*', 'd.title', 'd.document_type', 'd.tenant_id')
                ->lockForUpdate()->first();
            if (!$version) {
                return 0;
            }
            $template = [
                'document_title' => $version->title,
                'version_number' => $version->version_number,
                'summary' => trim(strip_tags($version->summary_of_changes ?? '')),
                'review_url' => TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix()
                    . LegalDocumentService::documentPath((array) $version),
                'community_name' => TenantContext::getName(),
            ];
            $tenantId = (int) $version->tenant_id;
            $cutoff = now()->toDateTimeString();

            $written = self::fanOut($tenantId, (int) $version->id, $template, $cutoff, self::FANOUT_CHUNK);

            if ($written >= self::FANOUT_CHUNK) {
                // More members may remain. Queued only once the publication has
                // committed; a lost dispatch is resumed by repairFanouts().
                DB::afterCommit(static function () use ($tenantId, $versionId, $cutoff): void {
                    try {
                        \App\Jobs\RecordLegalPublicationDeliveries::dispatch($tenantId, $versionId, $cutoff);
                    } catch (\Throwable $e) {
                        Log::error('Policy email recipient fan-out could not be queued; the scheduler will resume it', [
                            'tenant_id' => $tenantId, 'version_id' => $versionId, 'exception' => get_class($e),
                        ]);
                    }
                });
            }

            return $written;
        });
    }

    /**
     * Write the rest of a version's ledger, copying the denormalised fields
     * from a row the publication already wrote. Each chunk commits on its own:
     * no transaction and no lock span the fan-out.
     *
     * @return int rows written
     */
    public static function continueFanout(int $tenantId, int $versionId, string $cutoff, int $maxRows = PHP_INT_MAX): int
    {
        $stillCurrent = DB::table('legal_document_versions as v')
            ->join('legal_documents as d', 'd.id', '=', 'v.document_id')
            ->where('v.id', $versionId)->where('d.tenant_id', $tenantId)
            ->where('v.is_draft', 0)->where('d.is_active', 1)
            ->whereColumn('d.current_version_id', 'v.id')
            ->exists();
        if (!$stillCurrent) {
            return 0;
        }
        $template = DB::table('legal_publication_deliveries')
            ->where('tenant_id', $tenantId)->where('version_id', $versionId)
            ->orderBy('id')
            ->first(['document_title', 'version_number', 'summary', 'review_url', 'community_name']);
        if (!$template) {
            return 0;
        }

        return self::fanOut($tenantId, $versionId, (array) $template, $cutoff, $maxRows);
    }

    /**
     * Scheduler backstop for a lost or failed fan-out job: resume any recent
     * version that has started its ledger but still misses an eligible member.
     */
    public static function repairFanouts(): int
    {
        $versions = DB::table('legal_document_versions as v')
            ->join('legal_documents as d', 'd.id', '=', 'v.document_id')
            ->where('v.is_draft', 0)->where('d.is_active', 1)
            ->whereColumn('d.current_version_id', 'v.id')
            ->where('v.published_at', '>=', now()->subDays(self::FANOUT_REPAIR_DAYS))
            ->whereExists(function ($q) {
                $q->selectRaw('1')->from('legal_publication_deliveries as l')
                    ->whereColumn('l.version_id', 'v.id')->whereColumn('l.tenant_id', 'd.tenant_id');
            })
            ->orderBy('v.published_at')
            ->get(['v.id', 'd.tenant_id', 'v.published_at']);

        $written = 0;
        foreach ($versions as $version) {
            $budget = self::FANOUT_REPAIR_MAX_ROWS - $written;
            if ($budget <= 0) {
                break;
            }
            $written += self::continueFanout(
                (int) $version->tenant_id,
                (int) $version->id,
                (string) $version->published_at,
                $budget,
            );
        }

        return $written;
    }

    /**
     * Insert pending deliveries for eligible members who have none yet, in
     * chunks. Service announcements include administrators and marketing
     * opt-outs. Members who joined after `$cutoff` are not part of this
     * publication's audience.
     *
     * @param array<string, mixed> $template
     */
    private static function fanOut(int $tenantId, int $versionId, array $template, string $cutoff, int $maxRows): int
    {
        $written = 0;
        while ($written < $maxRows) {
            $limit = (int) min(self::FANOUT_CHUNK, $maxRows - $written);
            $userIds = DB::table('users as u')
                ->where('u.tenant_id', $tenantId)
                ->where('u.status', 'active')->whereNull('u.deleted_at')
                ->where(fn ($q) => $q->whereNull('u.created_at')->orWhere('u.created_at', '<=', $cutoff))
                ->whereNotExists(function ($q) use ($tenantId, $versionId) {
                    $q->selectRaw('1')->from('legal_publication_deliveries as l')
                        ->where('l.tenant_id', $tenantId)->where('l.version_id', $versionId)
                        ->whereColumn('l.user_id', 'u.id');
                })
                ->orderBy('u.id')->limit($limit)->pluck('u.id');
            if ($userIds->isEmpty()) {
                break;
            }
            $now = now();
            $rows = [];
            foreach ($userIds as $userId) {
                $rows[] = array_merge($template, [
                    'tenant_id' => $tenantId, 'version_id' => $versionId, 'user_id' => $userId,
                    'status' => 'pending', 'attempts' => 0,
                    'created_at' => $now, 'updated_at' => $now,
                ]);
            }
            $inserted = DB::table('legal_publication_deliveries')->insertOrIgnore($rows);
            $written += $inserted;
            // Stop on a short page, and on a page that wrote nothing: an ignored
            // row would otherwise be selected again on every pass.
            if ($inserted === 0 || $userIds->count() < $limit) {
                break;
            }
        }

        return $written;
    }

    public static function summary(int $tenantId, int $versionId): array
    {
        return DB::table('legal_publication_deliveries')
            ->where('tenant_id', $tenantId)->where('version_id', $versionId)
            ->selectRaw('status, COUNT(*) as total')->groupBy('status')
            ->pluck('total', 'status')->map(fn ($n) => (int) $n)->all();
    }

    /**
     * F-469: a fetch this soon after the message was handed to the mail transport
     * is a mail-security gateway or image proxy scanning it on arrival, not a
     * member reading it. Counting it would drop the member off the "not opened"
     * chase list — the dangerous direction to be wrong in — so it is ignored. A
     * member who genuinely opens within the window simply stays on the list.
     */
    private const AUTOMATED_FETCH_WINDOW_SECONDS = 120;

    public static function trackingUrl(int $deliveryId, string $event): string
    {
        $signature = hash_hmac('sha256', "legal-publication:{$event}:{$deliveryId}", (string) config('app.key'));
        // O-175: routes/api.php is mounted under the global `/api` prefix, so the
        // address must carry it. Without it the "read the policy" button and the
        // pixel in every policy email led to a 404.
        return rtrim((string) config('app.url'), '/')
            . "/api/v2/legal-publication/{$event}/{$deliveryId}/{$signature}";
    }

    /** Record a signed recipient event without exposing account information. */
    public static function recordEvent(int $deliveryId, string $event, string $signature): ?string
    {
        if (!in_array($event, ['open', 'click'], true) || !hash_equals(
            hash_hmac('sha256', "legal-publication:{$event}:{$deliveryId}", (string) config('app.key')),
            $signature
        )) {
            return null;
        }
        $row = DB::table('legal_publication_deliveries')->where('id', $deliveryId)->first();
        if (!$row) {
            return null;
        }
        // F-469: the figures are compliance evidence, so only a read that can
        // have happened is recorded, and only once per recipient per kind.
        if (self::isCountableEvent($row)) {
            try {
                DB::transaction(function () use ($row, $deliveryId, $event) {
                    // Serialise concurrent fetches of the same link on the
                    // delivery row so the existence test below cannot race.
                    DB::table('legal_publication_deliveries')->where('id', $deliveryId)
                        ->lockForUpdate()->first(['id']);
                    $already = DB::table('legal_publication_events')
                        ->where('delivery_id', $deliveryId)->where('event_type', $event)->exists();
                    if (!$already) {
                        DB::table('legal_publication_events')->insert([
                            'tenant_id' => $row->tenant_id, 'delivery_id' => $deliveryId,
                            'event_type' => $event, 'occurred_at' => now(),
                        ]);
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('Policy email engagement event could not be recorded', ['delivery_id' => $deliveryId, 'event' => $event]);
            }
        }
        return filter_var($row->review_url, FILTER_VALIDATE_URL)
            && in_array(strtolower((string) parse_url($row->review_url, PHP_URL_SCHEME)), ['http', 'https'], true)
            ? $row->review_url : null;
    }

    /**
     * F-469: an email that has not been handed to a mail transport cannot have
     * been read, and a fetch inside the arrival window is an automated scan.
     */
    private static function isCountableEvent(object $row): bool
    {
        if (($row->status ?? null) !== 'sent' || empty($row->sent_at)) {
            return false;
        }

        return \Illuminate\Support\Carbon::parse($row->sent_at)
            ->lte(now()->subSeconds(self::AUTOMATED_FETCH_WINDOW_SECONDS));
    }

    private static function eventCounts(int $tenantId, array $versionIds): \Illuminate\Database\Query\Builder
    {
        return DB::table('legal_publication_events as evlog')
            ->join('legal_publication_deliveries as delivery', 'delivery.id', '=', 'evlog.delivery_id')
            ->where('evlog.tenant_id', $tenantId)
            ->where('delivery.tenant_id', $tenantId)
            ->whereIn('delivery.version_id', $versionIds)
            ->selectRaw('evlog.tenant_id, evlog.delivery_id')
            ->selectRaw("SUM(CASE WHEN evlog.event_type = 'open' THEN 1 ELSE 0 END) as opens")
            ->selectRaw("SUM(CASE WHEN evlog.event_type = 'click' THEN 1 ELSE 0 END) as clicks")
            ->selectRaw("MIN(CASE WHEN evlog.event_type = 'open' THEN evlog.occurred_at END) as first_opened")
            ->selectRaw("MIN(CASE WHEN evlog.event_type = 'click' THEN evlog.occurred_at END) as first_clicked")
            ->groupBy('evlog.tenant_id', 'evlog.delivery_id');
    }

    /** Recent policy sends for the admin email overview. Provider delivery is
     * separate from transport submission: a submitted email can still bounce. */
    public static function recent(int $tenantId, int $limit = 20): array
    {
        $versionIds = DB::table('legal_document_versions as v')
            ->join('legal_documents as d', 'd.id', '=', 'v.document_id')
            ->where('d.tenant_id', $tenantId)
            ->whereExists(function ($query) use ($tenantId) {
                $query->selectRaw('1')->from('legal_publication_deliveries as l')
                    ->whereColumn('l.version_id', 'v.id')->where('l.tenant_id', $tenantId);
            })
            ->orderByDesc('v.published_at')->limit($limit)->pluck('v.id');
        if ($versionIds->isEmpty()) {
            return [];
        }

        return DB::table('legal_publication_deliveries as l')
            ->join('legal_document_versions as v', 'v.id', '=', 'l.version_id')
            ->join('legal_documents as d', function ($join) {
                $join->on('d.id', '=', 'v.document_id')->on('d.tenant_id', '=', 'l.tenant_id');
            })
            ->leftJoin('email_log as e', function ($join) {
                $join->on('e.tenant_id', '=', 'l.tenant_id')
                    ->on('e.idempotency_key', '=', DB::raw("CONCAT('legal-publication:', l.id)"));
            })
            ->leftJoinSub(self::eventCounts($tenantId, $versionIds->all()), 'ev', function ($join) {
                $join->on('ev.tenant_id', '=', 'l.tenant_id')->on('ev.delivery_id', '=', 'l.id');
            })
            ->where('l.tenant_id', $tenantId)->whereIn('l.version_id', $versionIds)
            ->selectRaw('d.id as document_id, MIN(l.document_title) as title, v.id as version_id, v.version_number, v.published_at')
            ->selectRaw('COUNT(DISTINCT l.id) as recipients')
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status IN ('pending','retry','sending') THEN l.id END) as queued")
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status = 'sent' THEN l.id END) as submitted")
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status IN ('failed','suppressed','skipped','unknown') THEN l.id END) as exceptions")
            ->selectRaw("COUNT(DISTINCT CASE WHEN e.status IN ('delivered','opened','clicked') THEN l.id END) as delivered")
            ->selectRaw("COUNT(DISTINCT CASE WHEN e.status = 'bounced' THEN l.id END) as bounced")
            ->selectRaw('COUNT(DISTINCT CASE WHEN ev.opens > 0 THEN l.id END) as unique_opens')
            ->selectRaw('COUNT(DISTINCT CASE WHEN ev.clicks > 0 THEN l.id END) as unique_clicks')
            ->groupBy('d.id', 'v.id', 'v.version_number', 'v.published_at')
            ->orderByDesc('v.published_at')->get()->map(fn ($row) => (array) $row)->all();
    }

    public static function engagement(int $tenantId, int $versionId, int $page, string $filter): ?array
    {
        $version = DB::table('legal_document_versions as v')
            ->join('legal_documents as d', 'd.id', '=', 'v.document_id')
            ->where('v.id', $versionId)->where('d.tenant_id', $tenantId)
            ->first(['d.id as document_id', 'd.title', 'v.version_number', 'v.published_at']);
        if (!$version) {
            return null;
        }
        $version->title = DB::table('legal_publication_deliveries')
            ->where('tenant_id', $tenantId)->where('version_id', $versionId)
            ->value('document_title') ?? $version->title;
        $base = DB::table('legal_publication_deliveries as l')
            ->leftJoin('users as u', function ($join) {
                $join->on('u.id', '=', 'l.user_id')->on('u.tenant_id', '=', 'l.tenant_id');
            })
            ->leftJoinSub(self::eventCounts($tenantId, [$versionId]), 'ev', function ($join) {
                $join->on('ev.tenant_id', '=', 'l.tenant_id')->on('ev.delivery_id', '=', 'l.id');
            })
            ->where('l.tenant_id', $tenantId)->where('l.version_id', $versionId);
        $totals = (clone $base)->selectRaw('COUNT(*) as recipients')
            ->selectRaw("SUM(CASE WHEN l.status = 'sent' THEN 1 ELSE 0 END) as submitted")
            ->selectRaw('SUM(COALESCE(ev.opens, 0)) as total_opens, SUM(COALESCE(ev.clicks, 0)) as total_clicks')
            ->selectRaw('SUM(CASE WHEN ev.opens > 0 THEN 1 ELSE 0 END) as unique_opens')
            ->selectRaw('SUM(CASE WHEN ev.clicks > 0 THEN 1 ELSE 0 END) as unique_clicks')->first();
        if ($filter === 'opened') $base->where('ev.opens', '>', 0);
        if ($filter === 'clicked') $base->where('ev.clicks', '>', 0);
        if ($filter === 'not_opened') $base->whereNull('ev.first_opened');
        $rows = $base->select('l.id', 'l.status', 'l.sent_at', 'u.email', 'u.first_name',
            'ev.first_opened', 'ev.first_clicked', 'ev.opens', 'ev.clicks')
            ->orderBy('l.id')->paginate(25, ['*'], 'page', $page);
        return [
            'version' => (array) $version,
            'totals' => (array) $totals,
            'recipients' => $rows->items(),
            'meta' => ['total' => $rows->total(), 'page' => $rows->currentPage(), 'per_page' => $rows->perPage(), 'total_pages' => $rows->lastPage()],
        ];
    }

    public function processBatch(int $limit = 100): int
    {
        // F-471: resume any recipient fan-out whose background job was lost.
        try {
            self::repairFanouts();
        } catch (\Throwable $e) {
            Log::error('Policy email recipient fan-out repair failed', ['exception' => get_class($e)]);
        }

        // A crashed worker might already have submitted the email. Reconcile its
        // transport log; never blindly resend a send with an unknown outcome.
        $stale = DB::table('legal_publication_deliveries')->where('status', 'sending')
            ->where('claimed_at', '<', now()->subMinutes(10))->limit($limit)->get();
        foreach ($stale as $row) {
            $sent = $this->wasSent($row);
            DB::table('legal_publication_deliveries')->where('id', $row->id)->where('status', 'sending')
                ->update([
                    'status' => $sent ? 'sent' : 'unknown', 'reason' => 'worker_interrupted',
                    'sent_at' => $sent ? now() : null, 'updated_at' => now(),
                ]);
        }
        $ids = DB::table('legal_publication_deliveries')->whereIn('status', ['pending', 'retry'])
            ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))
            ->orderBy('id')->limit($limit)->pluck('id');
        foreach ($ids as $id) {
            $this->send((int) $id);
        }
        return $ids->count();
    }

    private function wasSent(object $row): bool
    {
        return DB::table('email_log')->where('tenant_id', $row->tenant_id)
            ->where('idempotency_key', 'legal-publication:' . $row->id)
            ->whereIn('status', ['sent', 'delivered', 'opened', 'clicked'])->exists();
    }

    private function send(int $id): void
    {
        $claimed = DB::table('legal_publication_deliveries')->where('id', $id)
            ->whereIn('status', ['pending', 'retry'])
            ->where(fn ($q) => $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now()))
            ->update(['status' => 'sending', 'claimed_at' => now(), 'attempts' => DB::raw('attempts + 1'), 'updated_at' => now()]);
        if (!$claimed) {
            return;
        }
        $row = DB::table('legal_publication_deliveries')->where('id', $id)->first();
        $priorTenant = TenantContext::currentId();
        $status = 'failed';
        $reason = null;
        try {
            if ($this->wasSent($row)) {
                $status = 'sent';
            } elseif (!TenantContext::setById($row->tenant_id)) {
                $reason = 'tenant_missing';
            } else {
                $user = DB::table('users')->where('id', $row->user_id)->where('tenant_id', $row->tenant_id)
                    ->where('status', 'active')->whereNull('deleted_at')
                    ->first(['id', 'email', 'first_name', 'preferred_language']);
                if (!$user) {
                    $status = 'skipped'; $reason = 'account_no_longer_active';
                } elseif (!filter_var($user->email, FILTER_VALIDATE_EMAIL) || EmailDispatchService::isUnroutableRecipient($user->email)) {
                    $status = 'skipped'; $reason = 'invalid_address';
                } elseif (Mailer::isSuppressed($user->email, 'legal_document')) {
                    $status = 'suppressed'; $reason = 'delivery_suppression';
                } else {
                    $sent = LocaleContext::withLocale($user, function () use ($row, $user) {
                        $vars = ['community' => $row->community_name, 'document' => $row->document_title, 'version' => $row->version_number];
                        $html = EmailTemplateBuilder::make()->title(__('emails.policy_publication.title'))
                            ->previewText(__('emails.policy_publication.intro', $vars))
                            ->greeting($user->first_name ?: __('emails.common.fallback_name'))
                            ->paragraph(e(__('emails.policy_publication.intro', $vars)))
                            ->paragraph('<strong>' . e(__('emails.policy_publication.changes')) . '</strong>')
                            ->paragraph(nl2br(e($row->summary ?: __('emails.policy_publication.no_summary'))))
                            ->button(__('emails.policy_publication.read'), self::trackingUrl((int) $row->id, 'click'))
                            ->paragraph(e(__('emails.policy_publication.service_notice')))->render();
                        $pixel = '<img src="' . e(self::trackingUrl((int) $row->id, 'open')) . '" width="1" height="1" alt="" style="display:block;width:1px;height:1px" />';
                        $html = str_replace('</body>', $pixel . '</body>', $html);
                        return EmailDispatchService::sendRaw($user->email,
                            __('emails.policy_publication.subject', $vars), $html,
                            null, null, null, 'legal_document', [
                                'tenant_id' => $row->tenant_id,
                                'idempotency_key' => 'legal-publication:' . $row->id,
                                'source' => self::class,
                                'textBody' => __('emails.policy_publication.intro', $vars) . "\n\n" . $row->summary . "\n\n" . self::trackingUrl((int) $row->id, 'click'),
                            ]);
                    });
                    $status = $sent ? 'sent' : ((int) $row->attempts >= 5 ? 'failed' : 'retry');
                    $reason = $sent ? null : 'transport_refused';
                }
            }
        } catch (\Throwable $e) {
            // An exception after submission may have an ambiguous outcome.
            $status = 'unknown'; $reason = 'transport_outcome_unknown';
            Log::warning('Policy publication email requires review', ['delivery_id' => $id, 'exception' => get_class($e)]);
        } finally {
            TenantContext::reset();
            if ($priorTenant !== null) {
                TenantContext::setById($priorTenant);
            }
        }
        DB::table('legal_publication_deliveries')->where('id', $id)->update([
            'status' => $status, 'reason' => $reason,
            'sent_at' => $status === 'sent' ? now() : null,
            'next_attempt_at' => $status === 'retry' ? now()->addMinutes(5 * (int) $row->attempts) : null,
            'updated_at' => now(),
        ]);
    }
}
