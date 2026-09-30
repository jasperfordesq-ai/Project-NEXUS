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

/** Publication and its recipient ledger commit together; the scheduler sends later. */
final class LegalPublicationDeliveryService
{
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
            $url = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix()
                . LegalDocumentService::documentPath((array) $version);
            $count = 0;
            // Service announcements include administrators and marketing opt-outs.
            DB::table('users')->where('tenant_id', $version->tenant_id)
                ->where('status', 'active')->whereNull('deleted_at')
                ->select('id')->orderBy('id')->chunkById(250, function ($users) use ($version, $url, &$count) {
                    foreach ($users as $user) {
                        $count += DB::table('legal_publication_deliveries')->insertOrIgnore([
                            'tenant_id' => $version->tenant_id, 'version_id' => $version->id,
                            'user_id' => $user->id, 'document_title' => $version->title,
                            'version_number' => $version->version_number,
                            'summary' => trim(strip_tags($version->summary_of_changes ?? '')),
                            'review_url' => $url, 'community_name' => TenantContext::getName(),
                            'status' => 'pending', 'attempts' => 0,
                            'created_at' => now(), 'updated_at' => now(),
                        ]);
                    }
                });
            return $count;
        });
    }

    public static function summary(int $tenantId, int $versionId): array
    {
        return DB::table('legal_publication_deliveries')
            ->where('tenant_id', $tenantId)->where('version_id', $versionId)
            ->selectRaw('status, COUNT(*) as total')->groupBy('status')
            ->pluck('total', 'status')->map(fn ($n) => (int) $n)->all();
    }

    /** Recent policy sends for the admin email overview. Provider delivery is
     * separate from transport submission: a submitted email can still bounce. */
    public static function recent(int $tenantId, int $limit = 20): array
    {
        $versionIds = DB::table('legal_publication_deliveries')
            ->where('tenant_id', $tenantId)->distinct()
            ->orderByDesc('version_id')->limit($limit)->pluck('version_id');
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
            ->where('l.tenant_id', $tenantId)->whereIn('l.version_id', $versionIds)
            ->selectRaw('d.id as document_id, d.title, v.id as version_id, v.version_number, v.published_at')
            ->selectRaw('COUNT(DISTINCT l.id) as recipients')
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status IN ('pending','retry','sending') THEN l.id END) as queued")
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status = 'sent' THEN l.id END) as submitted")
            ->selectRaw("COUNT(DISTINCT CASE WHEN l.status IN ('failed','suppressed','skipped','unknown') THEN l.id END) as exceptions")
            ->selectRaw("COUNT(DISTINCT CASE WHEN e.status IN ('delivered','opened','clicked') THEN l.id END) as delivered")
            ->selectRaw("COUNT(DISTINCT CASE WHEN e.status = 'bounced' THEN l.id END) as bounced")
            ->groupBy('d.id', 'd.title', 'v.id', 'v.version_number', 'v.published_at')
            ->orderByDesc('v.published_at')->get()->map(fn ($row) => (array) $row)->all();
    }

    public function processBatch(int $limit = 100): int
    {
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
                            ->button(__('emails.policy_publication.read'), $row->review_url)
                            ->paragraph(e(__('emails.policy_publication.service_notice')))->render();
                        return EmailDispatchService::sendRaw($user->email,
                            __('emails.policy_publication.subject', $vars), $html,
                            null, null, null, 'legal_document', [
                                'tenant_id' => $row->tenant_id,
                                'idempotency_key' => 'legal-publication:' . $row->id,
                                'source' => self::class,
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
