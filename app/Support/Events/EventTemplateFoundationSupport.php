<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Core\TenantContext;
use App\Exceptions\EventTemplateException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Throwable;
use App\Support\Authorization\ManagerDelegate;

/** Fail-closed tenant, policy, hashing, and scheduling primitives for templates. */
final class EventTemplateFoundationSupport
{
    private readonly EventPolicy $policy;

    public function __construct(?EventPolicy $policy = null)
    {
        $this->policy = $policy ?? new EventPolicy();
    }

    public function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventTemplateException('event_template_tenant_context_required');
        }
        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventTemplateException('event_template_feature_disabled');
            }
        } catch (EventTemplateException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new EventTemplateException('event_template_feature_disabled');
        }

        return $tenantId;
    }

    public function actor(int $tenantId, User|int $actor, bool $lock = false): User
    {
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        $query = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at');
        if ($lock) {
            $query->lockForUpdate();
        }
        $persisted = $query->first();
        if ($persisted === null) {
            throw new EventTemplateException('event_template_actor_not_active');
        }

        return $persisted;
    }

    public function sourceEvent(int $tenantId, int $eventId, bool $lock = false): Event
    {
        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $event = $query->first();
        if ($event === null) {
            throw new EventTemplateException('event_template_source_not_found');
        }

        return $event;
    }

    public function authorizeManager(User $actor, Event $event): void
    {
        if (! $this->policy->manage($actor, $event)) {
            throw new EventTemplateException('event_template_authorization_denied');
        }
    }

    public function idempotencyHash(string $key): string
    {
        $key = trim($key);
        if ($key === '' || strlen($key) > 512) {
            throw new EventTemplateException('event_template_idempotency_key_invalid');
        }

        return hash('sha256', $key);
    }

    /**
     * @param DateTimeInterface|string $start
     * @param DateTimeInterface|string|null $end
     * @return array{start_utc:CarbonImmutable,end_utc:?CarbonImmutable,timezone:string,all_day:bool}
     */
    public function schedule(
        DateTimeInterface|string $start,
        DateTimeInterface|string|null $end,
        string $timezone,
        bool $allDay,
    ): array {
        $timezone = trim($timezone);
        if (! in_array($timezone, timezone_identifiers_list(DateTimeZone::ALL_WITH_BC), true)) {
            throw new EventTemplateException('event_template_schedule_timezone_invalid');
        }
        $startUtc = $this->instant($start, $timezone, 'event_template_schedule_start_invalid');
        $endUtc = $end === null
            ? null
            : $this->instant($end, $timezone, 'event_template_schedule_end_invalid');
        if (! $startUtc->isFuture()) {
            throw new EventTemplateException('event_template_schedule_start_not_future');
        }
        if ($endUtc !== null && ! $endUtc->greaterThan($startUtc)) {
            throw new EventTemplateException('event_template_schedule_range_invalid');
        }
        if ($allDay) {
            if ($endUtc === null) {
                throw new EventTemplateException('event_template_all_day_end_required');
            }
            if ($startUtc->setTimezone($timezone)->format('H:i:s') !== '00:00:00'
                || $endUtc->setTimezone($timezone)->format('H:i:s') !== '00:00:00') {
                throw new EventTemplateException('event_template_all_day_boundary_invalid');
            }
        }

        return [
            'start_utc' => $startUtc,
            'end_utc' => $endUtc,
            'timezone' => $timezone,
            'all_day' => $allDay,
        ];
    }

    private function instant(
        DateTimeInterface|string $value,
        string $timezone,
        string $reason,
    ): CarbonImmutable {
        if ($value instanceof DateTimeInterface) {
            return CarbonImmutable::instance($value)->utc();
        }
        $text = trim($value);
        try {
            if (preg_match(
                '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/',
                $text,
            ) === 1) {
                return CarbonImmutable::parse($text)->utc();
            }
            if (preg_match(
                '/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?$/',
                $text,
                $matches,
            ) !== 1) {
                throw new EventTemplateException($reason);
            }
            $local = $matches[1] . ' ' . ($matches[2] ?? '00:00') . ':' . ($matches[3] ?? '00');
            $date = DateTimeImmutable::createFromFormat(
                '!Y-m-d H:i:s',
                $local,
                new DateTimeZone($timezone),
            );
            $errors = DateTimeImmutable::getLastErrors();
            if ($date === false
                || (is_array($errors)
                    && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0))
                || $date->format('Y-m-d H:i:s') !== $local) {
                throw new EventTemplateException($reason);
            }

            return CarbonImmutable::instance($date)->utc();
        } catch (EventTemplateException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new EventTemplateException($reason);
        }
    }
}
