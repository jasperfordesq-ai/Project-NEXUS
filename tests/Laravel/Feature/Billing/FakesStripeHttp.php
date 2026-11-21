<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Stripe\Util\CaseInsensitiveArray;

/**
 * Replaces the Stripe library's HTTP client with one that records every
 * request and answers from memory, the same way StripePlanPriceCurrencyTest
 * does. No test using this can reach the network.
 *
 * Set `$this->stripe->failPrices = true` to make every price creation fail
 * the way an unreachable Stripe would.
 *
 * Call installFakeStripe() in setUp and uninstallFakeStripe() in tearDown.
 */
trait FakesStripeHttp
{
    /** @var ClientInterface&object{requests: array<int, array{method: string, path: string, params: array<string, mixed>}>, failPrices: bool} */
    private ClientInterface $stripe;

    private function installFakeStripe(): void
    {
        config(['services.stripe.secret' => 'sk_test_not_a_real_key']);

        $this->stripe = new class implements ClientInterface {
            /** @var array<int, array{method: string, path: string, params: array<string, mixed>}> */
            public array $requests = [];
            public bool $failPrices = false;
            public bool $failRetrieve = false;
            /** @var array<string, int> What each known Stripe price charges, in cents. */
            public array $priceAmounts = [];
            private int $n = 0;

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $method = strtoupper((string) $method);
                $path = (string) parse_url((string) $absUrl, PHP_URL_PATH);
                $params = is_array($params) ? $params : [];
                $this->requests[] = ['method' => $method, 'path' => $path, 'params' => $params];
                $n = ++$this->n;

                if ($this->failPrices && $method === 'POST' && $path === '/v1/prices') {
                    $error = ['error' => ['type' => 'api_error', 'message' => 'Stripe is down in this test']];

                    return [json_encode($error), 500, new CaseInsensitiveArray([])];
                }

                if ($method === 'GET' && str_starts_with($path, '/v1/prices/')) {
                    $id = substr($path, strlen('/v1/prices/'));
                    if ($this->failRetrieve || !isset($this->priceAmounts[$id])) {
                        $error = ['error' => ['type' => 'invalid_request_error', 'message' => "No such price in this test: {$id}"]];

                        return [json_encode($error), 404, new CaseInsensitiveArray([])];
                    }

                    return [json_encode(['id' => $id, 'object' => 'price', 'unit_amount' => $this->priceAmounts[$id]]), 200, new CaseInsensitiveArray([])];
                }

                if ($method === 'POST' && $path === '/v1/prices') {
                    $this->priceAmounts["price_fake_{$n}"] = (int) ($params['unit_amount'] ?? 0);
                }

                $body = match (true) {
                    $method === 'POST' && $path === '/v1/products' => ['id' => "prod_fake_{$n}", 'object' => 'product'],
                    $method === 'POST' && str_starts_with($path, '/v1/products/') => ['id' => substr($path, strlen('/v1/products/')), 'object' => 'product'],
                    $method === 'POST' && $path === '/v1/prices' => [
                        'id' => "price_fake_{$n}",
                        'object' => 'price',
                        'currency' => $params['currency'] ?? null,
                        'unit_amount' => $params['unit_amount'] ?? null,
                    ],
                    default => throw new \RuntimeException("Unexpected Stripe request in this test: {$method} {$path}"),
                };

                return [json_encode($body), 200, new CaseInsensitiveArray([])];
            }
        };

        ApiRequestor::setHttpClient($this->stripe);
    }

    private function uninstallFakeStripe(): void
    {
        ApiRequestor::setHttpClient(null);
    }

    /**
     * Every price creation sent, in order.
     *
     * @return list<array<string, mixed>>
     */
    private function pricesCreated(): array
    {
        return array_values(array_map(
            static fn (array $r): array => $r['params'],
            array_filter($this->stripe->requests, static fn (array $r): bool => $r['method'] === 'POST' && $r['path'] === '/v1/prices')
        ));
    }
}
