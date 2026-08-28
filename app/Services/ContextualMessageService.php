<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ContextualMessageService — Context awareness for messages.
 *
 * Messages can reference a specific listing, event, job, volunteering opportunity, etc.
 * via `context_type` and `context_id` columns on the messages table.
 *
 * Valid context types: listing, event, job, volunteering, group
 */
class ContextualMessageService
{
    private const VALID_TYPES = ['listing', 'event', 'job', 'volunteering', 'group'];

    /**
     * Send a message with context.
     *
     * @param int $senderId
     * @param int $receiverId
     * @param string $body Message body
     * @param string|null $contextType Type of referenced entity
     * @param int|null $contextId ID of referenced entity
     * @param string $subject Optional subject
     * @return int|null Message ID or null on failure
     */
    public function sendWithContext(
        int $senderId,
        int $receiverId,
        string $body,
        ?string $contextType = null,
        ?int $contextId = null,
        string $subject = ''
    ): ?int {
        $tenantId = TenantContext::getId();

        // Validate context type
        if ($contextType !== null && !in_array($contextType, self::VALID_TYPES)) {
            $contextType = null;
            $contextId = null;
        }

        if ($contextType !== null && $contextId === null) {
            $contextType = null;
        }

        // Route every contextual message through the same authoritative direct-
        // message boundary. This keeps block, account, broker and safeguarding
        // checks in force and ensures a denied contact creates no message row.
        $message = MessageService::send($senderId, [
            'recipient_id' => $receiverId,
            'body' => $body,
            'context_type' => $contextType,
            'context_id' => $contextId,
        ]);

        if ($message === []) {
            return null;
        }

        $messageId = (int) ($message['id'] ?? 0);
        if ($messageId <= 0) {
            return null;
        }

        // Preserve the legacy listing_id alias used by older listing-message
        // consumers. The canonical context fields were persisted atomically by
        // MessageService before its delivery event was dispatched.
        if ($contextType === 'listing' && $contextId !== null) {
            try {
                DB::table('messages')
                    ->where('id', $messageId)
                    ->where('tenant_id', $tenantId)
                    ->update(['listing_id' => $contextId]);
            } catch (\Exception $e) {
                Log::warning('ContextualMessageService: Failed to attach context: ' . $e->getMessage());
            }
        }

        return $messageId;
    }

    /**
     * Get context info for a message (for display in UI).
     *
     * @param string $contextType
     * @param int $contextId
     * @return array|null Context card data or null
     */
    public function getContextInfo(string $contextType, int $contextId): ?array
    {
        if (!in_array($contextType, self::VALID_TYPES)) {
            return null;
        }

        try {
            return match ($contextType) {
                'listing' => $this->getListingContext($contextId),
                'event' => $this->getEventContext($contextId),
                'job' => $this->getJobContext($contextId),
                'volunteering' => $this->getVolunteeringContext($contextId),
                'group' => $this->getGroupContext($contextId),
                default => null,
            };
        } catch (\Exception $e) {
            Log::warning('ContextualMessageService::getContextInfo error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get context info for multiple messages in batch.
     *
     * @param array $contextPairs Array of ['type' => string, 'id' => int]
     * @return array Keyed by "type:id"
     */
    public function getContextInfoBatch(array $contextPairs): array
    {
        $results = [];

        foreach ($contextPairs as $pair) {
            $key = $pair['type'] . ':' . $pair['id'];
            if (!isset($results[$key])) {
                $info = $this->getContextInfo($pair['type'], (int) $pair['id']);
                if ($info) {
                    $results[$key] = $info;
                }
            }
        }

        return $results;
    }

    /**
     * Enrich messages with context card data.
     *
     * @param array $messages Array of message data
     * @return array Messages with context_info added
     */
    public function enrichMessagesWithContext(array $messages): array
    {
        $contextPairs = [];
        foreach ($messages as $msg) {
            if (!empty($msg['context_type']) && !empty($msg['context_id'])) {
                $contextPairs[] = ['type' => $msg['context_type'], 'id' => (int) $msg['context_id']];
            }
        }

        if (empty($contextPairs)) {
            return $messages;
        }

        $contextData = $this->getContextInfoBatch($contextPairs);

        foreach ($messages as &$msg) {
            if (!empty($msg['context_type']) && !empty($msg['context_id'])) {
                $key = $msg['context_type'] . ':' . $msg['context_id'];
                $msg['context_info'] = $contextData[$key] ?? null;
            } else {
                $msg['context_info'] = null;
            }
        }

        return $messages;
    }

    // =========================================================================
    // CONTEXT RESOLVERS
    // =========================================================================

    private function getListingContext(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('listings as l')
            ->join('users as u', 'l.user_id', '=', 'u.id')
            ->where('l.id', $id)
            ->where('l.tenant_id', $tenantId)
            ->select('l.id', 'l.title', 'l.type', 'l.description', 'u.name as user_name')
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'type' => 'listing',
            'id' => (int) $row->id,
            'title' => $row->title,
            'subtitle' => ucfirst($row->type ?? 'listing') . ' by ' . $row->user_name,
            'description' => mb_substr($row->description ?? '', 0, 120),
            'link' => '/listings/' . $row->id,
        ];
    }

    private function getEventContext(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('events')->where('id', $id)->where('tenant_id', $tenantId)->first(['id', 'title', 'start_time', 'location']);

        if (!$row) {
            return null;
        }

        $subtitle = 'Event';
        if (!empty($row->start_time)) {
            $subtitle .= ' on ' . \Carbon\Carbon::parse($row->start_time)
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->isoFormat('ll');
        }

        return [
            'type' => 'event',
            'id' => (int) $row->id,
            'title' => $row->title,
            'subtitle' => $subtitle,
            'description' => $row->location ?? '',
            'link' => '/events/' . $row->id,
        ];
    }

    private function getJobContext(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('job_vacancies as j')
            ->leftJoin('organizations as o', 'j.organization_id', '=', 'o.id')
            ->where('j.id', $id)
            ->where('j.tenant_id', $tenantId)
            ->select('j.id', 'j.title', 'j.location', 'o.name as org_name')
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'type' => 'job',
            'id' => (int) $row->id,
            'title' => $row->title,
            'subtitle' => $row->org_name ? 'at ' . $row->org_name : 'Job vacancy',
            'description' => $row->location ?? '',
            'link' => '/jobs/' . $row->id,
        ];
    }

    private function getVolunteeringContext(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('volunteer_opportunities as v')
            ->leftJoin('organizations as o', 'v.organization_id', '=', 'o.id')
            ->where('v.id', $id)
            ->where('v.tenant_id', $tenantId)
            ->select('v.id', 'v.title', 'v.location', 'o.name as org_name')
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'type' => 'volunteering',
            'id' => (int) $row->id,
            'title' => $row->title,
            'subtitle' => $row->org_name ? 'with ' . $row->org_name : 'Volunteer opportunity',
            'description' => $row->location ?? '',
            'link' => '/volunteering/' . $row->id,
        ];
    }

    private function getGroupContext(int $id): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('groups')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('status', \App\Enums\GroupStatus::Active->value)
            ->first(['id', 'name', 'description']);

        if (!$row) {
            return null;
        }

        return [
            'type' => 'group',
            'id' => (int) $row->id,
            'title' => $row->name,
            'subtitle' => 'Group',
            'description' => mb_substr($row->description ?? '', 0, 120),
            'link' => '/groups/' . $row->id,
        ];
    }
}
