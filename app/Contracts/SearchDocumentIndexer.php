<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Contracts;

/**
 * Where SearchReindexService sends each row it reads.
 *
 * SearchService's index methods are static, so a test cannot stand in for
 * them. This seam lets the full sync (the script, and the platform team's
 * "Rebuild search" job) be tested without a search server: the default,
 * App\Services\MeilisearchDocumentIndexer, calls SearchService exactly as the
 * script always did; a test binds a fake in the container.
 */
interface SearchDocumentIndexer
{
    /**
     * Send one row to the search index for its kind, and wait for the search
     * server's verdict. Throws when that row could not be indexed.
     *
     * @param string               $type one of SearchReindexService::TYPES
     * @param array<string, mixed> $row  the row as SearchReindexService read it
     */
    public function index(string $type, array $row): void;

    /** Does the search server answer right now (no per-process memo)? */
    public function reachable(): bool;
}
