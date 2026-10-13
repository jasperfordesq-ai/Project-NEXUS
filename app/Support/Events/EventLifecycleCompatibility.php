<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use UnexpectedValueException;

/**
 * Strict compatibility boundary between the canonical lifecycle axes and the
 * temporary legacy `events.status` projection.
 */
final class EventLifecycleCompatibility
{
    /**
     * @return array{publication: EventPublicationState, operational: EventOperationalState}
     */
    public static function resolve(
        ?string $publication,
        ?string $operational,
        ?string $legacyStatus,
    ): array {
        $publicationState = self::publicationFromStored($publication, $legacyStatus);
        $operationalState = self::operationalFromStored($operational, $legacyStatus);
        self::assertCompatible($publicationState, $operationalState);

        if (self::normalizeLegacyStatus($legacyStatus)
            !== self::legacyMirror($publicationState, $operationalState)) {
            throw new UnexpectedValueException('event_lifecycle_legacy_projection_mismatch');
        }

        return [
            'publication' => $publicationState,
            'operational' => $operationalState,
        ];
    }

    /**
     * Resolve for read-only listings that must not fail as a whole because one
     * stored row is internally inconsistent (E-104, 13 Oct 2026: a single row
     * whose legacy `status` disagreed with its canonical columns made the
     * admin events list answer 500). The canonical axes win when both are
     * stored; the mismatch is reported in `inconsistent` so the caller can
     * flag the row instead of hiding it. Rows that carry no canonical columns
     * resolve exactly as {@see resolve()} does.
     *
     * @return array{publication: EventPublicationState, operational: EventOperationalState, inconsistent: bool}
     */
    public static function resolveForListing(
        ?string $publication,
        ?string $operational,
        ?string $legacyStatus,
    ): array {
        try {
            return self::resolve($publication, $operational, $legacyStatus) + ['inconsistent' => false];
        } catch (UnexpectedValueException $exception) {
            if ($exception->getMessage() !== 'event_lifecycle_legacy_projection_mismatch'
                || $publication === null
                || $operational === null) {
                throw $exception;
            }
        }

        $publicationState = self::publicationFromStored($publication, $legacyStatus);
        $operationalState = self::operationalFromStored($operational, $legacyStatus);
        self::assertCompatible($publicationState, $operationalState);

        return [
            'publication' => $publicationState,
            'operational' => $operationalState,
            'inconsistent' => true,
        ];
    }

    public static function assertCompatible(
        EventPublicationState $publication,
        EventOperationalState $operational,
    ): void {
        if (($publication === EventPublicationState::Draft
                || $publication === EventPublicationState::PendingReview)
            && $operational !== EventOperationalState::Scheduled) {
            throw new UnexpectedValueException('event_lifecycle_incompatible_axes');
        }
    }

    public static function legacyMirror(
        EventPublicationState $publication,
        EventOperationalState $operational,
    ): string {
        self::assertCompatible($publication, $operational);

        if ($publication === EventPublicationState::Archived) {
            return 'cancelled';
        }

        if ($publication === EventPublicationState::Draft
            || $publication === EventPublicationState::PendingReview) {
            return 'draft';
        }

        return match ($operational) {
            EventOperationalState::Scheduled => 'active',
            EventOperationalState::Postponed, EventOperationalState::Cancelled => 'cancelled',
            EventOperationalState::Completed => 'completed',
        };
    }

    private static function publicationFromStored(
        ?string $publication,
        ?string $legacyStatus,
    ): EventPublicationState {
        if ($publication === null) {
            return EventPublicationState::fromLegacyStatus($legacyStatus);
        }

        return EventPublicationState::tryFrom(strtolower(trim($publication)))
            ?? throw new UnexpectedValueException('event_lifecycle_unknown_publication_state');
    }

    private static function operationalFromStored(
        ?string $operational,
        ?string $legacyStatus,
    ): EventOperationalState {
        if ($operational === null) {
            return EventOperationalState::fromLegacyStatus($legacyStatus);
        }

        return EventOperationalState::tryFrom(strtolower(trim($operational)))
            ?? throw new UnexpectedValueException('event_lifecycle_unknown_operational_state');
    }

    private static function normalizeLegacyStatus(?string $status): string
    {
        if ($status === null || trim($status) === '') {
            return 'active';
        }

        $normalized = strtolower(trim($status));
        if (! in_array($normalized, ['active', 'draft', 'cancelled', 'completed'], true)) {
            throw new UnexpectedValueException('event_lifecycle_unknown_legacy_status');
        }

        return $normalized;
    }
}
