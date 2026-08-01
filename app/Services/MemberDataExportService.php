<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use ZipArchive;

/**
 * MemberDataExportService — GDPR / Swiss FADP personal-data portability.
 *
 * Builds a comprehensive, self-describing archive of all data the platform
 * holds about a single member within the current tenant. All sections are
 * tenant-scoped and schema-guarded so missing optional tables do not break
 * the export. Datetimes are emitted as ISO-8601, decimals as float.
 *
 * Returns either:
 *   - a single JSON file (developer-friendly), OR
 *   - a ZIP containing the JSON plus a plain-language README.md explaining
 *     each section, suitable for handing to a regulator or to the member.
 */
class MemberDataExportService
{
    public const FORMAT_VERSION = '1.0';

    /**
     * Build the structured archive for a user.
     *
     * @return array<string,mixed>
     */
    public function buildArchive(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();

        $tenant = DB::table('tenants')->where('id', $tenantId)->first();

        return [
            'format_version' => self::FORMAT_VERSION,
            'generated_at'   => now()->toIso8601String(),
            'tenant'         => [
                'slug' => $tenant->slug ?? null,
                'name' => $tenant->name ?? null,
            ],
            'profile'                    => $this->profile($userId, $tenantId),
            'addresses'                  => $this->addresses($userId, $tenantId),
            'wallet'                     => $this->wallet($userId, $tenantId),
            'vol_logs'                   => $this->volLogs($userId, $tenantId),
            'support_relationships'      => $this->supportRelationships($userId, $tenantId),
            'caring_favours'             => $this->caringFavours($userId, $tenantId),
            'caring_loyalty_redemptions' => $this->caringLoyaltyRedemptions($userId, $tenantId),
            'caring_hour_transfers'      => $this->caringHourTransfers($userId, $tenantId),
            'tandem_suggestions'         => $this->tandemSuggestions($userId, $tenantId),
            'listings'                   => $this->listings($userId, $tenantId),
            'events_attended'            => $this->eventsAttended($userId, $tenantId),
            'partner_venue_visits'       => $this->partnerVenueVisits($userId, $tenantId),
            'groups_membership'          => $this->groupsMembership($userId, $tenantId),
            'messages_metadata'          => $this->messagesMetadata($userId, $tenantId),
            'feed_posts'                 => $this->feedPosts($userId, $tenantId),
            'reviews_given'              => $this->reviewsGiven($userId, $tenantId),
            'reviews_received'           => $this->reviewsReceived($userId, $tenantId),
            'login_history'              => $this->loginHistory($userId),
            'notifications'              => $this->notifications($userId, $tenantId),
            'consents'                   => $this->consents($userId, $tenantId),
            'podcasts'                   => $this->podcasts($userId, $tenantId),
        ];
    }

    /**
     * Build a JSON archive ready for download.
     *
     * @return array{filename:string,content:string}
     */
    public function buildJsonArchive(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();
        $tenant   = DB::table('tenants')->where('id', $tenantId)->first();
        $slug     = $tenant->slug ?? 'tenant';

        $archive = $this->buildArchive($userId);
        $json    = json_encode(
            $archive,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        if ($json === false) {
            $json = '{}';
        }

        $filename = sprintf(
            'personal-data-%s-%d-%s.json',
            $slug,
            $userId,
            now()->format('Y-m-d')
        );

        return ['filename' => $filename, 'content' => $json];
    }

    /**
     * Build a multi-file ZIP containing data.json + README.md.
     *
     * @return array{filename:string,content:string}
     */
    public function buildZipArchive(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();
        $tenant   = DB::table('tenants')->where('id', $tenantId)->first();
        $slug     = $tenant->slug ?? 'tenant';

        $json    = $this->buildJsonArchive($userId);
        $readme  = $this->buildReadme($userId, $tenant->name ?? $slug);

        $tmpPath = tempnam(sys_get_temp_dir(), 'mde_');
        if ($tmpPath === false) {
            // Fallback: a degenerate zip is better than throwing on the user
            return [
                'filename' => str_replace('.json', '.zip', $json['filename']),
                'content'  => $json['content'],
            ];
        }

        $zip = new ZipArchive();
        if ($zip->open($tmpPath, ZipArchive::OVERWRITE) === true) {
            $zip->addFromString('data.json', $json['content']);
            $zip->addFromString('README.md', $readme);
            $zip->close();
        }

        $content = (string) @file_get_contents($tmpPath);
        @unlink($tmpPath);

        $filename = sprintf(
            'personal-data-%s-%d-%s.zip',
            $slug,
            $userId,
            now()->format('Y-m-d')
        );

        return ['filename' => $filename, 'content' => $content];
    }

    /**
     * Persist an export-request audit row. Called both before the archive is
     * built (rate-limit + forensic record) and again on completion (size).
     */
    public function recordExportRequest(int $userId, string $format): int
    {
        $tenantId = (int) TenantContext::getId();
        $format   = $format === 'zip' ? 'zip' : 'json';

        if (!Schema::hasTable('member_data_exports')) {
            return 0;
        }

        $ip = request()?->ip();
        $ua = request()?->userAgent();

        return (int) DB::table('member_data_exports')->insertGetId([
            'tenant_id'    => $tenantId,
            'user_id'      => $userId,
            'format'       => $format,
            'requested_at' => now(),
            'ip_address'   => $ip ? substr((string) $ip, 0, 45) : null,
            'user_agent'   => $ua ? substr((string) $ua, 0, 500) : null,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);
    }

    /**
     * Mark an export row as completed with a known file size.
     */
    public function markCompleted(int $exportId, int $sizeBytes): void
    {
        if ($exportId <= 0 || !Schema::hasTable('member_data_exports')) {
            return;
        }

        DB::table('member_data_exports')
            ->where('id', $exportId)
            ->update([
                'completed_at'    => now(),
                'file_size_bytes' => $sizeBytes,
                'updated_at'      => now(),
            ]);
    }

    /**
     * Count how many export requests this user has made in the last 24h.
     * Used by the controller to enforce the 5-per-day rate limit.
     */
    public function countRecentRequests(int $userId): int
    {
        $tenantId = (int) TenantContext::getId();
        if (!Schema::hasTable('member_data_exports')) {
            return 0;
        }

        return (int) DB::table('member_data_exports')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('requested_at', '>=', now()->subDay())
            ->count();
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function recentHistory(int $userId, int $limit = 10): array
    {
        $tenantId = (int) TenantContext::getId();
        if (!Schema::hasTable('member_data_exports')) {
            return [];
        }

        $rows = DB::table('member_data_exports')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('requested_at')
            ->limit($limit)
            ->get(['id', 'format', 'requested_at', 'completed_at', 'file_size_bytes']);

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'id'              => (int) $row->id,
                'format'          => (string) $row->format,
                'requested_at'    => $this->iso($row->requested_at),
                'completed_at'    => $this->iso($row->completed_at),
                'file_size_bytes' => $row->file_size_bytes !== null ? (int) $row->file_size_bytes : null,
            ];
        }
        return $out;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Section builders — every one is tenant-scoped and schema-guarded.
    // ─────────────────────────────────────────────────────────────────────

    private function profile(int $userId, int $tenantId): array
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$user) {
            return [];
        }

        $cols = [
            'id', 'first_name', 'last_name', 'name', 'email', 'phone',
            'date_of_birth', 'bio', 'tagline', 'location', 'profile_type',
            'organization_name', 'avatar_url', 'preferred_language',
            'preferred_theme', 'role', 'status', 'created_at', 'updated_at',
        ];

        $out = [];
        foreach ($cols as $c) {
            if (!property_exists($user, $c)) {
                continue;
            }
            $val      = $user->$c;
            $out[$c]  = in_array($c, ['created_at', 'updated_at', 'date_of_birth'], true)
                ? $this->iso($val)
                : $val;
        }

        // languages / interests / skills metadata if present in side tables
        if (Schema::hasTable('user_skills')) {
            $out['skills'] = DB::table('user_skills')
                ->where('user_id', $userId)
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();
        }

        return $out;
    }

    /** @return array<int,array<string,mixed>> */
    private function addresses(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('user_addresses')) {
            return [];
        }

        $q = DB::table('user_addresses')->where('user_id', $userId);
        if (Schema::hasColumn('user_addresses', 'tenant_id')) {
            $q->where('tenant_id', $tenantId);
        }
        return $q->get()->map(fn ($r) => (array) $r)->all();
    }

    /** @return array<string,mixed> */
    private function wallet(int $userId, int $tenantId): array
    {
        $balance = (float) (DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('balance') ?? 0);

        $transactions = [];
        $totalIn      = 0.0;
        $totalOut     = 0.0;

        if (Schema::hasTable('transactions')) {
            $rows = DB::table('transactions')
                ->where('tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
                ->orderByDesc('created_at')
                ->get();

            foreach ($rows as $r) {
                $direction = ((int) $r->receiver_id === $userId) ? 'in' : 'out';
                $amt       = (float) ($r->amount ?? 0);
                if ($direction === 'in') {
                    $totalIn += $amt;
                } else {
                    $totalOut += $amt;
                }

                $transactions[] = [
                    'id'             => (int) $r->id,
                    'direction'      => $direction,
                    'amount'         => $amt,
                    'description'    => $r->description ?? null,
                    'sender_id'      => (int) ($r->sender_id ?? 0),
                    'receiver_id'    => (int) ($r->receiver_id ?? 0),
                    'listing_id'     => isset($r->listing_id) ? (int) $r->listing_id : null,
                    'status'         => $r->status ?? null,
                    'is_federated'   => (bool) ($r->is_federated ?? false),
                    'transaction_type' => $r->transaction_type ?? null,
                    'created_at'     => $this->iso($r->created_at ?? null),
                ];
            }
        }

        return [
            'balance'           => $balance,
            'lifetime_credits'  => $totalIn,
            'lifetime_debits'   => $totalOut,
            'transactions'      => $transactions,
        ];
    }

    /** @return array<string,mixed> */
    private function volLogs(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return ['given' => [], 'received' => []];
        }

        $given = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('date_logged')
            ->get();

        $received = collect();
        if (Schema::hasColumn('vol_logs', 'support_recipient_id')) {
            $received = DB::table('vol_logs')
                ->where('tenant_id', $tenantId)
                ->where('support_recipient_id', $userId)
                ->orderByDesc('date_logged')
                ->get();
        }

        $shape = function ($rows) {
            $out = [];
            foreach ($rows as $r) {
                $out[] = [
                    'id'              => (int) $r->id,
                    'organization_id' => isset($r->organization_id) ? (int) $r->organization_id : null,
                    'opportunity_id'  => isset($r->opportunity_id) ? (int) $r->opportunity_id : null,
                    'support_recipient_id' => isset($r->support_recipient_id) ? (int) $r->support_recipient_id : null,
                    'caring_support_relationship_id' => isset($r->caring_support_relationship_id) ? (int) $r->caring_support_relationship_id : null,
                    'date_logged'     => $this->iso($r->date_logged ?? null),
                    'hours'           => (float) ($r->hours ?? 0),
                    'description'     => $r->description ?? null,
                    'status'          => $r->status ?? null,
                    'feedback'        => $r->feedback ?? null,
                    'created_at'      => $this->iso($r->created_at ?? null),
                ];
            }
            return $out;
        };

        return [
            'given'    => $shape($given),
            'received' => $shape($received),
        ];
    }

    /** @return array<string,array<int,array<string,mixed>>> */
    /**
     * Recorded visits to partner venues.
     *
     * This is movement data — where a member went and when — so it belongs in a
     * subject access request even though the member never entered it themselves;
     * venue staff recorded it on their behalf. The membership pass token is
     * deliberately NOT exported: it is a live bearer credential, and putting it
     * in a downloadable archive would turn a leaked export into a usable pass.
     * The member can see and rotate the token in the app instead.
     *
     * @return array<int, array<string, mixed>>
     */
    private function partnerVenueVisits(int $userId, int $tenantId): array
    {
        if (! Schema::hasTable('partner_venue_visits') || ! Schema::hasTable('partner_venues')) {
            return [];
        }

        $rows = DB::table('partner_venue_visits as v')
            ->leftJoin('partner_venues as pv', function ($join) use ($tenantId): void {
                $join->on('pv.id', '=', 'v.venue_id')
                    ->where('pv.tenant_id', '=', $tenantId);
            })
            ->where('v.tenant_id', $tenantId)
            ->where('v.user_id', $userId)
            ->orderByDesc('v.visited_at')
            ->get(['v.id', 'v.venue_id', 'pv.name as venue_name', 'v.source', 'v.visited_on', 'v.visited_at', 'v.created_at']);

        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => (int) $r->id,
                'venue_id' => (int) $r->venue_id,
                'venue_name' => $r->venue_name ?? null,
                'source' => $r->source ?? null,
                'visited_on' => $r->visited_on ?? null,
                'visited_at' => $this->iso($r->visited_at ?? null),
                'created_at' => $this->iso($r->created_at ?? null),
            ];
        }

        return $out;
    }

    private function supportRelationships(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('caring_support_relationships')) {
            return ['as_supporter' => [], 'as_recipient' => []];
        }

        $shape = function ($rows) {
            $out = [];
            foreach ($rows as $r) {
                $out[] = [
                    'id'             => (int) $r->id,
                    'supporter_id'   => (int) $r->supporter_id,
                    'recipient_id'   => (int) $r->recipient_id,
                    'coordinator_id' => isset($r->coordinator_id) ? (int) $r->coordinator_id : null,
                    'organization_id'=> isset($r->organization_id) ? (int) $r->organization_id : null,
                    'category_id'    => isset($r->category_id) ? (int) $r->category_id : null,
                    'title'          => $r->title ?? null,
                    'description'    => $r->description ?? null,
                    'frequency'      => $r->frequency ?? null,
                    'expected_hours' => (float) ($r->expected_hours ?? 0),
                    'start_date'     => $this->iso($r->start_date ?? null),
                    'end_date'       => $this->iso($r->end_date ?? null),
                    'status'         => $r->status ?? null,
                    'last_logged_at' => $this->iso($r->last_logged_at ?? null),
                    'created_at'     => $this->iso($r->created_at ?? null),
                ];
            }
            return $out;
        };

        $asSupporter = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('supporter_id', $userId)
            ->orderByDesc('created_at')
            ->get();

        $asRecipient = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('recipient_id', $userId)
            ->orderByDesc('created_at')
            ->get();

        return [
            'as_supporter' => $shape($asSupporter),
            'as_recipient' => $shape($asRecipient),
        ];
    }

    /** @return array<string,array<int,array<string,mixed>>> */
    private function caringFavours(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('caring_favours')) {
            return ['offered' => [], 'received' => []];
        }

        $shape = function ($rows) {
            $out = [];
            foreach ($rows as $r) {
                $out[] = [
                    'id'                   => (int) $r->id,
                    'offered_by_user_id'   => (int) $r->offered_by_user_id,
                    'received_by_user_id'  => isset($r->received_by_user_id) ? (int) $r->received_by_user_id : null,
                    'category'             => $r->category ?? null,
                    'description'          => $r->description ?? null,
                    'favour_date'          => $this->iso($r->favour_date ?? null),
                    'is_anonymous'         => (bool) ($r->is_anonymous ?? false),
                    'created_at'           => $this->iso($r->created_at ?? null),
                ];
            }
            return $out;
        };

        $offered = DB::table('caring_favours')
            ->where('tenant_id', $tenantId)
            ->where('offered_by_user_id', $userId)
            ->orderByDesc('favour_date')
            ->get();

        $received = DB::table('caring_favours')
            ->where('tenant_id', $tenantId)
            ->where('received_by_user_id', $userId)
            ->orderByDesc('favour_date')
            ->get();

        return [
            'offered'  => $shape($offered),
            'received' => $shape($received),
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function caringLoyaltyRedemptions(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('caring_loyalty_redemptions')) {
            return [];
        }

        return DB::table('caring_loyalty_redemptions')
            ->where('tenant_id', $tenantId)
            ->where('member_user_id', $userId)
            ->orderByDesc('redeemed_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'                     => (int) $r->id,
                    'merchant_user_id'       => (int) $r->merchant_user_id,
                    'marketplace_listing_id' => isset($r->marketplace_listing_id) ? (int) $r->marketplace_listing_id : null,
                    'marketplace_order_id'   => isset($r->marketplace_order_id) ? (int) $r->marketplace_order_id : null,
                    'credits_used'           => (float) ($r->credits_used ?? 0),
                    'exchange_rate_chf'      => (float) ($r->exchange_rate_chf ?? 0),
                    'discount_chf'           => (float) ($r->discount_chf ?? 0),
                    'order_total_chf'        => (float) ($r->order_total_chf ?? 0),
                    'status'                 => $r->status ?? null,
                    'redeemed_at'            => $this->iso($r->redeemed_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<string,array<int,array<string,mixed>>> */
    private function caringHourTransfers(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('caring_hour_transfers')) {
            return ['outgoing' => [], 'incoming' => []];
        }

        $rows = DB::table('caring_hour_transfers')
            ->where('tenant_id', $tenantId)
            ->where('member_user_id', $userId)
            ->orderByDesc('created_at')
            ->get();

        $outgoing = [];
        $incoming = [];
        foreach ($rows as $r) {
            $entry = [
                'id'                       => (int) $r->id,
                'role'                     => $r->role ?? null,
                'counterpart_tenant_slug'  => $r->counterpart_tenant_slug ?? null,
                'counterpart_member_email' => $r->counterpart_member_email ?? null,
                'hours_transferred'        => (float) ($r->hours_transferred ?? 0),
                'status'                   => $r->status ?? null,
                'reason'                   => $r->reason ?? null,
                'created_at'               => $this->iso($r->created_at ?? null),
            ];
            if (($r->role ?? null) === 'source') {
                $outgoing[] = $entry;
            } else {
                $incoming[] = $entry;
            }
        }

        return ['outgoing' => $outgoing, 'incoming' => $incoming];
    }

    /** @return array<int,array<string,mixed>> */
    private function tandemSuggestions(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('caring_tandem_suggestion_log')) {
            return [];
        }

        return DB::table('caring_tandem_suggestion_log')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('supporter_user_id', $userId)
                  ->orWhere('recipient_user_id', $userId);
            })
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'                 => (int) $r->id,
                    'supporter_user_id'  => (int) $r->supporter_user_id,
                    'recipient_user_id'  => (int) $r->recipient_user_id,
                    'action'             => $r->action ?? null,
                    'created_by_user_id' => isset($r->created_by_user_id) ? (int) $r->created_by_user_id : null,
                    'created_at'         => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function listings(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('listings')) {
            return [];
        }

        return DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'           => (int) $r->id,
                    'title'        => $r->title ?? null,
                    'description'  => $r->description ?? null,
                    'type'         => $r->type ?? null,
                    'status'       => $r->status ?? null,
                    'category_id'  => isset($r->category_id) ? (int) $r->category_id : null,
                    'location'     => $r->location ?? null,
                    'price'        => (float) ($r->price ?? 0),
                    'created_at'   => $this->iso($r->created_at ?? null),
                    'updated_at'   => $this->iso($r->updated_at ?? null),
                    'expires_at'   => $this->iso($r->expires_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function eventsAttended(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('event_rsvps')) {
            return [];
        }

        return DB::table('event_rsvps')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'              => (int) $r->id,
                    'event_id'        => (int) $r->event_id,
                    'status'          => $r->status ?? null,
                    'checked_in_at'   => $this->iso($r->checked_in_at ?? null),
                    'checked_out_at'  => $this->iso($r->checked_out_at ?? null),
                    'created_at'      => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function groupsMembership(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('group_members')) {
            return [];
        }

        $q = DB::table('group_members')->where('user_id', $userId);
        if (Schema::hasColumn('group_members', 'tenant_id')) {
            $q->where('tenant_id', $tenantId);
        }
        return $q->orderByDesc('joined_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'         => (int) $r->id,
                    'group_id'   => (int) $r->group_id,
                    'role'       => $r->role ?? null,
                    'status'     => $r->status ?? null,
                    'joined_at'  => $this->iso($r->joined_at ?? null),
                    'created_at' => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<string,mixed> */
    private function messagesMetadata(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('messages')) {
            return ['sent_count' => 0, 'received_count' => 0, 'conversations_participated' => 0];
        }

        $sent = (int) DB::table('messages')
            ->where('tenant_id', $tenantId)
            ->where('sender_id', $userId)
            ->count();

        $received = (int) DB::table('messages')
            ->where('tenant_id', $tenantId)
            ->where('receiver_id', $userId)
            ->count();

        $conversations = 0;
        if (Schema::hasColumn('messages', 'conversation_id')) {
            $conversations = (int) DB::table('messages')
                ->where('tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
                ->whereNotNull('conversation_id')
                ->distinct()
                ->count('conversation_id');
        }

        return [
            'sent_count'                  => $sent,
            'received_count'              => $received,
            'conversations_participated'  => $conversations,
            'note'                        => 'Message contents intentionally excluded for privacy of conversation partners. Counts only.',
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function feedPosts(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('feed_posts')) {
            return [];
        }

        return DB::table('feed_posts')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'             => (int) $r->id,
                    'content'        => $r->content ?? null,
                    'group_id'       => isset($r->group_id) ? (int) $r->group_id : null,
                    'visibility'     => $r->visibility ?? null,
                    'publish_status' => $r->publish_status ?? null,
                    'type'           => $r->type ?? null,
                    'likes_count'    => (int) ($r->likes_count ?? 0),
                    'created_at'     => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function reviewsGiven(int $userId, int $tenantId): array
    {
        return $this->reviews($userId, $tenantId, 'reviewer_id');
    }

    /** @return array<int,array<string,mixed>> */
    private function reviewsReceived(int $userId, int $tenantId): array
    {
        return $this->reviews($userId, $tenantId, 'receiver_id');
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    private function reviews(int $userId, int $tenantId, string $col): array
    {
        if (!Schema::hasTable('reviews')) {
            return [];
        }

        return DB::table('reviews')
            ->where('tenant_id', $tenantId)
            ->where($col, $userId)
            ->orderByDesc('created_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'           => (int) $r->id,
                    'reviewer_id'  => (int) $r->reviewer_id,
                    'receiver_id'  => (int) $r->receiver_id,
                    'rating'       => (int) ($r->rating ?? 0),
                    'comment'      => $r->comment ?? null,
                    'review_type'  => $r->review_type ?? null,
                    'is_anonymous' => (bool) ($r->is_anonymous ?? false),
                    'status'       => $r->status ?? null,
                    'created_at'   => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function loginHistory(int $userId): array
    {
        // Best-effort: prefer login_history if present, else login_attempts (less personal but the closest analogue we have).
        if (Schema::hasTable('login_history')) {
            $q = DB::table('login_history')->where('user_id', $userId);
            return $q->orderByDesc('created_at')
                ->limit(50)
                ->get()
                ->map(fn ($r) => (array) $r)
                ->all();
        }

        if (Schema::hasTable('login_attempts')) {
            $email = (string) (DB::table('users')->where('id', $userId)->value('email') ?? '');
            if ($email === '') {
                return [];
            }
            return DB::table('login_attempts')
                ->where('identifier', $email)
                ->orderByDesc('attempted_at')
                ->limit(50)
                ->get()
                ->map(function ($r) {
                    return [
                        'identifier'   => $r->identifier ?? null,
                        'type'         => $r->type ?? null,
                        'ip_address'   => $r->ip_address ?? null,
                        'success'      => (bool) ($r->success ?? false),
                        'attempted_at' => $this->iso($r->attempted_at ?? null),
                    ];
                })
                ->all();
        }

        return [];
    }

    /** @return array<int,array<string,mixed>> */
    private function notifications(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('notifications')) {
            return [];
        }

        $q = DB::table('notifications')->where('user_id', $userId);
        if (Schema::hasColumn('notifications', 'tenant_id')) {
            $q->where('tenant_id', $tenantId);
        }
        return $q->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->map(function ($r) {
                return [
                    'id'         => (int) $r->id,
                    'type'       => $r->type ?? null,
                    'title'      => $r->title ?? null,
                    'message'    => $r->message ?? null,
                    'is_read'    => (bool) ($r->is_read ?? false),
                    'created_at' => $this->iso($r->created_at ?? null),
                ];
            })
            ->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function consents(int $userId, int $tenantId): array
    {
        if (!Schema::hasTable('user_consents')) {
            return [];
        }

        return DB::table('user_consents')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('given_at')
            ->get()
            ->map(function ($r) {
                return [
                    'id'              => (int) $r->id,
                    'consent_type'    => $r->consent_type ?? null,
                    'consent_given'   => (bool) ($r->consent_given ?? false),
                    'consent_version' => $r->consent_version ?? null,
                    'source'          => $r->source ?? null,
                    'given_at'        => $this->iso($r->given_at ?? null),
                    'withdrawn_at'    => $this->iso($r->withdrawn_at ?? null),
                ];
            })
            ->all();
    }

    /**
     * Podcast content and engagement directly attributable to the member.
     * Other listeners/subscribers are deliberately excluded from an owner's
     * archive because those records belong to those other data subjects.
     *
     * @return array<string,mixed>
     */
    private function podcasts(int $userId, int $tenantId): array
    {
        $empty = [
            'shows_owned' => [],
            'episodes_authored' => [],
            'chapters_authored' => [],
            'listens' => [],
            'reactions' => [],
            'subscriptions' => [],
            'reports_filed' => [],
            'moderation_activity' => [
                'shows' => [],
                'episodes' => [],
                'reports_reviewed' => [],
            ],
        ];

        if (!Schema::hasTable('podcast_shows')) {
            return $empty;
        }

        $rows = static fn ($query): array => $query->get()
            ->map(static fn ($row): array => (array) $row)
            ->all();

        $empty['shows_owned'] = $rows(
            DB::table('podcast_shows')
                ->where('tenant_id', $tenantId)
                ->where('owner_user_id', $userId)
                ->orderByDesc('created_at')
        );

        if (Schema::hasTable('podcast_episodes')) {
            $empty['episodes_authored'] = $rows(
                DB::table('podcast_episodes')
                    ->where('tenant_id', $tenantId)
                    ->where('author_user_id', $userId)
                    ->orderByDesc('created_at')
            );

            $episodeIds = array_map(
                static fn (array $episode): int => (int) $episode['id'],
                $empty['episodes_authored']
            );
            if ($episodeIds !== [] && Schema::hasTable('podcast_episode_chapters')) {
                $empty['chapters_authored'] = $rows(
                    DB::table('podcast_episode_chapters')
                        ->where('tenant_id', $tenantId)
                        ->whereIn('episode_id', $episodeIds)
                        ->orderBy('episode_id')
                        ->orderBy('position')
                );
            }

            if (Schema::hasColumn('podcast_episodes', 'moderated_by')) {
                $empty['moderation_activity']['episodes'] = $rows(
                    DB::table('podcast_episodes')
                        ->where('tenant_id', $tenantId)
                        ->where('moderated_by', $userId)
                        ->select(['id', 'show_id', 'moderation_status', 'moderated_at'])
                        ->orderByDesc('moderated_at')
                );
            }
        }

        foreach ([
            'podcast_episode_listens' => ['key' => 'listens', 'column' => 'user_id'],
            'podcast_episode_reactions' => ['key' => 'reactions', 'column' => 'user_id'],
            'podcast_show_subscriptions' => ['key' => 'subscriptions', 'column' => 'user_id'],
            'podcast_episode_reports' => ['key' => 'reports_filed', 'column' => 'reporter_user_id'],
        ] as $table => $mapping) {
            if (!Schema::hasTable($table)) {
                continue;
            }
            $empty[$mapping['key']] = $rows(
                DB::table($table)
                    ->where('tenant_id', $tenantId)
                    ->where($mapping['column'], $userId)
                    ->orderByDesc('id')
            );
        }

        if (Schema::hasColumn('podcast_shows', 'moderated_by')) {
            $empty['moderation_activity']['shows'] = $rows(
                DB::table('podcast_shows')
                    ->where('tenant_id', $tenantId)
                    ->where('moderated_by', $userId)
                    ->select(['id', 'moderation_status', 'moderated_at'])
                    ->orderByDesc('moderated_at')
            );
        }
        if (Schema::hasTable('podcast_episode_reports') && Schema::hasColumn('podcast_episode_reports', 'reviewed_by')) {
            $empty['moderation_activity']['reports_reviewed'] = $rows(
                DB::table('podcast_episode_reports')
                    ->where('tenant_id', $tenantId)
                    ->where('reviewed_by', $userId)
                    ->select(['id', 'episode_id', 'status', 'reviewed_at'])
                    ->orderByDesc('reviewed_at')
            );
        }

        return $empty;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            return \Carbon\Carbon::parse((string) $value)->toIso8601String();
        } catch (\Throwable) {
            return (string) $value;
        }
    }

    private function buildReadme(int $userId, string $tenantName): string
    {
        $generated = now()->toDayDateTimeString();
        $podcastsTitle = __('govuk_alpha.podcasts.title');
        $podcastsDescription = __('govuk_alpha.podcasts.description');
        return <<<MD
# Personal Data Archive

**Community:** {$tenantName}
**Member ID:** {$userId}
**Generated:** {$generated}
**Format version:** 1.0

This archive contains every piece of personal data this community holds about
you. It was generated automatically when you requested a data export from the
Settings page. Keep this file private — it contains personal information.

## What's inside

The `data.json` file is a single structured document with the following top-level
sections. Empty sections mean we hold no data of that kind for you.

### profile
Your account: name, email, phone, date of birth, bio, location, profile type
(individual or organisation), preferred language and theme, role, and account
status. Includes your skills if you've added any.

### addresses
Postal addresses you've saved on your profile (if the address feature is
enabled in this community).

### wallet
Your time-credit wallet: current balance, lifetime credits earned, lifetime
debits spent, and every individual transaction (the hours moving in and out of
your wallet, what they were for, and when).

### vol_logs
Hours of community support — both **given** (hours you contributed) and
**received** (hours someone supported you). Each entry records the date, the
hours, the supporter or recipient, status, and any feedback.

### support_relationships
Ongoing care/support pairings: as a **supporter** (you help someone) and as a
**recipient** (someone helps you). Includes the title, expected frequency,
expected weekly hours, start and end dates, and current status.

### caring_favours
Informal, anonymous-allowed favours offered or received within the community.
Smaller and more casual than scheduled support relationships.

### caring_loyalty_redemptions
Time credits you've redeemed at participating local merchants — amount of
credits used, the discount value in CHF, and the order total at the time of
redemption.

### caring_hour_transfers
Cross-cooperative hour transfers — hours you've sent **out** to a member at
another timebank, and hours you've **received** from one. Each row shows the
counterpart cooperative and the email of the receiving member.

### tandem_suggestions
Records of when the matching engine suggested you as a tandem (supporter or
recipient) with another member, and whether the suggestion led to a real
relationship or was dismissed.

### listings
Every listing you've created (offers, requests, etc.) — title, description,
category, type, status, location, price, and dates.

### events_attended
Your RSVPs to community events — the event ID, your attendance status,
check-in and check-out times.

### groups_membership
Every group you've joined — group ID, your role (member, admin, owner), join
date, and current status.

### messages_metadata
**Counts only**: how many messages you've sent and received, and how many
distinct conversations you've participated in. We deliberately do **not**
include message contents in this archive — those belong to both you and the
other person, and exporting them would breach the other person's privacy.

If you need a specific conversation's contents, contact your community admin
who can extract it on your behalf with appropriate consent.

### feed_posts
Every post you've authored on the community feed — content, visibility,
publication status, and timestamps.

### reviews_given / reviews_received
Reviews you've written about other members (`reviews_given`) and reviews other
members have written about you (`reviews_received`). Each row contains the
rating, comment, type, and dates.

### login_history
The last 50 login events recorded for your account (where available) —
timestamp, IP address, success/failure. Used to help you spot unfamiliar
sign-ins.

### notifications
The last 100 notifications you've received — type, title, message, read
status, and timestamp.

### consents
Every consent record we hold for you — what you agreed to, which version of
the document, when, and whether you've since withdrawn it.

### {$podcastsTitle}
{$podcastsDescription}

## Your rights

Under the **Swiss FADP** (and the **EU GDPR** where applicable) you have the
right to:

1. **Access** — request a copy of your data (this archive).
2. **Portability** — receive that data in a machine-readable format
   (the included JSON file).
3. **Rectification** — correct anything that's wrong.
4. **Erasure** — request deletion of your account and data.
5. **Restriction** — limit how we process your data.
6. **Objection** — object to particular processing.

You can exercise any of these from the **Settings → Privacy & Data** page or
by contacting your community admin.

## Support

If anything in this archive looks wrong, missing, or surprising — contact
your community admin. They will either fix it directly or escalate to the
platform team.

---

*This archive was generated by Project NEXUS.*
*Format version 1.0 — section names and field shapes are stable; new sections
may be added in later versions but existing ones won't be silently renamed.*
MD;
    }
}
