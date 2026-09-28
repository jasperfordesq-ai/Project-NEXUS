<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Course;
use Illuminate\Support\Facades\Log;

/**
 * CourseCreditService — time-credit flows for the Courses module.
 *
 * Phase-3 conservative model (no minting): a paid course charges the learner
 * `credit_cost` and pays the course author the same amount — a peer
 * learner → author transfer routed through the battle-tested WalletService
 * (locked rows, transactions ledger, balance alerts, TransactionCompleted event).
 *
 * The separate `learner_credit_reward` / `instructor_credit_reward` *bonus*
 * fields are intentionally NOT wired here: funding them is an economic-policy
 * decision (mint new credits vs. draw from a community account) that belongs to
 * the platform owner. They default to 0 and stay inert until that decision is
 * made. See the plan's "Out of scope / confirm during build".
 */
class CourseCreditService
{
    /**
     * Charge a learner the course's credit cost, paying the author.
     *
     * @return array{charged:bool,amount:float,reason?:string}
     */
    public static function chargeEnrollment(Course $course, int $learnerId): array
    {
        $cost = (float) $course->credit_cost;
        $authorId = (int) $course->author_user_id;

        if ($cost <= 0) {
            return ['charged' => false, 'amount' => 0.0];
        }

        // Don't charge an author enrolling in their own course.
        if ($learnerId === $authorId) {
            return ['charged' => false, 'amount' => 0.0];
        }

        try {
            /** @var WalletService $wallet */
            $wallet = app(WalletService::class);
            $wallet->transfer($learnerId, [
                'idempotency_key' => 'course-enrollment:' . $course->tenant_id . ':' . $course->id . ':' . $learnerId,
                'recipient' => $authorId,
                'amount' => round($cost, 2),
                'description' => __('svc_notifications_2.course.enrolment_payment', ['title' => $course->title]),
            ]);

            return ['charged' => true, 'amount' => round($cost, 2)];
        } catch (\RuntimeException $e) {
            // Insufficient balance / recipient not found / inactive recipient.
            return ['charged' => false, 'amount' => round($cost, 2), 'reason' => $e->getMessage()];
        } catch (\Throwable $e) {
            Log::warning('[CourseCredit] chargeEnrollment failed', ['error' => $e->getMessage()]);
            return ['charged' => false, 'amount' => round($cost, 2), 'reason' => 'error'];
        }
    }
}
