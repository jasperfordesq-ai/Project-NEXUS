<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\SearchDocumentIndexer;

/**
 * The real SearchDocumentIndexer: the same SearchService calls
 * `scripts/sync_search_index.php` made before its loops moved into
 * SearchReindexService, each with `$verifyTask = true` (wait for the search
 * server's verdict, throw if it refused).
 */
final class MeilisearchDocumentIndexer implements SearchDocumentIndexer
{
    public function index(string $type, array $row): void
    {
        match ($type) {
            'listing' => SearchService::indexListing($row, true),
            'user' => SearchService::indexUser($row, true),
            'event' => SearchService::indexEvent($row, true),
            'group' => SearchService::indexGroup($row, true),
            'marketplace' => SearchService::indexMarketplaceListing($row, true),
            default => throw new \InvalidArgumentException("Unknown search entry type: {$type}"),
        };
    }

    public function reachable(): bool
    {
        return SearchService::isReachableNow();
    }
}
