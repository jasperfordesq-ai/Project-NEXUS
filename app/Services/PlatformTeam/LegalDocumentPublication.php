<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

/**
 * The one rule the platform team panel uses for "this legal document is
 * published": the document is switched on (`legal_documents.is_active`) and
 * its current version (`legal_documents.current_version_id`) exists and is
 * not a draft (`legal_document_versions.is_draft = 0`).
 *
 * Shared by the Community setup page (CommunitySetupChecklistService) and the
 * Legal documents page (LegalDocumentsService), so the two can never disagree
 * about the same document.
 */
final class LegalDocumentPublication
{
    /**
     * A SQL condition, true when the document is published. `$version` must be
     * the version joined on `<document>.current_version_id` (left or inner join).
     * The aliases are written by the caller's code, never taken from a request.
     */
    public static function publishedSql(string $document = 'ld', string $version = 'ldv'): string
    {
        return "({$document}.is_active = 1 AND {$version}.id IS NOT NULL AND {$version}.is_draft = 0)";
    }
}
