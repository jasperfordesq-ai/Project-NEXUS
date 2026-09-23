<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * AG94 — Newsletter and pilot-region lead nurture flow.
 *
 * Captures consented contact records for five segments: municipality,
 * investor, business, resident, partner. Records carry source attribution,
 * locale, interest segment, follow-up stage, and consent timestamp so the
 * admin can drive a segmented nurture cadence and export the list to a
 * CRM/email provider.
 *
 * Storage: single `tenant_settings` JSON envelope under
 * `caring.lead_nurture.contacts`. Each contact gets a stable
 * `lead_<hex>` ID. Distinct from `pilot_inquiries` (AG71): pilot_inquiries
 * is the qualified-municipality funnel; this nurture surface is the
 * shallower top-of-funnel capture for any segment.
 *
 * F-131: the envelope is never trimmed. When it is full (by count, or by the
 * size of the tenant_settings TEXT column) new captures are refused and
 * logged instead of evicting or truncating existing leads, and every
 * read-modify-write runs under a row lock. A dedicated table is the proper
 * long-term home for this data.
 */
class LeadNurtureService
{
    public const SETTING_KEY = 'caring.lead_nurture.contacts';
    public const MAX_CONTACTS = 5000;

    /**
     * tenant_settings.setting_value is a TEXT column (65,535 bytes). Writing
     * more is silently truncated in non-strict mode, which corrupts the JSON
     * and loses every lead, so stay safely below it.
     */
    public const MAX_ENVELOPE_BYTES = 60000;

    public const SEGMENTS = ['municipality', 'investor', 'business', 'resident', 'partner'];
    public const STAGES = ['captured', 'contacted', 'engaged', 'qualified', 'converted', 'dormant', 'unsubscribed'];

    public function listContacts(
        int $tenantId,
        ?string $segmentFilter = null,
        ?string $stageFilter = null,
        int $limit = 200,
    ): array {
        $envelope = $this->loadEnvelope($tenantId);
        $items = $envelope['items'] ?? [];

        if ($segmentFilter !== null && $segmentFilter !== '') {
            $items = array_values(array_filter(
                $items,
                fn ($c) => ($c['segment'] ?? null) === $segmentFilter,
            ));
        }
        if ($stageFilter !== null && $stageFilter !== '') {
            $items = array_values(array_filter(
                $items,
                fn ($c) => ($c['stage'] ?? null) === $stageFilter,
            ));
        }

        usort($items, fn ($a, $b) => strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? '')));

        return [
            'items'           => array_slice($items, 0, $limit),
            'total'           => count($items),
            'last_updated_at' => $envelope['updated_at'] ?? null,
        ];
    }

    /**
     * Public capture entrypoint. Validates input, deduplicates by email
     * within tenant, returns ['contact' => ...] or ['errors' => ...].
     *
     * @param array<string, mixed> $payload
     */
    public function capture(int $tenantId, array $payload, ?string $sourceIp = null): array
    {
        $errors = [];

        $email = trim((string) ($payload['email'] ?? ''));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = ['field' => 'email', 'message' => 'must be a valid email'];
        }

        $segment = (string) ($payload['segment'] ?? 'resident');
        if (!in_array($segment, self::SEGMENTS, true)) {
            $errors[] = ['field' => 'segment', 'message' => 'invalid segment'];
        }

        $consent = (bool) ($payload['consent'] ?? false);
        if (!$consent) {
            $errors[] = ['field' => 'consent', 'message' => 'consent is required'];
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return $this->mutateEnvelope($tenantId, function (array $envelope) use ($tenantId, $payload, $email, $segment, $sourceIp): array {
            $items = $envelope['items'] ?? [];

            // Refuse (never evict) once the list is full. Checked before the
            // duplicate lookup so a full list does not answer differently for
            // emails that are already on it.
            if (count($items) >= $this->maxContacts()) {
                Log::warning('[LeadNurture] lead list full; capture refused', [
                    'tenant_id' => $tenantId,
                    'count'     => count($items),
                ]);
                return [['unavailable' => true], null];
            }

            // Deduplicate by lowercase email within tenant.
            $emailLc = mb_strtolower($email);
            foreach ($items as $existing) {
                if (mb_strtolower((string) ($existing['email'] ?? '')) === $emailLc) {
                    return [['contact' => $existing, 'duplicate' => true], null];
                }
            }

            $contact = $this->buildContact($payload, $email, $segment, $sourceIp);
            array_unshift($items, $contact);

            return [
                ['contact' => $contact, 'duplicate' => false],
                ['items' => $items, 'updated_at' => $contact['created_at']],
            ];
        }, ['unavailable' => true]);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function buildContact(array $payload, string $email, string $segment, ?string $sourceIp): array
    {
        $now = now()->toIso8601String();
        $contact = [
            'id'             => 'lead_' . substr(bin2hex(random_bytes(8)), 0, 16),
            'name'           => $this->trimNullable($payload['name'] ?? null, 200),
            'email'          => $email,
            'phone'          => $this->trimNullable($payload['phone'] ?? null, 50),
            'organisation'   => $this->trimNullable($payload['organisation'] ?? null, 200),
            'segment'        => $segment,
            'source'         => $this->trimNullable($payload['source'] ?? null, 100),
            'locale'         => $this->trimNullable($payload['locale'] ?? null, 10),
            'interests'      => $this->normaliseList($payload['interests'] ?? null, 20),
            'stage'          => 'captured',
            'consent'        => true,
            'consent_at'     => $now,
            'consent_ip'     => $sourceIp,
            'follow_up_at'   => null,
            'last_contacted_at' => null,
            'notes'          => null,
            'created_at'     => $now,
            'updated_at'     => $now,
        ];

        return $contact;
    }

    /**
     * Maximum number of stored contacts. Overridable for tests.
     */
    protected function maxContacts(): int
    {
        return self::MAX_CONTACTS;
    }

    /**
     * Admin update: stage progression + notes + follow_up_at scheduling.
     *
     * @param array<string, mixed> $payload
     */
    public function update(int $tenantId, string $contactId, array $payload): array
    {
        $storageFull = ['errors' => [['field' => 'notes', 'message' => __('api.caring_lead_storage_full')]]];

        return $this->mutateEnvelope($tenantId, function (array $envelope) use ($contactId, $payload): array {
            $items = $envelope['items'] ?? [];

            $found = null;
            foreach ($items as $i => $c) {
                if (($c['id'] ?? null) === $contactId) {
                    $found = $i;
                    break;
                }
            }

            if ($found === null) {
                return [['error' => 'not_found'], null];
            }

            $errors = [];
            $contact = $items[$found];

            if (array_key_exists('stage', $payload)) {
                $stage = (string) $payload['stage'];
                if (!in_array($stage, self::STAGES, true)) {
                    $errors[] = ['field' => 'stage', 'message' => 'invalid stage'];
                } else {
                    $contact['stage'] = $stage;
                }
            }
            if (array_key_exists('notes', $payload)) {
                $contact['notes'] = $this->trimNullable($payload['notes'], 2000);
            }
            if (array_key_exists('follow_up_at', $payload)) {
                $contact['follow_up_at'] = $this->trimNullable($payload['follow_up_at'], 40);
            }
            if (array_key_exists('last_contacted_at', $payload)) {
                $contact['last_contacted_at'] = $this->trimNullable($payload['last_contacted_at'], 40);
            }

            if ($errors !== []) {
                return [['errors' => $errors], null];
            }

            $now = now()->toIso8601String();
            $contact['updated_at'] = $now;
            $items[$found] = $contact;

            return [['contact' => $contact], ['items' => $items, 'updated_at' => $now]];
        }, $storageFull);
    }

    public function unsubscribe(int $tenantId, string $contactId): array
    {
        return $this->update($tenantId, $contactId, ['stage' => 'unsubscribed']);
    }

    public function summary(int $tenantId): array
    {
        $envelope = $this->loadEnvelope($tenantId);
        $items = $envelope['items'] ?? [];
        $bySegment = [];
        $byStage = [];
        foreach ($items as $c) {
            $seg = (string) ($c['segment'] ?? 'resident');
            $stg = (string) ($c['stage'] ?? 'captured');
            $bySegment[$seg] = ($bySegment[$seg] ?? 0) + 1;
            $byStage[$stg]   = ($byStage[$stg]   ?? 0) + 1;
        }
        return [
            'total'           => count($items),
            'by_segment'      => $bySegment,
            'by_stage'        => $byStage,
            'last_updated_at' => $envelope['updated_at'] ?? null,
        ];
    }

    public function exportCsv(int $tenantId, ?string $segmentFilter = null): string
    {
        $envelope = $this->loadEnvelope($tenantId);
        $items = $envelope['items'] ?? [];
        if ($segmentFilter !== null && $segmentFilter !== '') {
            $items = array_values(array_filter(
                $items,
                fn ($c) => ($c['segment'] ?? null) === $segmentFilter,
            ));
        }

        $rows = [['id','name','email','phone','organisation','segment','source','locale','stage','interests','consent_at','last_contacted_at','follow_up_at','notes','created_at']];
        foreach ($items as $c) {
            $rows[] = [
                (string) ($c['id'] ?? ''),
                (string) ($c['name'] ?? ''),
                (string) ($c['email'] ?? ''),
                (string) ($c['phone'] ?? ''),
                (string) ($c['organisation'] ?? ''),
                (string) ($c['segment'] ?? ''),
                (string) ($c['source'] ?? ''),
                (string) ($c['locale'] ?? ''),
                (string) ($c['stage'] ?? ''),
                implode('|', (array) ($c['interests'] ?? [])),
                (string) ($c['consent_at'] ?? ''),
                (string) ($c['last_contacted_at'] ?? ''),
                (string) ($c['follow_up_at'] ?? ''),
                str_replace(["\r","\n"], [' ',' '], (string) ($c['notes'] ?? '')),
                (string) ($c['created_at'] ?? ''),
            ];
        }

        $out = fopen('php://temp', 'r+');
        if ($out === false) {
            return '';
        }
        foreach ($rows as $row) {
            \App\Support\CsvExportSanitizer::put($out, CsvExportSanitizer::row($row));
        }
        rewind($out);
        $csv = stream_get_contents($out) ?: '';
        fclose($out);
        return $csv;
    }

    /**
     * Run a read-modify-write of the envelope under a row lock.
     *
     * $mutator receives the current envelope and returns
     * [result, newEnvelope|null]; a null envelope means "nothing to write".
     * If the new envelope would not fit in the column, or the stored value is
     * unreadable, nothing is written and $refusal is returned instead.
     *
     * @param callable(array<string, mixed>): array{0: array<string, mixed>, 1: array<string, mixed>|null} $mutator
     * @param array<string, mixed> $refusal
     * @return array<string, mixed>
     */
    private function mutateEnvelope(int $tenantId, callable $mutator, array $refusal): array
    {
        if (!Schema::hasTable('tenant_settings')) {
            return $refusal;
        }

        // Make sure the row exists so it can be locked (a missing row cannot
        // be locked, and two first writers would race each other).
        DB::table('tenant_settings')->insertOrIgnore([
            'tenant_id'     => $tenantId,
            'setting_key'   => self::SETTING_KEY,
            'setting_value' => json_encode(['items' => [], 'updated_at' => null]),
            'setting_type'  => 'json',
            'category'      => 'caring_community',
            'description'   => 'AG94 lead nurture contacts',
        ]);

        return DB::transaction(function () use ($tenantId, $mutator, $refusal): array {
            $row = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', self::SETTING_KEY)
                ->lockForUpdate()
                ->first(['id', 'setting_value']);

            if ($row === null) {
                return $refusal;
            }

            $raw = $row->setting_value;
            $envelope = ['items' => [], 'updated_at' => null];
            if (is_string($raw) && $raw !== '') {
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) {
                    // Never overwrite a value we cannot read: it may still be
                    // recoverable by an operator.
                    Log::error('[LeadNurture] stored lead envelope is not valid JSON; write refused', [
                        'tenant_id' => $tenantId,
                        'bytes'     => strlen($raw),
                    ]);
                    return $refusal;
                }
                $envelope = $decoded;
            }

            [$result, $newEnvelope] = $mutator($envelope);
            if ($newEnvelope === null) {
                return $result;
            }

            $encoded = json_encode($newEnvelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($encoded === false || strlen($encoded) > self::MAX_ENVELOPE_BYTES) {
                Log::warning('[LeadNurture] lead list storage full; write refused', [
                    'tenant_id' => $tenantId,
                    'bytes'     => $encoded === false ? null : strlen($encoded),
                ]);
                return $refusal;
            }

            DB::table('tenant_settings')
                ->where('id', $row->id)
                ->update([
                    'setting_value' => $encoded,
                    'setting_type'  => 'json',
                    'category'      => 'caring_community',
                    'description'   => 'AG94 lead nurture contacts',
                    'updated_at'    => now(),
                ]);

            return $result;
        });
    }

    private function loadEnvelope(int $tenantId): array
    {
        if (!Schema::hasTable('tenant_settings')) {
            return ['items' => [], 'updated_at' => null];
        }
        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', self::SETTING_KEY)
            ->first();
        if (!$row || !$row->setting_value) {
            return ['items' => [], 'updated_at' => null];
        }
        $decoded = json_decode((string) $row->setting_value, true);
        return is_array($decoded) ? $decoded : ['items' => [], 'updated_at' => null];
    }

    private function trimNullable(mixed $val, int $max): ?string
    {
        if ($val === null) return null;
        $s = trim((string) $val);
        if ($s === '') return null;
        return mb_substr($s, 0, $max);
    }

    /**
     * @param mixed $val
     * @return array<int, string>
     */
    private function normaliseList(mixed $val, int $max): array
    {
        if (!is_array($val)) {
            return [];
        }
        $out = [];
        foreach ($val as $item) {
            $s = trim((string) $item);
            if ($s !== '') {
                $out[] = mb_substr($s, 0, 100);
            }
            if (count($out) >= $max) break;
        }
        return $out;
    }
}
