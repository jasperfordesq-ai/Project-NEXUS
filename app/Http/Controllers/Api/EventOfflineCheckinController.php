<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Enums\EventAttendanceAction;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\EventCheckinCredential;
use App\Models\User;
use App\Services\EventAttendanceService;
use App\Services\EventConfigurationService;
use App\Services\EventCheckinCredentialService;
use App\Services\EventCheckinDeviceService;
use App\Services\EventCheckinManifestService;
use App\Services\EventOfflineCheckinProcessor;
use App\Services\EventOfflineCheckinProjectionService;
use App\Services\EventOfflineCheckinResolutionService;
use App\Services\EventOfflineCheckinSyncService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Throwable;

/** Private v2 API surface for signed and offline-capable event check-in. */
final class EventOfflineCheckinController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventCheckinCredentialService $credentials,
        private readonly EventCheckinDeviceService $devices,
        private readonly EventCheckinManifestService $manifests,
        private readonly EventOfflineCheckinSyncService $sync,
        private readonly EventOfflineCheckinProcessor $processor,
        private readonly EventOfflineCheckinProjectionService $projection,
        private readonly EventOfflineCheckinResolutionService $resolutions,
        private readonly EventAttendanceService $attendance,
    ) {
    }

    public function workspace(int $id): JsonResponse
    {
        try {
            return $this->privateData($this->projection->workspace($id, $this->actor()));
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function myCredential(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $registrationId = $this->ownRegistrationId($id, (int) $actor->id);
            $tenantId = TenantContext::currentId();
            /** @var EventCheckinCredential|null $credential */
            $credential = $tenantId !== null
                ? EventCheckinCredential::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $id)
                    ->where('registration_id', $registrationId)
                    ->orderByDesc('credential_version')
                    ->first()
                : null;
            $status = $credential?->status->value;
            if ($credential !== null && $status === 'active'
                && ! $credential->expires_at->isFuture()) {
                $status = 'expired';
            }

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'credential' => $credential !== null ? [
                    'id' => (int) $credential->id,
                    'registration_id' => (int) $credential->registration_id,
                    'version' => (int) $credential->credential_version,
                    'status' => $status,
                    'expires_at' => $credential->expires_at->toIso8601String(),
                    'revoked_at' => $credential->revoked_at?->toIso8601String(),
                    'token' => null,
                    'token_one_shot' => false,
                    'contains_pii' => false,
                ] : null,
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function issueCredential(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $registrationId = $this->positiveInteger(request()->input('registration_id'))
                ?? $this->ownRegistrationId($id, (int) $actor->id);
            $result = $this->credentials->issue(
                $id,
                $registrationId,
                (int) $actor->id,
                $this->idempotencyKey(),
                $this->optionalDate(request()->input('expires_at')),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'credential' => [
                    'id' => (int) $result->credential->id,
                    'registration_id' => (int) $result->credential->registration_id,
                    'version' => (int) $result->credential->credential_version,
                    'status' => $result->credential->status->value,
                    'expires_at' => $result->credential->expires_at->toIso8601String(),
                    'token' => $result->secret,
                    'token_one_shot' => $result->issued,
                    'contains_pii' => false,
                ],
                'manifest_version' => $result->manifestVersion,
            ], $result->issued ? 201 : 200);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function rotateCredential(int $id, int $credentialId): JsonResponse
    {
        try {
            $actor = $this->actor();
            $result = $this->credentials->rotate(
                $id,
                $credentialId,
                (int) $actor->id,
                $this->positiveIntegerRequired(request()->input('expected_version')),
                $this->idempotencyKey(),
                $this->optionalDate(request()->input('expires_at')),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'credential' => [
                    'id' => (int) $result->credential->id,
                    'version' => (int) $result->credential->credential_version,
                    'status' => $result->credential->status->value,
                    'expires_at' => $result->credential->expires_at->toIso8601String(),
                    'token' => $result->secret,
                    'token_one_shot' => $result->issued,
                    'contains_pii' => false,
                ],
                'manifest_version' => $result->manifestVersion,
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function revokeCredential(int $id, int $credentialId): JsonResponse
    {
        try {
            $actor = $this->actor(true);
            $credential = $this->credentials->revoke(
                $id,
                $credentialId,
                (int) $actor->id,
                $this->positiveIntegerRequired(request()->input('expected_version')),
                $this->requiredText(request()->input('reason'), 500),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'credential' => [
                    'id' => (int) $credential->id,
                    'version' => (int) $credential->credential_version,
                    'status' => $credential->status->value,
                    'revoked_at' => $credential->revoked_at?->toIso8601String(),
                ],
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function registerDevice(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $result = $this->devices->register(
                $id,
                (int) $actor->id,
                $this->requiredText(request()->input('label'), 120),
                $this->idempotencyKey(),
                $this->optionalDate(request()->input('expires_at')),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'device' => [
                    'id' => (int) $result->device->id,
                    'public_id' => (string) $result->device->public_id,
                    'label' => (string) $result->device->label,
                    'version' => (int) $result->device->device_version,
                    'status' => $result->device->status->value,
                    'expires_at' => $result->device->expires_at->toIso8601String(),
                    'secret' => $result->secret,
                    'secret_one_shot' => $result->issued,
                ],
                'manifest_version' => $result->manifestVersion,
            ], $result->issued ? 201 : 200);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function rotateDevice(int $id, int $deviceId): JsonResponse
    {
        try {
            $actor = $this->actor();
            $result = $this->devices->rotate(
                $id,
                $deviceId,
                (int) $actor->id,
                $this->positiveIntegerRequired(request()->input('expected_version')),
                $this->idempotencyKey(),
                $this->optionalDate(request()->input('expires_at')),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'device' => [
                    'id' => (int) $result->device->id,
                    'public_id' => (string) $result->device->public_id,
                    'label' => (string) $result->device->label,
                    'version' => (int) $result->device->device_version,
                    'status' => $result->device->status->value,
                    'expires_at' => $result->device->expires_at->toIso8601String(),
                    'secret' => $result->secret,
                    'secret_one_shot' => $result->issued,
                ],
                'manifest_version' => $result->manifestVersion,
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function revokeDevice(int $id, int $deviceId): JsonResponse
    {
        try {
            $actor = $this->actor(true);
            $device = $this->devices->revoke(
                $id,
                $deviceId,
                (int) $actor->id,
                $this->positiveIntegerRequired(request()->input('expected_version')),
                $this->requiredText(request()->input('reason'), 500),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'device' => [
                    'id' => (int) $device->id,
                    'public_id' => (string) $device->public_id,
                    'version' => (int) $device->device_version,
                    'status' => $device->status->value,
                    'revoked_at' => $device->revoked_at?->toIso8601String(),
                    'purge_local_data_required' => true,
                ],
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function manifest(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $manifest = $this->manifests->generate(
                $id,
                $this->requiredSecret(request()->input('device_secret'), 'nxd1_'),
                (int) $actor->id,
                $this->optionalPositiveInteger(request()->input('ttl_minutes')),
            );

            return $this->privateData($manifest->toArray());
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function stage(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $items = request()->input('items');
            if (! is_array($items)) {
                throw new EventOfflineCheckinException('event_offline_batch_size_invalid');
            }
            $staged = $this->sync->stage(
                $id,
                $this->requiredSecret(request()->input('device_secret'), 'nxd1_'),
                (int) $actor->id,
                $this->requiredText(request()->input('client_batch_id'), 100),
                $this->nonNegativeIntegerRequired(request()->input('manifest_version')),
                array_values($items),
            );
            try {
                $this->processor->processBatch((int) $staged->batch->id);
            } catch (Throwable) {
                // The durable pending batch is safe to retry through the worker
                // or this same idempotent API request. Never log its secrets.
            }

            return $this->privateData(
                $this->projection->batch($id, (int) $staged->batch->id, $actor),
                $staged->staged ? 202 : 200,
            );
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function batch(int $id, int $batchId): JsonResponse
    {
        try {
            return $this->privateData(
                $this->projection->batch($id, $batchId, $this->actor()),
            );
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function lookupBatch(int $id): JsonResponse
    {
        try {
            return $this->privateData($this->projection->batchByClientId(
                $id,
                $this->positiveIntegerRequired(request()->query('device_id')),
                $this->requiredText(request()->query('client_batch_id'), 100),
                $this->actor(),
            ));
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function conflicts(int $id): JsonResponse
    {
        try {
            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                ...$this->resolutions->conflicts(
                    $id,
                    $this->actor(),
                    $this->optionalPositiveInteger(request()->query('page')) ?? 1,
                    $this->optionalPositiveInteger(request()->query('per_page')) ?? 25,
                ),
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function resolveConflict(int $id, int $itemId): JsonResponse
    {
        try {
            $actor = $this->actor();
            $this->resolutions->resolve(
                $id,
                $itemId,
                $actor,
                $this->positiveIntegerRequired(request()->input('expected_decision_version')),
                $this->requiredText(request()->input('disposition'), 16),
                $this->nonNegativeIntegerRequired(request()->input('expected_attendance_version')),
                $this->requiredText(request()->input('reason'), 500),
                $this->idempotencyKey(),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                ...$this->resolutions->conflicts($id, $actor),
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        }
    }

    public function scan(int $id): JsonResponse
    {
        try {
            $actor = $this->actor();
            $this->devices->verify(
                $id,
                $this->requiredSecret(request()->input('device_secret'), 'nxd1_'),
                (int) $actor->id,
            );
            $credential = $this->credentials->verify(
                $id,
                $this->requiredSecret(request()->input('credential'), 'nqx2_'),
            );
            $action = EventAttendanceAction::tryFrom(
                $this->requiredText(request()->input('action'), 16),
            );
            if ($action === null) {
                throw new EventOfflineCheckinException('event_offline_operation_invalid');
            }
            $result = $this->attendance->transition(
                $id,
                (int) $credential->user_id,
                $action,
                $actor,
                $this->nonNegativeIntegerRequired(request()->input('expected_attendance_version')),
                is_string(request()->input('reason'))
                    ? request()->input('reason')
                    : null,
                $this->idempotencyKey(),
            );

            return $this->privateData([
                'contract_version' => 1,
                'event_id' => $id,
                'state' => 'synced',
                'attendance' => $result->toArray(),
                'privacy' => [
                    'credential_redacted' => true,
                    'wallet_effects_supported' => false,
                ],
            ]);
        } catch (EventOfflineCheckinException $exception) {
            return $this->offlineError($exception);
        } catch (Throwable) {
            return $this->privateResponse($this->respondWithError(
                'EVENT_CHECKIN_REJECTED',
                __('api.invalid_input'),
                null,
                422,
            ));
        }
    }

    private function actor(bool $allowRevocation = false): User
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || (! $allowRevocation && ! (bool) app(EventConfigurationService::class)->value(
            'offline_checkin_enabled',
            true,
            $tenantId,
        ))) {
            throw new EventOfflineCheckinException('event_checkin_feature_disabled');
        }
        $actor = $tenantId !== null
            ? User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($this->requireUserId())
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->first()
            : null;
        if (! $actor instanceof User) {
            throw new EventOfflineCheckinException('event_checkin_actor_invalid');
        }

        return $actor;
    }

    private function ownRegistrationId(int $eventId, int $userId): int
    {
        $tenantId = TenantContext::currentId();
        $id = $tenantId !== null
            ? \Illuminate\Support\Facades\DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('registration_state', 'confirmed')
                ->value('id')
            : null;
        if (! is_numeric($id) || (int) $id <= 0) {
            throw new EventOfflineCheckinException('event_qr_registration_not_found');
        }

        return (int) $id;
    }

    private function idempotencyKey(): string
    {
        $key = request()->header('Idempotency-Key');
        if (! is_string($key) || trim($key) === '') {
            $key = request()->input('idempotency_key');
        }
        if (! is_string($key) || trim($key) === '') {
            throw new EventOfflineCheckinException('event_checkin_idempotency_key_invalid');
        }

        return trim($key);
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function positiveIntegerRequired(mixed $value): int
    {
        return $this->positiveInteger($value)
            ?? throw new EventOfflineCheckinException('event_checkin_integer_invalid');
    }

    private function optionalPositiveInteger(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return $this->positiveIntegerRequired($value);
    }

    private function nonNegativeIntegerRequired(mixed $value): int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($parsed === false) {
            throw new EventOfflineCheckinException('event_checkin_integer_invalid');
        }

        return (int) $parsed;
    }

    private function optionalDate(mixed $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value)) {
            throw new EventOfflineCheckinException('event_checkin_date_invalid');
        }
        try {
            return CarbonImmutable::parse($value)->utc();
        } catch (Throwable) {
            throw new EventOfflineCheckinException('event_checkin_date_invalid');
        }
    }

    private function requiredText(mixed $value, int $maximum): string
    {
        if (! is_string($value)) {
            throw new EventOfflineCheckinException('event_checkin_text_required');
        }
        $value = trim($value);
        if ($value === '' || mb_strlen($value) > $maximum) {
            throw new EventOfflineCheckinException('event_checkin_text_invalid');
        }

        return $value;
    }

    private function requiredSecret(mixed $value, string $prefix): string
    {
        if (! is_string($value)
            || mb_strlen($value) > 1024
            || ! str_starts_with(trim($value), $prefix)) {
            throw new EventOfflineCheckinException('event_checkin_secret_invalid');
        }

        return trim($value);
    }

    /** @param array<string,mixed> $data */
    private function privateData(array $data, int $status = 200): JsonResponse
    {
        return $this->privateResponse($this->respondWithData($data, null, $status));
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->headers->set('X-Event-Checkin-Contract', '1');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function offlineError(EventOfflineCheckinException $exception): JsonResponse
    {
        [$code, $status] = match (true) {
            str_contains($exception->reasonCode, 'tenant_context_missing')
                || str_contains($exception->reasonCode, 'signing_unavailable')
                || str_contains($exception->reasonCode, 'signing_key_missing')
                || str_contains($exception->reasonCode, 'signing_key_invalid')
                || str_contains($exception->reasonCode, 'verification_keys_invalid') => [
                    'EVENT_CHECKIN_UNAVAILABLE', 503,
                ],
            str_contains($exception->reasonCode, 'not_found') => [
                'EVENT_CHECKIN_NOT_FOUND', 404,
            ],
            str_contains($exception->reasonCode, 'authorization')
                || str_contains($exception->reasonCode, 'forbidden')
                || str_contains($exception->reasonCode, 'feature_disabled')
                || str_contains($exception->reasonCode, 'actor_invalid')
                || str_contains($exception->reasonCode, 'actor_mismatch') => [
                    'EVENT_CHECKIN_FORBIDDEN', 403,
                ],
            str_contains($exception->reasonCode, 'conflict')
                || str_contains($exception->reasonCode, 'active_exists') => [
                    'EVENT_CHECKIN_CONFLICT', 409,
                ],
            str_contains($exception->reasonCode, 'expired')
                || str_contains($exception->reasonCode, 'revoked')
                || str_contains($exception->reasonCode, 'rotated')
                || str_contains($exception->reasonCode, 'invalid') => [
                    'EVENT_CHECKIN_REJECTED', 422,
                ],
            default => ['EVENT_CHECKIN_VALIDATION_FAILED', 422],
        };

        return $this->privateResponse($this->respondWithError(
            $code,
            __('api.invalid_input'),
            null,
            $status,
        ));
    }
}
