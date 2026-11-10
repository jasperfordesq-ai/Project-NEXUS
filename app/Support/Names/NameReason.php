<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Names;

/**
 * Every reason this platform may build a member's FULL name (E-122).
 *
 * Owner rule, 10 November 2026: "No surnames should be anywhere on the site
 * apart from for admins." Code that needs a surname anyway must say why, by
 * naming one of these cases in {@see \App\Support\UserDisplayName::full()},
 * {@see \App\Support\UserDisplayName::sqlFull()},
 * {@see NameAudience::withFullNames()} or {@see NameAudience::grantForRequest()}.
 * `grep -rn 'NameReason::' app/` is therefore the complete list of places a
 * surname is deliberately kept.
 *
 * 🔴 Adding a case is the review point. Do not add a catch-all ("OTHER",
 * "MISC"): a reason that cannot be named is a leak that has not been found yet.
 */
enum NameReason: string
{
    /** The route passed the admin / super-admin / super-panel / tenant-super-admin gate. */
    case ADMIN_ROUTE = 'admin_route';

    /** The route passed the broker-or-admin gate (owner, 10 Nov 2026: "Brokers too"). */
    case BROKER_PANEL = 'broker_panel';

    /** The member's own name, shown to that member (own account, own profile, sign-in). */
    case SELF = 'self';

    /**
     * An email or alert whose recipients are, by the query that chose them,
     * staff of the community (admins, brokers, coordinators).
     */
    case STAFF_RECIPIENT = 'staff_recipient';

    /** Legal acceptance records, signed documents, statutory statements. */
    case LEGAL_RECORD = 'legal_record';

    /** A certificate issued to the named member. */
    case OWN_CERTIFICATE = 'own_certificate';

    /** The member's own data export — their own name only, never other people's. */
    case OWN_DATA_EXPORT = 'own_data_export';

    /** A processor that needs the legal name: payment provider, identity provider. Never an AI provider. */
    case EXTERNAL_PROCESSOR = 'external_processor';

    /** Rows written to audit tables that only administrators read. */
    case AUDIT_LOG = 'audit_log';

    /** Writing the stored `users.name` column. */
    case STORAGE = 'storage';

    /**
     * The calling code has itself decided that THIS viewer may see THIS
     * member's surname, by a rule the request-wide audience cannot express.
     * Internal federation is the case: the member shown belongs to another
     * community, so "is the viewer staff of the request's community" is the
     * wrong question ({@see \App\Support\Federation\FederatedMemberName}).
     */
    case CHECKED_BY_CALLER = 'checked_by_caller';
}
