<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\SearchService;
use Meilisearch\Client;
use Meilisearch\Endpoints\Indexes;
use PHPUnit\Framework\TestCase;

class SearchServiceTaskVerificationTest extends TestCase
{
    private const USER = ['id' => 41, 'tenant_id' => 2, 'first_name' => 'Synthetic'];

    public function test_operator_sync_counts_only_a_completed_document_task(): void
    {
        $index = $this->createMock(Indexes::class);
        $index->expects($this->once())
            ->method('addDocuments')
            ->with([self::USER], 'id')
            ->willReturn(['taskUid' => 101]);

        $client = $this->createMock(Client::class);
        $client->expects($this->once())->method('index')->with('users')->willReturn($index);
        $client->expects($this->once())
            ->method('waitForTask')
            ->with(101, 120_000, 100)
            ->willReturn(['status' => 'succeeded']);

        SearchServiceTaskDouble::setClient($client);
        SearchServiceTaskDouble::indexUser(self::USER, true);
    }

    public function test_operator_sync_reports_an_asynchronous_rejection(): void
    {
        $index = $this->createMock(Indexes::class);
        $index->method('addDocuments')->willReturn(['taskUid' => 102]);

        $client = $this->createMock(Client::class);
        $client->method('index')->willReturn($index);
        $client->method('waitForTask')->willReturn([
            'status' => 'failed',
            'error' => [
                'code' => 'index_primary_key_multiple_candidates_found',
                'message' => 'The primary key could not be inferred',
            ],
        ]);

        SearchServiceTaskDouble::setClient($client);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('task 102 failed (index_primary_key_multiple_candidates_found)');
        SearchServiceTaskDouble::indexUser(self::USER, true);
    }

    public function test_ordinary_indexing_stays_asynchronous(): void
    {
        $index = $this->createMock(Indexes::class);
        $index->expects($this->once())->method('addDocuments')->with([self::USER], 'id')->willReturn(['taskUid' => 103]);

        $client = $this->createMock(Client::class);
        $client->method('index')->willReturn($index);
        $client->expects($this->never())->method('waitForTask');

        SearchServiceTaskDouble::setClient($client);
        SearchServiceTaskDouble::indexUser(self::USER);
    }

    public function test_verified_sync_does_not_count_an_unindexable_event_as_indexed(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Event 55 is not indexable during verified sync');

        SearchServiceTaskDouble::indexEvent([
            'id' => 55,
            'tenant_id' => 2,
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
        ], true);
    }
}

/** @internal Isolates the real SDK task path without a live Meilisearch service. */
final class SearchServiceTaskDouble extends SearchService
{
    private static Client $testClient;

    public static function setClient(Client $client): void
    {
        self::$testClient = $client;
    }

    public static function isAvailable(): bool
    {
        return true;
    }

    protected static function client(): Client
    {
        return self::$testClient;
    }
}
