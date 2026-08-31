<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Reconciles the delayed delivery receipts returned by Expo Push Service.
 *
 * A successful send ticket only means Expo accepted the message. APNs/FCM
 * delivery failures arrive later through receipts, so this job removes dead
 * device tokens and makes credential failures operationally visible.
 */
final class CheckExpoPushReceipts implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    private const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

    public int $tries = 3;
    public int $timeout = 30;

    /** @var int[] */
    public array $backoff = [60, 300, 900];

    /** @param array<string,string> $ticketTokens Expo ticket ID => device token */
    public function __construct(public readonly array $ticketTokens)
    {
    }

    public function handle(): void
    {
        foreach (array_chunk($this->ticketTokens, 1000, true) as $ticketTokens) {
            $request = Http::acceptJson()->asJson()->timeout(15);
            $accessToken = trim((string) config('services.expo.access_token', ''));
            if ($accessToken !== '') {
                $request = $request->withToken($accessToken);
            }
            $response = $request
                ->post(self::RECEIPTS_URL, ['ids' => array_keys($ticketTokens)]);

            if (! $response->successful()) {
                throw new RuntimeException('Expo push receipt HTTP ' . $response->status());
            }

            $receipts = $response->json('data');
            if (! is_array($receipts)) {
                throw new RuntimeException('Expo push receipt response was malformed');
            }

            $missingTicketIds = array_diff(array_keys($ticketTokens), array_map('strval', array_keys($receipts)));
            if ($missingTicketIds !== []) {
                throw new RuntimeException('Expo push receipts are not ready for every requested ticket');
            }

            foreach ($receipts as $ticketId => $receipt) {
                if (($receipt['status'] ?? null) === 'ok') {
                    continue;
                }

                $error = (string) ($receipt['details']['error'] ?? 'UnknownExpoReceiptError');
                $token = $ticketTokens[(string) $ticketId] ?? null;

                if ($error === 'DeviceNotRegistered' && is_string($token)) {
                    DB::table('fcm_device_tokens')->where('token', $token)->delete();
                    continue;
                }

                Log::error('Expo push delivery receipt failed', [
                    'ticket_id' => (string) $ticketId,
                    'error' => $error,
                ]);
            }
        }
    }
}
