<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventAttendanceState;
use App\Exceptions\EventOfflineCheckinException;
use App\Support\Events\EventCheckinManifest;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Builds the minimum expiring projection needed for manual or QR-assisted offline check-in. */
final class EventCheckinManifestService
{
    public function __construct(
        private readonly EventCheckinDeviceService $devices,
        private readonly ?EventCheckinCredentialSigner $signer = null,
    ) {
    }

    public function generate(
        int $eventId,
        string $deviceSecret,
        int $actorUserId,
        ?int $ttlMinutes = null,
        int $schemaVersion = 2,
    ): EventCheckinManifest {
        if (!in_array($schemaVersion, [2, 3], true)) {
            throw new EventOfflineCheckinException('event_checkin_manifest_schema_invalid');
        }
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventOfflineCheckinException('event_checkin_tenant_context_missing');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $deviceSecret,
            $actorUserId,
            $ttlMinutes,
            $schemaVersion,
        ): EventCheckinManifest {
            // Nested transactions retain the event/device row locks until this snapshot commits.
            $device = $this->devices->verify($eventId, $deviceSecret, $actorUserId);
            $event = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', $eventId)
                ->first([
                    'id',
                    'occurrence_key',
                    'end_time',
                    'checkin_manifest_version',
                ]);
            if ($event === null || ! is_string($event->occurrence_key)) {
                throw new EventOfflineCheckinException('event_checkin_event_not_found');
            }

            $now = CarbonImmutable::now('UTC');
            $maximumTtl = max(1, (int) config('event_checkin.manifest_max_ttl_minutes', 1440));
            $requestedTtl = $ttlMinutes
                ?? max(1, (int) config('event_checkin.manifest_ttl_minutes', 480));
            if ($requestedTtl <= 0 || $requestedTtl > $maximumTtl) {
                throw new EventOfflineCheckinException('event_checkin_manifest_ttl_invalid');
            }
            $eventGrace = max(
                0,
                (int) config('event_checkin.credential_offline_grace_minutes', 1440),
            );
            $expiresAt = $now->addMinutes($requestedTtl)
                ->min(CarbonImmutable::instance($device->expires_at)->utc())
                ->min(CarbonImmutable::parse((string) $event->end_time, 'UTC')->addMinutes($eventGrace));
            if (! $expiresAt->isAfter($now)) {
                throw new EventOfflineCheckinException('event_checkin_manifest_expired');
            }

            $registrations = DB::table('event_checkin_credentials as credentials')
                ->join('event_registrations as registrations', static function ($join): void {
                    $join->on('registrations.tenant_id', '=', 'credentials.tenant_id')
                        ->on('registrations.event_id', '=', 'credentials.event_id')
                        ->on('registrations.id', '=', 'credentials.registration_id')
                        ->on('registrations.user_id', '=', 'credentials.user_id');
                })
                ->join('users as users', static function ($join): void {
                    $join->on('users.id', '=', 'credentials.user_id')
                        ->on('users.tenant_id', '=', 'credentials.tenant_id');
                })
                ->leftJoin('event_attendance as attendance', static function ($join): void {
                    $join->on('attendance.tenant_id', '=', 'credentials.tenant_id')
                        ->on('attendance.event_id', '=', 'credentials.event_id')
                        ->on('attendance.user_id', '=', 'credentials.user_id');
                })
                ->leftJoin('event_attendance_activity as activity', static function ($join): void {
                    $join->on('activity.tenant_id', '=', 'attendance.tenant_id')
                        ->on('activity.event_id', '=', 'attendance.event_id')
                        ->on('activity.attendance_id', '=', 'attendance.id')
                        ->on('activity.user_id', '=', 'attendance.user_id')
                        ->on('activity.attendance_version', '=', 'attendance.attendance_version');
                })
                ->where('credentials.tenant_id', $tenantId)
                ->where('credentials.event_id', $eventId)
                ->where('credentials.status', 'active')
                ->where('credentials.expires_at', '>', $now)
                ->where('registrations.registration_state', 'confirmed')
                ->where('users.status', 'active')
                ->whereNull('users.deleted_at')
                ->orderByRaw('LOWER(users.name) ASC')
                ->orderBy('registrations.id')
                ->get([
                    'registrations.id as registration_id',
                    'registrations.user_id',
                    'users.name as display_name',
                    'credentials.credential_version',
                    'credentials.token_fingerprint as credential_fingerprint',
                    'credentials.token_hash as credential_verifier',
                    'attendance.attendance_status',
                    'attendance.attendance_version',
                    'activity.action as latest_action',
                    'activity.from_status as undo_from_status',
                    'activity.to_status as undo_to_status',
                ])
                ->map(static fn (object $row): array => [
                    'registration_id' => (int) $row->registration_id,
                    'user_id' => (int) $row->user_id,
                    'display_name' => (string) $row->display_name,
                    'credential_version' => (int) $row->credential_version,
                    'credential_fingerprint' => (string) $row->credential_fingerprint,
                    'credential_verifier' => (string) $row->credential_verifier,
                    'attendance_status' => $row->attendance_status !== null
                        ? (string) $row->attendance_status
                        : null,
                    'attendance_version' => max(0, (int) ($row->attendance_version ?? 0)),
                    ...($schemaVersion === 3 ? ['undo_state' => $row->latest_action !== null
                        && $row->latest_action !== 'undo' && $row->undo_to_status === $row->attendance_status
                        ? (EventAttendanceState::tryFrom(strtolower(trim((string) $row->undo_from_status)))
                            ?? EventAttendanceState::NotCheckedIn)->value : null] : []),
                ])
                ->values()
                ->all();

            return new EventCheckinManifest(
                $tenantId,
                $eventId,
                (string) $event->occurrence_key,
                (int) $event->checkin_manifest_version,
                (int) $device->id,
                (int) $device->device_version,
                $now,
                $expiresAt,
                $registrations,
                ($this->signer ?? new EventCheckinCredentialSigner())->publicKeySet(),
                $schemaVersion,
            );
        }, 3);
    }
}
