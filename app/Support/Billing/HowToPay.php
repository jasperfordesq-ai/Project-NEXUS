<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Services\BillingStandingService;
use App\Services\TenantBillingService;
use Illuminate\Support\Facades\DB;

/**
 * "How to pay": one plain-text note per payee, written once by whoever is
 * paid and shown to every community that pays them (owner, 23 November 2026).
 *
 * The payee is a community id. `PLATFORM` (1) stands for the platform itself:
 * the note the platform team writes. Any other id is a parent community, and
 * the note is its manager's.
 *
 * 🔴 The note is plain text and is treated as untrusted wherever it is shown.
 * It goes into admin pages (React escapes it) and into emails, where the
 * caller must escape it: BillingStandingNotifier does. Nothing here turns any
 * of it into a link or into markup.
 *
 * 🔴 Who may WRITE a note is the caller's business: the platform team for the
 * platform's (`requireGodPlatformAdmin()`), and `BranchPlans::refusalForHub()`
 * for a parent community's. Who may READ one is decided here: a community is
 * told only the note of the payee it pays, never another's.
 */
final class HowToPay
{
    /** The platform itself, as a payee. */
    public const PLATFORM = 1;

    /** Longest note, in characters. It is read in a banner and in an email. */
    public const MAX = 600;

    public const TOO_LONG = 'how_to_pay_too_long';
    public const NOT_TEXT = 'how_to_pay_not_text';

    private const TABLE = 'billing_how_to_pay_notes';

    /** The note a payee has written, or null when it has written none. */
    public static function forPayee(int $payeeTenantId): ?string
    {
        if ($payeeTenantId < 1) {
            return null;
        }

        $note = DB::table(self::TABLE)->where('payee_tenant_id', $payeeTenantId)->value('note');

        return is_string($note) && trim($note) !== '' ? $note : null;
    }

    /**
     * The payee whose note applies to $tenantId, or null when nobody is paid
     * by hand: a card payer's card is charged, and a community that is not
     * billed pays no one.
     */
    public static function payeeFor(int $tenantId): ?int
    {
        if ($tenantId <= 1) {
            return null;
        }

        $payer = BillingStandingService::get($tenantId)['payer'];

        if ($payer === 'platform_invoice') {
            return self::PLATFORM;
        }

        if ($payer !== 'parent') {
            return null;
        }

        $parentId = DB::table('tenants')->where('id', $tenantId)->value('parent_id');

        // The same rule as BillingStandingService::defaultPayer(): a parent
        // that is the platform's own community is not a parent to pay.
        return $parentId !== null && (int) $parentId > 1 ? (int) $parentId : null;
    }

    /** The note of whoever $tenantId pays, or null. */
    public static function forCommunity(int $tenantId): ?string
    {
        $payee = self::payeeFor($tenantId);

        return $payee === null ? null : self::forPayee($payee);
    }

    /**
     * Store a payee's note. Null, or nothing but spaces, removes it.
     *
     * @throws \DomainException NOT_TEXT when it is not a string, TOO_LONG past MAX characters
     */
    public static function set(int $payeeTenantId, mixed $note, int $actedBy): ?string
    {
        if ($payeeTenantId < 1) {
            throw new \InvalidArgumentException('A payee is a community id.');
        }
        // Text that is not valid UTF-8 would be emptied by clean() and read
        // as "remove the note": refused instead.
        if ($note !== null && (!is_string($note) || !mb_check_encoding($note, 'UTF-8'))) {
            throw new \DomainException(self::NOT_TEXT);
        }

        $clean = $note === null ? '' : self::clean($note);
        if (mb_strlen($clean) > self::MAX) {
            throw new \DomainException(self::TOO_LONG);
        }

        $before = self::forPayee($payeeTenantId);
        $after = $clean === '' ? null : $clean;
        if ($before === $after) {
            return $after;
        }

        if ($after === null) {
            DB::table(self::TABLE)->where('payee_tenant_id', $payeeTenantId)->delete();
        } else {
            DB::table(self::TABLE)->updateOrInsert(
                ['payee_tenant_id' => $payeeTenantId],
                ['note' => $after, 'updated_by_user_id' => $actedBy, 'updated_at' => now(), 'created_at' => now()]
            );
        }

        // Kept beside the payee's other billing changes: what it said before
        // and after, and who changed it.
        TenantBillingService::logAudit(
            $payeeTenantId,
            $actedBy,
            'how_to_pay_note_set',
            ['note' => $before],
            ['note' => $after],
            null
        );

        return $after;
    }

    /**
     * Plain text: line endings made the same, every other control character
     * removed, no more than one blank line in a row, no space at either end.
     */
    private static function clean(string $note): string
    {
        $note = str_replace(["\r\n", "\r"], "\n", $note);
        $note = (string) preg_replace('/[^\P{C}\n]/u', '', $note);
        $note = (string) preg_replace("/[ \t]+\n/", "\n", $note);
        $note = (string) preg_replace("/\n{3,}/", "\n\n", $note);

        return trim($note);
    }
}
