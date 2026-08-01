<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventNotificationDeliveryMode;
use App\Enums\EventSafetyEnforcementMode;
use App\Jobs\RetractTenantEventFederationShares;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

/** Tenant-owned Events policy with platform rollout capabilities kept read-only. */
final class EventConfigurationService
{
    public const DEFAULTS = [
        'creation_role' => 'members',
        'moderation_required' => false,
        'registration_enabled' => true,
        'default_capacity' => 0,
        'guest_registration_enabled' => true,
        'waitlist_enabled' => true,
        'timed_waitlist_offers_enabled' => false,
        'recurrence_enabled' => true,
        'reminders_enabled' => true,
        'organizer_broadcasts_enabled' => true,
        'offline_checkin_enabled' => true,
        'calendar_feeds_enabled' => true,
        'federation_sharing_enabled' => true,
        'safety_enforcement_mode' => null,
        'notification_delivery_mode' => null,
        // Monthly ceiling on attendance-reward minting, in time credits.
        // Null means uncapped. Enforced by EventCreditService per calendar
        // month over COMPLETED attendance_reward claims, so a reversed claim
        // frees its budget. This caps the tenant treasury's exposure — the
        // per-event amount only caps a single reward.
        'attendance_credit_monthly_cap' => null,
    ];

    /** @return array{config:array<string,mixed>,defaults:array<string,mixed>,version:int,capabilities:array<string,mixed>,impact:array<string,int>} */
    public function inspect(?int $tenantId = null): array
    {
        $tenantId ??= TenantContext::getId();
        $stored = $this->storedConfiguration($tenantId);
        $effectiveDefaults = $this->effectiveDefaults($tenantId);

        return [
            'config' => array_replace($effectiveDefaults, $stored),
            'defaults' => $effectiveDefaults,
            'version' => $this->storedVersion($tenantId),
            'capabilities' => $this->capabilities($tenantId),
            'impact' => $this->impact($tenantId),
        ];
    }

    public function value(string $key, mixed $default = null, ?int $tenantId = null): mixed
    {
        if (! array_key_exists($key, self::DEFAULTS)) {
            return $default;
        }
        $tenantId ??= TenantContext::getId();
        $stored = $this->storedConfiguration($tenantId);
        return array_key_exists($key, $stored) ? $stored[$key] : $this->effectiveDefaults($tenantId)[$key];
    }

    public function canCreate(int $tenantId, int $userId): bool
    {
        $role = (string) $this->value('creation_role', 'members', $tenantId);
        $user = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first(['role', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
        if ($user === null) {
            return false;
        }
        if ($role === 'members') {
            return true;
        }
        $isAdmin = in_array((string) $user->role, ['admin', 'tenant_admin'], true)
            || (bool) $user->is_super_admin
            || (bool) $user->is_tenant_super_admin
            || (bool) $user->is_god;

        return $role === 'admins' ? $isAdmin : ($isAdmin || (string) $user->role === 'broker');
    }

    /** @param array<string,mixed> $input
     *  @return array{config:array<string,mixed>,defaults:array<string,mixed>,version:int,capabilities:array<string,mixed>,changes:array<string,array{from:mixed,to:mixed}>}
     */
    public function update(
        int $tenantId,
        int $actorId,
        int $expectedVersion,
        array $input,
        string $reason,
        bool $confirmDisruptive = false,
    ): array
    {
        $validated = $this->validate($tenantId, $input);
        $reason = trim($reason);
        if ($reason === '') {
            throw ValidationException::withMessages(['reason' => __('api.events_config_reason_required')]);
        }

        $changes = [];
        $nextVersion = 0;
        DB::transaction(function () use ($tenantId, $actorId, $expectedVersion, $validated, $reason, $confirmDisruptive, &$changes, &$nextVersion): void {
            $tenant = DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first(['configuration']);
            if ($tenant === null) {
                throw ValidationException::withMessages(['tenant' => __('api.tenant_not_found')]);
            }

            $root = $this->decodeRoot($tenant->configuration);
            $currentVersion = max(0, (int) ($root['events']['config_version'] ?? 0));
            if ($currentVersion !== $expectedVersion) {
                throw ValidationException::withMessages(['version' => __('api.events_config_stale')]);
            }

            $current = array_replace($this->effectiveDefaults($tenantId), $this->extractStored($root));
            foreach ($validated as $key => $value) {
                if ($current[$key] !== $value) {
                    $changes[$key] = ['from' => $current[$key], 'to' => $value];
                }
            }
            if (! $confirmDisruptive && $this->hasDisruptiveDisable($tenantId, $current, $validated)) {
                throw ValidationException::withMessages(['confirm_disruptive' => __('api.events_config_impact_confirmation_required')]);
            }
            if ($changes === []) {
                throw ValidationException::withMessages(['settings' => __('api.events_config_no_changes')]);
            }

            $nextVersion = $currentVersion + 1;
            $events = is_array($root['events'] ?? null) ? $root['events'] : [];
            foreach ($validated as $key => $value) {
                if ($value === null) {
                    unset($events[$key]);
                } else {
                    $events[$key] = $value;
                }
            }
            $events['config_version'] = $nextVersion;
            $events['config_updated_at'] = now()->toIso8601String();
            $events['config_updated_by'] = $actorId;
            $root['events'] = $events;

            DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($root, JSON_THROW_ON_ERROR)]);
            app(AuditLogService::class)->logAdminAction('events_configuration_updated', $actorId, null, [
                'reason' => $reason,
                'version' => $nextVersion,
                'changes' => $changes,
            ]);
        });

        if (($changes['federation_sharing_enabled']['from'] ?? false) === true
            && ($changes['federation_sharing_enabled']['to'] ?? true) === false) {
            RetractTenantEventFederationShares::dispatch($tenantId, $actorId);
        }
        if (($changes['reminders_enabled']['from'] ?? false) === true
            && ($changes['reminders_enabled']['to'] ?? true) === false
            && Schema::hasTable('event_reminders')) {
            DB::table('event_reminders')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'cancelled',
                    'updated_at' => now(),
                ]);
        }

        $result = $this->inspect($tenantId);
        $result['changes'] = $changes;
        return $result;
    }

    /** @return array{config:array<string,mixed>,defaults:array<string,mixed>,version:int,capabilities:array<string,mixed>,changes:array<string,array{from:mixed,to:mixed}>} */
    /** @param list<string>|null $keys */
    public function restoreDefaults(
        int $tenantId,
        int $actorId,
        int $expectedVersion,
        string $reason,
        ?array $keys = null,
    ): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw ValidationException::withMessages(['reason' => __('api.events_config_reason_required')]);
        }

        $keys ??= array_keys(self::DEFAULTS);
        $unknown = array_diff($keys, array_keys(self::DEFAULTS));
        if ($keys === [] || $unknown !== []) {
            throw ValidationException::withMessages(['keys' => __('api.events_config_unknown_key')]);
        }
        $selected = array_fill_keys($keys, true);
        $changes = [];
        $restored = false;
        DB::transaction(function () use ($tenantId, $actorId, $expectedVersion, $reason, $selected, &$changes, &$restored): void {
            $tenant = DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first(['configuration']);
            if ($tenant === null) {
                throw ValidationException::withMessages(['tenant' => __('api.tenant_not_found')]);
            }
            $root = $this->decodeRoot($tenant->configuration);
            $events = is_array($root['events'] ?? null) ? $root['events'] : [];
            $currentVersion = max(0, (int) ($events['config_version'] ?? 0));
            if ($currentVersion !== $expectedVersion) {
                throw ValidationException::withMessages(['version' => __('api.events_config_stale')]);
            }

            $stored = array_intersect_key($events, self::DEFAULTS, $selected);
            if ($stored === []) {
                return;
            }
            $defaults = $this->effectiveDefaults($tenantId);
            foreach ($stored as $key => $value) {
                if ($value !== $defaults[$key]) {
                    $changes[$key] = ['from' => $value, 'to' => $defaults[$key]];
                }
                unset($events[$key]);
            }
            $nextVersion = $currentVersion + 1;
            $events['config_version'] = $nextVersion;
            $events['config_updated_at'] = now()->toIso8601String();
            $events['config_updated_by'] = $actorId;
            $root['events'] = $events;
            DB::table('tenants')->where('id', $tenantId)->update(['configuration' => json_encode($root, JSON_THROW_ON_ERROR)]);
            app(AuditLogService::class)->logAdminAction('events_configuration_defaults_restored', $actorId, null, [
                'reason' => $reason,
                'version' => $nextVersion,
                'removed_overrides' => array_keys($stored),
                'changes' => $changes,
            ]);
            $restored = true;
        });

        $result = $this->inspect($tenantId);
        $result['changes'] = $changes;
        $result['restored'] = $restored;
        return $result;
    }

    /** @return array<string,mixed> */
    public function capabilities(int $tenantId): array
    {
        $stored = $this->storedConfiguration($tenantId);
        $globalNotification = EventNotificationDeliveryMode::tryFrom(
            is_string(config('events.notification_delivery.mode'))
                ? (string) config('events.notification_delivery.mode')
                : '',
        );
        $tenantNotification = is_string($stored['notification_delivery_mode'] ?? null)
            ? EventNotificationDeliveryMode::tryFrom($stored['notification_delivery_mode'])
            : null;
        $notification = [
            'resolved_mode' => ($tenantNotification ?? $globalNotification ?? EventNotificationDeliveryMode::Direct)->value,
            'source' => $tenantNotification !== null ? 'tenant_override' : ($globalNotification !== null ? 'global' : 'safe_default'),
            'global_configuration_valid' => $globalNotification !== null,
            'tenant_override_present' => $tenantNotification !== null,
            'tenant_configuration_valid' => $tenantNotification !== null ? true : null,
            'tenant_override_lookup_failed' => false,
        ];
        $globalSafety = EventSafetyEnforcementMode::tryFrom(
            is_string(config('events.safety.enforcement_mode'))
                ? (string) config('events.safety.enforcement_mode')
                : '',
        );
        $tenantSafety = is_string($stored['safety_enforcement_mode'] ?? null)
            ? EventSafetyEnforcementMode::tryFrom($stored['safety_enforcement_mode'])
            : null;
        $safety = [
            'resolved_mode' => ($tenantSafety ?? $globalSafety ?? EventSafetyEnforcementMode::Off)->value,
            'source' => $tenantSafety !== null ? 'tenant_override' : 'global',
            'configuration_valid' => $globalSafety !== null,
            'global_configuration_valid' => $globalSafety !== null,
            'tenant_override_present' => $tenantSafety !== null,
            'tenant_configuration_valid' => $tenantSafety !== null ? true : null,
            'tenant_override_lookup_failed' => false,
        ];

        return [
            'recurrence_v2' => (bool) config('events.recurrence.engine_v2_enabled', false),
            'rolling_recurrence' => (bool) config('events.recurrence.materialization.enabled', false),
            'recurrence_definition_blueprints' => (bool) config('events.recurrence.definition_blueprints.enabled', false),
            'timed_waitlist_offers' => (bool) config('events.registration.timed_waitlist_offers_enabled', false),
            'attendance_credits' => config('events.attendance_credit_mode', 'off') !== 'off',
            'optional_analytics_capture' => (bool) config('events.analytics.optional_capture_enabled', false),
            'registration_forms' => Schema::hasTable('event_registration_settings')
                && Schema::hasTable('event_registration_form_questions'),
            'invitation_campaigns' => Schema::hasTable('event_invitation_campaigns')
                && Schema::hasTable('event_invitation_delivery_evidence'),
            'ticketing' => Schema::hasTable('event_ticket_types')
                && Schema::hasTable('event_ticket_entitlements'),
            'agenda' => Schema::hasTable('event_sessions')
                && Schema::hasTable('event_session_registrations'),
            'offline_sync' => Schema::hasTable('event_checkin_devices')
                && Schema::hasTable('event_offline_sync_batches'),
            'broadcast_delivery' => Schema::hasTable('event_broadcasts')
                && Schema::hasTable('event_broadcast_deliveries'),
            'safety_evidence' => Schema::hasTable('event_safety_requirements')
                && Schema::hasTable('event_guardian_consents'),
            'federation_delivery' => Schema::hasTable('event_federation_deliveries'),
            'notification_consumer' => EventNotificationDeliveryModeResolver::consumerEnabled(),
            'notification_delivery' => $notification,
            'safety' => $safety,
        ];
    }

    /** @return array<string,int> */
    public function impact(int $tenantId): array
    {
        return [
            'active_registrations' => Schema::hasTable('event_registrations')
                ? DB::table('event_registrations')->where('tenant_id', $tenantId)
                    ->whereIn('registration_state', ['invited', 'pending', 'confirmed'])->count()
                : 0,
            'active_waitlist_entries' => Schema::hasTable('event_waitlist_entries')
                ? DB::table('event_waitlist_entries')->where('tenant_id', $tenantId)
                    ->whereIn('queue_state', ['waiting', 'offered'])->count()
                : 0,
            'pending_reminders' => Schema::hasTable('event_reminders')
                ? DB::table('event_reminders')->where('tenant_id', $tenantId)
                    ->where('status', 'pending')->count()
                : 0,
            'active_calendar_tokens' => Schema::hasTable('event_calendar_feed_tokens')
                ? DB::table('event_calendar_feed_tokens')->where('tenant_id', $tenantId)
                    ->whereNull('revoked_at')->count()
                : 0,
            'shared_events' => Schema::hasTable('events')
                ? DB::table('events')->where('tenant_id', $tenantId)
                    ->where('federated_visibility', '<>', 'none')->count()
                : 0,
            'scheduled_broadcasts' => Schema::hasTable('event_broadcasts')
                ? DB::table('event_broadcasts')->where('tenant_id', $tenantId)
                    ->whereIn('status', ['scheduled', 'sending'])->count()
                : 0,
        ];
    }

    /** @param array<string,mixed> $current @param array<string,mixed> $next */
    private function hasDisruptiveDisable(int $tenantId, array $current, array $next): bool
    {
        $impact = $this->impact($tenantId);
        $mapping = [
            'registration_enabled' => 'active_registrations',
            'waitlist_enabled' => 'active_waitlist_entries',
            'reminders_enabled' => 'pending_reminders',
            'calendar_feeds_enabled' => 'active_calendar_tokens',
            'federation_sharing_enabled' => 'shared_events',
            'organizer_broadcasts_enabled' => 'scheduled_broadcasts',
        ];
        foreach ($mapping as $setting => $counter) {
            if (($current[$setting] ?? false) === true
                && array_key_exists($setting, $next)
                && $next[$setting] === false
                && ($impact[$counter] ?? 0) > 0) {
                return true;
            }
        }
        return false;
    }

    /** @param array<string,mixed> $input @return array<string,mixed> */
    private function validate(int $tenantId, array $input): array
    {
        $unknown = array_diff(array_keys($input), array_keys(self::DEFAULTS));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['settings' => __('api.events_config_unknown_key')]);
        }

        $out = [];
        foreach ($input as $key => $value) {
            // Nullable numeric, unlike every other null-default key (which are
            // string choices) — validated here so the generic branches below
            // never see it.
            if ($key === 'attendance_credit_monthly_cap') {
                if ($value !== null && (! is_numeric($value) || (float) $value <= 0 || (float) $value > 100000)) {
                    throw ValidationException::withMessages([$key => __('api.events_config_monthly_cap_invalid')]);
                }
                $out[$key] = $value === null ? null : round((float) $value, 2);
                continue;
            }

            $default = self::DEFAULTS[$key];
            if (is_bool($default)) {
                if (! is_bool($value)) {
                    throw ValidationException::withMessages([$key => __('api.events_config_boolean_required')]);
                }
            } elseif (is_int($default)) {
                if (! is_int($value) || $value < 0 || $value > 100000) {
                    throw ValidationException::withMessages([$key => __('api.events_config_capacity_invalid')]);
                }
            } elseif ($default === null) {
                if ($value !== null && ! is_string($value)) {
                    throw ValidationException::withMessages([$key => __('api.events_config_choice_invalid')]);
                }
            } elseif (! is_string($value)) {
                throw ValidationException::withMessages([$key => __('api.events_config_choice_invalid')]);
            }
            $out[$key] = $value;
        }

        if (isset($out['creation_role']) && ! in_array($out['creation_role'], ['members', 'staff', 'admins'], true)) {
            throw ValidationException::withMessages(['creation_role' => __('api.events_config_choice_invalid')]);
        }
        if (array_key_exists('safety_enforcement_mode', $out) && $out['safety_enforcement_mode'] !== null
            && EventSafetyEnforcementMode::tryFrom($out['safety_enforcement_mode']) === null) {
            throw ValidationException::withMessages(['safety_enforcement_mode' => __('api.events_config_choice_invalid')]);
        }
        if (array_key_exists('notification_delivery_mode', $out) && $out['notification_delivery_mode'] !== null
            && EventNotificationDeliveryMode::tryFrom($out['notification_delivery_mode']) === null) {
            throw ValidationException::withMessages(['notification_delivery_mode' => __('api.events_config_choice_invalid')]);
        }

        $current = array_replace($this->effectiveDefaults($tenantId), $this->storedConfiguration($tenantId), $out);
        if ($current['timed_waitlist_offers_enabled'] && ! $current['waitlist_enabled']) {
            throw ValidationException::withMessages(['timed_waitlist_offers_enabled' => __('api.events_config_waitlist_dependency')]);
        }
        if ($current['timed_waitlist_offers_enabled']
            && ! (bool) config('events.registration.timed_waitlist_offers_enabled', false)) {
            throw ValidationException::withMessages(['timed_waitlist_offers_enabled' => __('api.events_config_platform_unavailable')]);
        }
        if ($current['notification_delivery_mode'] === EventNotificationDeliveryMode::OutboxAuthoritative->value
            && ! EventNotificationDeliveryModeResolver::consumerEnabled()) {
            throw ValidationException::withMessages(['notification_delivery_mode' => __('api.events_config_notification_consumer_required')]);
        }

        return $out;
    }

    /** @return array<string,mixed> */
    private function storedConfiguration(int $tenantId): array
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        return $this->extractStored($this->decodeRoot($raw));
    }

    private function storedVersion(int $tenantId): int
    {
        $raw = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        return max(0, (int) ($this->decodeRoot($raw)['events']['config_version'] ?? 0));
    }

    /** @return array<string,mixed> */
    private function effectiveDefaults(int $tenantId): array
    {
        $defaults = self::DEFAULTS;
        $defaults['timed_waitlist_offers_enabled'] = (bool) config(
            'events.registration.timed_waitlist_offers_enabled',
            false,
        );
        $legacyModeration = ContentModerationService::getModerationSettings($tenantId);
        $defaults['moderation_required'] = ($legacyModeration['enabled'] ?? false) === true
            && ($legacyModeration['require_event'] ?? false) === true;
        return $defaults;
    }

    /** @return array<string,mixed> */
    private function extractStored(array $root): array
    {
        $events = is_array($root['events'] ?? null) ? $root['events'] : [];
        return array_intersect_key($events, self::DEFAULTS);
    }

    /** @return array<string,mixed> */
    private function decodeRoot(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
