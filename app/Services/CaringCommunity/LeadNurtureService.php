<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Support\CsvExportSanitizer;
use Illuminate\Support\Facades\DB;
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
 */
class LeadNurtureService
{
    public const SETTING_KEY = 'caring.lead_nurture.contacts';
    public const MAX_CONTACTS = 5000;

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

        $envelope = $this->loadEnvelope($tenantId);
        $items = $envelope['items'] ?? [];

        // Deduplicate by lowercase email within tenant.
        $emailLc = mb_strtolower($email);
        foreach ($items as $existing) {
            if (mb_strtolower((string) ($existing['email'] ?? '')) === $emailLc) {
                return ['contact' => $existing, 'duplicate' => true];
            }
        }

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

        // Prepend newest, cap rolling buffer.
        array_unshift($items, $contact);
        if (count($items) > self::MAX_CONTACTS) {
            $items = array_slice($items, 0, self::MAX_CONTACTS);
        }

        $this->saveEnvelope($tenantId, [
            'items'      => $items,
            'updated_at' => $now,
        ]);

        return ['contact' => $contact, 'duplicate' => false];
    }

    /**
     * Admin update: stage progression + notes + follow_up_at scheduling.
     *
     * @param array<string, mixed> $payload
     */
    public function update(int $tenantId, string $contactId, array $payload): array
    {
        $envelope = $this->loadEnvelope($tenantId);
        $items = $envelope['items'] ?? [];

        $found = null;
        foreach ($items as $i => $c) {
            if (($c['id'] ?? null) === $contactId) {
                $found = $i;
                break;
            }
        }

        if ($found === null) {
            return ['error' => 'not_found'];
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
            return ['errors' => $errors];
        }

        $now = now()->toIso8601String();
        $contact['updated_at'] = $now;
        $items[$found] = $contact;

        $this->saveEnvelope($tenantId, [
            'items'      => $items,
            'updated_at' => $now,
        ]);

        return ['contact' => $contact];
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

    private function saveEnvelope(int $tenantId, array $envelope): void
    {
        if (!Schema::hasTable('tenant_settings')) {
            return;
        }
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => self::SETTING_KEY],
            [
                'setting_value' => json_encode($envelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'setting_type'  => 'json',
                'category'      => 'caring_community',
                'description'   => 'AG94 lead nurture contacts',
                'updated_at'    => now(),
            ],
        );
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
