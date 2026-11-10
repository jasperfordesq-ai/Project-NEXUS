<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Federation;

use App\Support\Members\MemberProfileVisibility;
use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Database\Eloquent\Model;

/**
 * The name of a member as ONE viewer may see it on an internal-federation
 * surface, where the people shown usually belong to a different community
 * from the viewer (E-122, owner rule of 10 Nov 2026: no surnames apart from
 * for admins).
 *
 * `MemberProfileVisibility::viewerIsAdmin()` answers "is the viewer an admin
 * of the community this request resolved to". That is the wrong question
 * here: an administrator of community A looking at a member of community B is
 * not that member's administrator. So the surname is kept only for
 *   - the member themself (their own name), and
 *   - an administrator of the MEMBER's community, or a platform administrator
 *     ({@see MemberProfileVisibility::viewerIsAdminOf()}).
 * Everyone else gets the first name; an organisation keeps its trading name
 * ({@see MemberProfileVisibility::withoutSurname()}).
 *
 * The "viewer" of a notification is its recipient, never the HTTP caller.
 *
 * One instance per viewer per action. The per-community answer is memoised on
 * the instance only — never statically — because one feature test makes
 * several requests as different people against one application.
 */
final class FederatedMemberName
{
    /** @var array<int, bool> community id => the viewer administers it */
    private array $adminOf = [];

    public function __construct(
        private readonly ?int $viewerId,
        private readonly ?int $viewerTenantId,
    ) {
    }

    /** May the viewer see this member's surname? */
    public function seesSurnameOf(int $memberId, int $memberTenantId): bool
    {
        if (
            $this->viewerId !== null && $this->viewerId > 0
            && $memberId === $this->viewerId
            && $memberTenantId === (int) $this->viewerTenantId
        ) {
            return true;
        }

        return $this->adminOf[$memberTenantId]
            ??= MemberProfileVisibility::viewerIsAdminOf($this->viewerId, $memberTenantId);
    }

    /**
     * May the viewer see surnames in EVERY community (a platform
     * administrator)? Used where one query spans several communities, such as
     * the surname branch of a search. Community 0 does not exist, so only
     * platform-level authority satisfies the rule.
     */
    public function seesEverySurname(): bool
    {
        return $this->adminOf[0] ??= MemberProfileVisibility::viewerIsAdminOf($this->viewerId, 0);
    }

    /**
     * The display name of the member in `$row` for this viewer.
     *
     * `$row` carries `first_name` / `last_name` / `profile_type` /
     * `organization_name`, each behind `$prefix` (e.g. `sender_`).
     *
     * @param array<string, mixed>|object|null $row
     */
    public function name(
        array|object|null $row,
        int $memberId,
        int $memberTenantId,
        string $prefix = '',
        ?string $fallback = null,
    ): string {
        if ($row === null) {
            return (string) $fallback;
        }

        // The viewer was checked against the MEMBER's community on the line
        // below, which the request-wide audience cannot do — so the full name
        // is asked for outright rather than through resolvePrefixed().
        return $this->seesSurnameOf($memberId, $memberTenantId)
            ? UserDisplayName::fullPrefixed($row, $prefix, NameReason::CHECKED_BY_CALLER, $fallback)
            : self::publicName($row, $prefix, $fallback);
    }

    /**
     * First name, or an organisation's trading name. Never the surname, and
     * never a stored full `name`.
     *
     * @param array<string, mixed>|object|null $row
     */
    public static function publicName(array|object|null $row, string $prefix = '', ?string $fallback = null): string
    {
        if ($row === null) {
            return (string) $fallback;
        }

        if ($row instanceof Model) {
            $row = $row->getAttributes();
        } elseif (is_object($row)) {
            $row = get_object_vars($row);
        }

        $shaped = MemberProfileVisibility::withoutSurname([
            'profile_type' => $row[$prefix . 'profile_type'] ?? 'individual',
            'organization_name' => $row[$prefix . 'organization_name'] ?? null,
            'first_name' => $row[$prefix . 'first_name'] ?? '',
        ]);
        $name = trim((string) ($shaped['name'] ?? ''));

        return $name !== '' ? $name : (string) $fallback;
    }
}
