<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Enums\GroupStatus;
use App\Models\Event;
use App\Support\Authorization\TenantAdminScope;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;

/** Canonical, fail-closed visibility boundary for every Event search surface. */
final class EventSearchVisibility
{
    /**
     * @return array{publication:EventPublicationState,operational:EventOperationalState}|null
     */
    public static function discoverableLifecycle(array|Event $event): ?array
    {
        if (! self::hasConcreteOccurrenceIdentity($event)) {
            return null;
        }

        try {
            $lifecycle = EventLifecycleCompatibility::resolve(
                self::stringValue($event, 'publication_status'),
                self::stringValue($event, 'operational_status'),
                self::stringValue($event, 'status'),
            );
        } catch (UnexpectedValueException) {
            return null;
        }

        if ($lifecycle['publication'] !== EventPublicationState::Published
            || ! in_array($lifecycle['operational'], [
                EventOperationalState::Scheduled,
                EventOperationalState::Postponed,
            ], true)) {
            return null;
        }

        return $lifecycle;
    }

    public static function isDiscoverable(array|Event $event): bool
    {
        return self::discoverableLifecycle($event) !== null;
    }

    /** Apply tenant and canonical lifecycle visibility to an Eloquent query. */
    public static function applyToEloquent(
        EloquentBuilder $query,
        int $tenantId,
        string $table = 'events',
    ): EloquentBuilder {
        self::apply($query, $tenantId, $table);

        return $query;
    }

    /** Apply tenant and canonical lifecycle visibility to a query-builder query. */
    public static function applyToQuery(
        QueryBuilder $query,
        int $tenantId,
        string $table = 'events',
    ): QueryBuilder {
        self::apply($query, $tenantId, $table);

        return $query;
    }

    /**
     * Restrict an Eloquent query to events whose group audience includes the viewer.
     *
     * Opt-in and viewer-aware: `applyToEloquent()` answers "is this occurrence
     * discoverable at all", this answers "may THIS viewer discover it". A null
     * viewer is treated as anonymous (public groups only), never as "no filter".
     */
    public static function applyAudienceToEloquent(
        EloquentBuilder $query,
        int $tenantId,
        ?int $viewerId,
        string $table = 'events',
    ): EloquentBuilder {
        self::applyAudience($query, $tenantId, $viewerId, $table);

        return $query;
    }

    /** Query-builder variant of applyAudienceToEloquent(). */
    public static function applyAudienceToQuery(
        QueryBuilder $query,
        int $tenantId,
        ?int $viewerId,
        string $table = 'events',
    ): QueryBuilder {
        self::applyAudience($query, $tenantId, $viewerId, $table);

        return $query;
    }

    /**
     * Shared Meilisearch predicate. Documents without the canonical lifecycle
     * fields are deliberately excluded, so stale legacy documents cannot leak.
     */
    public static function meilisearchFilter(int $tenantId, ?int $notBeforeTimestamp = null): string
    {
        $parts = [
            'tenant_id = ' . max(0, $tenantId),
            'publication_status = "published"',
            'operational_status IN ["scheduled", "postponed"]',
            'is_recurring_template = false',
        ];
        if ($notBeforeTimestamp !== null) {
            $parts[] = 'start_time >= ' . max(0, $notBeforeTimestamp);
        }

        return implode(' AND ', $parts);
    }

    private static function apply(
        EloquentBuilder|QueryBuilder $query,
        int $tenantId,
        string $table,
    ): void {
        $tenant = self::column($table, 'tenant_id');
        $template = self::column($table, 'is_recurring_template');
        $publication = self::column($table, 'publication_status');
        $operational = self::column($table, 'operational_status');
        $legacy = self::column($table, 'status');

        $query->where($tenant, $tenantId)
            ->where(static function ($builder) use ($template): void {
                $builder->whereNull($template)->orWhere($template, 0);
            })
            ->where(static function ($builder) use ($publication, $operational, $legacy): void {
                // Canonical/legacy-compatible published + scheduled rows.
                $builder->where(static function ($scheduled) use ($publication, $operational, $legacy): void {
                    $scheduled->where(static function ($status) use ($legacy): void {
                        $status->whereNull($legacy)->orWhere($legacy, 'active');
                    })->where(static function ($state) use ($publication): void {
                        $state->whereNull($publication)->orWhere($publication, EventPublicationState::Published->value);
                    })->where(static function ($state) use ($operational): void {
                        $state->whereNull($operational)->orWhere($operational, EventOperationalState::Scheduled->value);
                    });
                // Postponed is canonical-only: legacy `cancelled` alone means a
                // genuinely cancelled row and must never be inferred as postponed.
                })->orWhere(static function ($postponed) use ($publication, $operational, $legacy): void {
                    $postponed->where($legacy, 'cancelled')
                        ->where(static function ($state) use ($publication): void {
                            $state->whereNull($publication)->orWhere($publication, EventPublicationState::Published->value);
                        })
                        ->where($operational, EventOperationalState::Postponed->value);
                });
            });
    }

    /**
     * The same audience rule as EventService::applyDiscoveryVisibility() and
     * EventPolicy::canViewAudience(): an event with no group is visible; a group
     * event only when its group is active in this tenant and is public, owned by
     * the viewer, has the viewer as an active member, or the viewer holds tenant
     * admin authority (TenantAdminScope).
     */
    private static function applyAudience(
        EloquentBuilder|QueryBuilder $query,
        int $tenantId,
        ?int $viewerId,
        string $table,
    ): void {
        $groupColumn = self::column($table, 'group_id');
        $viewerId = $viewerId !== null && $viewerId > 0 ? $viewerId : null;
        $isTenantAdmin = self::viewerIsTenantAdmin($viewerId, $tenantId);

        $query->where(static function ($visibility) use ($groupColumn, $viewerId, $tenantId, $isTenantAdmin): void {
            $visibility->whereNull($groupColumn)
                ->orWhereExists(static function ($group) use ($groupColumn, $viewerId, $tenantId, $isTenantAdmin): void {
                    $group->selectRaw('1')
                        ->from('groups as search_audience_groups')
                        ->whereColumn('search_audience_groups.id', $groupColumn)
                        ->where('search_audience_groups.tenant_id', $tenantId)
                        ->where('search_audience_groups.status', GroupStatus::Active->value);

                    if ($isTenantAdmin) {
                        return;
                    }

                    $group->where(static function ($audience) use ($viewerId, $tenantId): void {
                        $audience->whereNull('search_audience_groups.visibility')
                            ->orWhere('search_audience_groups.visibility', 'public');

                        if ($viewerId !== null) {
                            $audience->orWhere('search_audience_groups.owner_id', $viewerId)
                                ->orWhereExists(static function ($membership) use ($tenantId, $viewerId): void {
                                    $membership->selectRaw('1')
                                        ->from('group_members as search_audience_members')
                                        ->whereColumn('search_audience_members.group_id', 'search_audience_groups.id')
                                        ->where('search_audience_members.tenant_id', $tenantId)
                                        ->where('search_audience_members.user_id', $viewerId)
                                        ->where('search_audience_members.status', 'active');
                                });
                        }
                    });
                });
        });
    }

    /** Mirrors EventService::isTenantAdmin(): the viewer's own active row, scoped by TenantAdminScope. */
    private static function viewerIsTenantAdmin(?int $viewerId, int $tenantId): bool
    {
        if ($viewerId === null) {
            return false;
        }

        $user = DB::table('users')
            ->where('id', $viewerId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->select([
                'tenant_id',
                'role',
                'is_admin',
                'is_super_admin',
                'is_tenant_super_admin',
                'is_god',
            ])
            ->first();

        return TenantAdminScope::allows($user, $tenantId);
    }

    private static function hasConcreteOccurrenceIdentity(array|Event $event): bool
    {
        if ($event instanceof Event) {
            $attributes = $event->getAttributes();
            if (! array_key_exists('is_recurring_template', $attributes)) {
                return false;
            }
            $value = $event->getRawOriginal('is_recurring_template');
        } else {
            if (! array_key_exists('is_recurring_template', $event)) {
                return false;
            }
            $value = $event['is_recurring_template'];
        }

        return $value === null || (int) $value === 0;
    }

    private static function stringValue(array|Event $event, string $field): ?string
    {
        $value = $event instanceof Event
            ? $event->getRawOriginal($field)
            : ($event[$field] ?? null);

        if ($value instanceof \BackedEnum) {
            $value = $value->value;
        }
        if ($value === null) {
            return null;
        }
        if (! is_scalar($value)) {
            throw new UnexpectedValueException('event_search_visibility_storage_type_invalid');
        }

        $value = strtolower(trim((string) $value));

        return $value === '' ? null : $value;
    }

    private static function column(string $table, string $column): string
    {
        $table = trim($table);

        return $table === '' ? $column : $table . '.' . $column;
    }
}
