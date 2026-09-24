<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\ChallengeOutcome;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ChallengeOutcomeService — Eloquent-based service for challenge outcomes.
 *
 * Tracks implementation status of winning ideas after a challenge closes.
 * All queries are tenant-scoped via HasTenantScope trait on the model.
 */
class ChallengeOutcomeService
{
    /**
     * Challenge statuses an ordinary member may see. MUST equal
     * IdeationChallengeService::MEMBER_VISIBLE_STATUSES (pinned by
     * IdeationDraftChallengeLeakTest) so a draft/archived challenge's title
     * and outcome never surface here (E-035 F-187).
     */
    public const MEMBER_VISIBLE_CHALLENGE_STATUSES = ['open', 'voting', 'evaluating', 'closed'];

    /** @var array<int, array{code: string, message: string, field?: string}> */
    private array $errors = [];

    public function getErrors(): array
    {
        return $this->errors;
    }

    private function clearErrors(): void
    {
        $this->errors = [];
    }

    private function addError(string $code, string $message, ?string $field = null): void
    {
        $error = ['code' => $code, 'message' => $message];
        if ($field !== null) {
            $error['field'] = $field;
        }
        $this->errors[] = $error;
    }

    /**
     * Get outcome for a challenge.
     */
    public function getForChallenge(int $challengeId, ?int $viewerId = null): ?array
    {
        $tenantId = TenantContext::getId();
        $viewerId = $this->viewerId($viewerId);

        if ($viewerId === null || ! $this->isAdmin($viewerId)) {
            $challenge = DB::table('ideation_challenges')
                ->where('id', $challengeId)
                ->where('tenant_id', $tenantId)
                ->first(['status', 'user_id']);
            $visible = $challenge !== null
                && (in_array((string) $challenge->status, self::MEMBER_VISIBLE_CHALLENGE_STATUSES, true)
                    || ($viewerId !== null && (int) $challenge->user_id === $viewerId));
            if (! $visible) {
                return null;
            }
        }

        $outcome = DB::table('challenge_outcomes as co')
            ->leftJoin('challenge_ideas as ci', 'co.winning_idea_id', '=', 'ci.id')
            ->leftJoin('users as u', 'ci.user_id', '=', 'u.id')
            ->where('co.challenge_id', $challengeId)
            ->where('co.tenant_id', $tenantId)
            ->select([
                'co.*',
                'ci.title as idea_title',
                'ci.description as idea_description',
                'u.first_name as idea_author_first',
                'u.last_name as idea_author_last',
            ])
            ->first();

        if (!$outcome) {
            return null;
        }

        $result = (array) $outcome;

        if ($result['winning_idea_id']) {
            $result['winning_idea'] = [
                'id' => (int) $result['winning_idea_id'],
                'title' => $result['idea_title'] ?? '',
                'description' => $result['idea_description'] ?? '',
                'author' => trim(($result['idea_author_first'] ?? '') . ' ' . ($result['idea_author_last'] ?? '')),
            ];
        } else {
            $result['winning_idea'] = null;
        }

        unset($result['idea_title'], $result['idea_description'], $result['idea_author_first'], $result['idea_author_last']);

        return $result;
    }

    /**
     * Create or update an outcome for a challenge.
     *
     * @return int|null Outcome ID
     */
    public function upsert(int $challengeId, int $userId, array $data): ?int
    {
        $this->clearErrors();

        if (!$this->isAdmin($userId)) {
            $this->addError('RESOURCE_FORBIDDEN', 'Only admins can manage outcomes');
            return null;
        }

        $tenantId = TenantContext::getId();

        // Verify challenge exists
        $challenge = DB::table('ideation_challenges')
            ->where('id', $challengeId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'status']);

        if (!$challenge) {
            $this->addError('RESOURCE_NOT_FOUND', 'Challenge not found');
            return null;
        }

        $status = $data['status'] ?? 'not_started';
        if (!in_array($status, ['not_started', 'in_progress', 'implemented', 'abandoned'])) {
            $this->addError('VALIDATION_INVALID_VALUE', 'Invalid outcome status', 'status');
            return null;
        }

        $winningIdeaId = isset($data['winning_idea_id']) ? (int) $data['winning_idea_id'] : null;
        $impactDescription = !empty($data['impact_description']) ? trim($data['impact_description']) : null;

        // Validate winning idea belongs to this challenge. challenge_ideas has no
        // tenant_id column; tenant scoping is enforced transitively because the
        // parent $challengeId was already verified to belong to $tenantId above.
        if ($winningIdeaId) {
            $idea = DB::table('challenge_ideas')
                ->where('id', $winningIdeaId)
                ->where('challenge_id', $challengeId)
                ->first(['id']);

            if (!$idea) {
                $this->addError('VALIDATION_INVALID_VALUE', 'Winning idea does not belong to this challenge', 'winning_idea_id');
                return null;
            }
        }

        // Check if outcome already exists
        $existing = ChallengeOutcome::where('challenge_id', $challengeId)->first();

        try {
            if ($existing) {
                $existing->update([
                    'winning_idea_id' => $winningIdeaId,
                    'status' => $status,
                    'impact_description' => $impactDescription,
                ]);
                return (int) $existing->id;
            } else {
                $outcome = ChallengeOutcome::create([
                    'challenge_id' => $challengeId,
                    'winning_idea_id' => $winningIdeaId,
                    'status' => $status,
                    'impact_description' => $impactDescription,
                ]);
                return (int) $outcome->id;
            }
        } catch (\Throwable $e) {
            Log::error('Outcome upsert failed: ' . $e->getMessage());
            $this->addError('SERVER_INTERNAL_ERROR', 'Failed to save outcome');
            return null;
        }
    }

    /**
     * Get outcomes dashboard (all outcomes for a tenant).
     */
    public function getDashboard(?int $viewerId = null): array
    {
        $tenantId = TenantContext::getId();
        $viewerId = $this->viewerId($viewerId);
        $canManage = $viewerId !== null && $this->isAdmin($viewerId);

        $query = DB::table('challenge_outcomes as co')
            ->join('ideation_challenges as ic', 'co.challenge_id', '=', 'ic.id')
            ->leftJoin('challenge_ideas as ci', 'co.winning_idea_id', '=', 'ci.id')
            ->where('co.tenant_id', $tenantId)
            ->where('ic.tenant_id', $tenantId);
        if (! $canManage) {
            // Mirrors IdeationChallengeService::canViewChallengeRecord().
            $query->where(function ($visible) use ($viewerId): void {
                $visible->whereIn('ic.status', self::MEMBER_VISIBLE_CHALLENGE_STATUSES);
                if ($viewerId !== null) {
                    $visible->orWhere('ic.user_id', $viewerId);
                }
            });
        }

        $outcomes = $query
            ->select([
                'co.*',
                'ic.title as challenge_title',
                'ic.status as challenge_status',
                'ci.title as idea_title',
            ])
            ->orderByDesc('co.updated_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $stats = [
            'total' => count($outcomes),
            'implemented' => 0,
            'in_progress' => 0,
            'not_started' => 0,
            'abandoned' => 0,
        ];

        foreach ($outcomes as $o) {
            $s = $o['status'] ?? 'not_started';
            if (isset($stats[$s])) {
                $stats[$s]++;
            }
        }

        return [
            'outcomes' => $outcomes,
            'stats' => $stats,
        ];
    }

    /**
     * The viewer for visibility decisions: an explicit id, else the
     * authenticated user. Null means "treat as an ordinary member".
     */
    private function viewerId(?int $explicit): ?int
    {
        if ($explicit !== null && $explicit > 0) {
            return $explicit;
        }
        $authId = Auth::id();

        return $authId !== null && (int) $authId > 0 ? (int) $authId : null;
    }

    private function isAdmin(int $userId): bool
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['role']);

        return $user && in_array($user->role ?? '', ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin']);
    }
}
