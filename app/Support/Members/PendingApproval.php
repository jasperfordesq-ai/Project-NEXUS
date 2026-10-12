<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Members;

use Illuminate\Database\Query\Builder;

/**
 * Who is waiting in the pending-approval queue — the one definition.
 *
 * A person is pending when they have not been approved AND nobody has decided
 * on them yet AND their account still exists. It used to be `is_approved = 0`
 * alone, which kept an applicant in the queue (and in every badge counting it)
 * after an admin deleted, banned, suspended or rejected them: none of those
 * actions touches is_approved, so the queue could never be cleared.
 *
 * Status is matched positively ('pending', 'active' or NULL) so that a status
 * added later — like 'rejected' or 'delegate' — never silently lands here.
 *
 * The Users list (filter=pending), the sidebar badge, the dashboard, the CRM
 * and the broker panel all count this queue; they must all use this class so a
 * badge never opens a list of a different size.
 */
final class PendingApproval
{
    /** Raw SQL predicate. `$alias` is the users table alias, e.g. 'u', or '' for none. */
    public static function sql(string $alias = ''): string
    {
        $c = $alias === '' ? '' : $alias . '.';

        return "({$c}is_approved = 0"
            . " AND ({$c}status IS NULL OR {$c}status IN ('pending', 'active'))"
            . " AND {$c}deleted_at IS NULL AND {$c}anonymized_at IS NULL)";
    }

    /** Apply the predicate to a query builder over `users`. */
    public static function apply(Builder $query): Builder
    {
        return $query->whereRaw(self::sql());
    }
}
