<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Jobs\CreateSupportJiraTicket;
use App\Models\SupportReport;
use App\Models\User;
use App\Services\SupportJiraTicketService;
use App\Services\SupportReportNotificationService;
use App\Services\SupportReportSentryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class SupportReportController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const ALLOWED_IMPACTS = ['blocked', 'major', 'minor', 'cosmetic'];

    /**
     * The four kinds of "Help & support" request; they match the Jira help
     * desk's request types. Only 'broken' asks for an impact and may carry
     * diagnostics. Clients that send no type (web-uk, older builds) mean 'broken'.
     */
    private const REQUEST_TYPES = ['broken', 'how_to', 'account', 'suggestion'];
    private const FILTERED = '[filtered]';
    private const MAX_DIAGNOSTIC_DEPTH = 6;
    private const MAX_DIAGNOSTIC_ITEMS = 80;
    private const MAX_DIAGNOSTIC_STRING_LENGTH = 2000;
    private const SENSITIVE_KEY_PATTERN = '/(authorization|password|passcode|token|secret|cookie|csrf|session|email|phone|address|credit|card|cvv|iban|sort_code)/i';

    /**
     * F-281: diagnostics keys whose value is a page address. The query string and
     * fragment are dropped entirely — that is where reset/sign-in tokens live.
     */
    private const PAGE_ADDRESS_KEYS = ['page_url', 'route', 'url', 'href', 'referrer', 'referer'];

    /**
     * F-281: an API request address keeps its parameter names but only these
     * plainly non-secret values. Keep in step with SAFE_QUERY_KEYS in
     * react-frontend/src/lib/supportDiagnostics.ts.
     */
    private const SAFE_QUERY_KEYS = [
        'page', 'per_page', 'limit', 'offset', 'cursor', 'sort', 'order', 'direction',
        'filter', 'status', 'type', 'category', 'tab', 'view', 'include', 'fields',
        'lang', 'locale', 'format', 'period', 'from', 'to',
    ];

    public function store(Request $request): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $dailyLimit = max(1, (int) config('support_jira.daily_member_limit', 5));
        $sentToday = SupportReport::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('created_at', '>=', now()->subDay())
            ->count();
        if ($sentToday >= $dailyLimit) {
            return $this->respondWithErrors([[
                'code' => 'SUPPORT_REPORT_DAILY_LIMIT',
                'message' => __('api.support_reports_daily_limit', ['count' => $dailyLimit]),
            ]], 429);
        }

        $validator = Validator::make($request->all(), [
            'request_type' => ['nullable', 'string', 'in:' . implode(',', self::REQUEST_TYPES)],
            'summary' => ['required', 'string', 'min:3', 'max:180'],
            'description' => ['required', 'string', 'min:10', 'max:5000'],
            'impact' => ['exclude_unless:request_type,broken,null', 'required', 'string', 'in:' . implode(',', self::ALLOWED_IMPACTS)],
            'module' => ['nullable', 'string', 'max:100'],
            'route' => ['nullable', 'string', 'max:255'],
            'page_url' => ['nullable', 'string', 'max:2048'],
            'sentry_event_id' => ['nullable', 'string', 'max:191'],
            'sentry_issue_url' => ['nullable', 'string', 'max:2048'],
            'include_diagnostics' => ['sometimes', 'boolean'],
            'diagnostics' => ['nullable', 'array'],
        ], [
            'summary.required' => __('api.support_reports_summary_required'),
            'summary.max' => __('api.support_reports_summary_max'),
            'description.required' => __('api.support_reports_description_required'),
            'description.min' => __('api.support_reports_description_min'),
            'description.max' => __('api.support_reports_description_max'),
            'impact.required' => __('api.support_reports_impact_required'),
            'impact.in' => __('api.support_reports_impact_invalid'),
            'request_type.in' => __('api.support_reports_request_type_invalid'),
        ]);

        if ($validator->fails()) {
            $errors = [];
            foreach ($validator->errors()->messages() as $field => $messages) {
                $errors[] = [
                    'code' => 'VALIDATION_FAILED',
                    'message' => (string) ($messages[0] ?? __('api.validation_failed')),
                    'field' => $field,
                ];
            }

            return $this->respondWithErrors($errors, 422);
        }

        $validated = $validator->validated();
        $requestType = (string) ($validated['request_type'] ?? 'broken');
        // Diagnostics are collected only for something that is not working.
        $includeDiagnostics = $requestType === 'broken' && (bool) ($validated['include_diagnostics'] ?? false);
        $diagnostics = $includeDiagnostics
            ? $this->normaliseDiagnostics($validated['diagnostics'] ?? null)
            : null;

        $report = SupportReport::create([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'reference' => $this->generateReference(),
            'source' => 'in_app',
            'request_type' => $requestType,
            'summary' => trim((string) $validated['summary']),
            'description' => trim((string) $validated['description']),
            // The column is NOT NULL; a question or suggestion has no impact,
            // so it is stored at the default and never mapped to a priority.
            'impact' => (string) ($validated['impact'] ?? 'minor'),
            'status' => 'open',
            'module' => $this->nullableString($validated['module'] ?? null),
            'route' => $this->pathOnly($this->nullableString($validated['route'] ?? null)),
            'page_url' => $this->safePageUrl($this->nullableString($validated['page_url'] ?? null)),
            'sentry_event_id' => $this->nullableString($validated['sentry_event_id'] ?? null),
            'sentry_issue_url' => $this->safeSentryIssueUrl($this->nullableString($validated['sentry_issue_url'] ?? null)),
            'diagnostics' => $diagnostics,
            'user_agent' => $this->nullableString($request->userAgent(), 512),
            'ip_hash' => $this->hashIpAddress($request->ip()),
        ]);

        try {
            $sentryEventId = app(SupportReportSentryService::class)->captureCreated(
                $report,
                User::query()->find($userId),
                $this->nullableString($validated['sentry_event_id'] ?? null, 191),
            );

            if ($sentryEventId !== null) {
                $report->sentry_event_id = $sentryEventId;
                $report->save();
            }
        } catch (\Throwable $e) {
            Log::warning('[SupportReportController] support report Sentry capture failed', [
                'report_id' => $report->id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }

        try {
            SupportReportNotificationService::notifyCreated($report);
        } catch (\Throwable $e) {
            Log::warning('[SupportReportController] support report notification failed', [
                'report_id' => $report->id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }

        // The member's own receipt (their reference, in their language). It
        // never fails the request; failures are logged inside.
        SupportReportNotificationService::sendReceipt($report);

        if (SupportJiraTicketService::isEnabled()) {
            try {
                CreateSupportJiraTicket::dispatch((int) $report->id, (int) $tenantId);
            } catch (\Throwable $e) {
                // The report is saved and admins notified, so the member's
                // request genuinely succeeded; only the Jira copy is missing.
                Log::error('[SupportReportController] could not queue the Jira ticket', [
                    'report_id' => $report->id,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $this->respondWithData([
            'report' => [
                'id' => $report->id,
                'reference' => $report->reference,
                'request_type' => $report->request_type,
                'status' => $report->status,
                'impact' => $report->impact,
                'summary' => $report->summary,
                'created_at' => $report->created_at?->toIso8601String(),
            ],
        ], null, 201);
    }

    private function generateReference(): string
    {
        do {
            $reference = 'NXR-' . now()->format('ymd') . '-' . Str::upper(Str::random(6));
        } while (SupportReport::withoutGlobalScopes()->where('reference', $reference)->exists());

        return $reference;
    }

    private function normaliseDiagnostics(mixed $value): ?array
    {
        if (!is_array($value)) {
            return null;
        }

        return [
            'captured_at' => now()->toIso8601String(),
            'payload' => $this->redactDiagnosticValue($value),
        ];
    }

    private function redactDiagnosticValue(mixed $value, int $depth = 0): mixed
    {
        if ($depth > self::MAX_DIAGNOSTIC_DEPTH) {
            return '[truncated]';
        }

        if (is_array($value)) {
            $redacted = [];
            $count = 0;
            foreach ($value as $key => $item) {
                if ($count >= self::MAX_DIAGNOSTIC_ITEMS) {
                    $redacted['__truncated'] = true;
                    break;
                }

                $safeKey = is_int($key) ? $key : $this->redactDiagnosticKey((string) $key);
                if (is_string($key) && preg_match(self::SENSITIVE_KEY_PATTERN, $key)) {
                    $redacted[$safeKey] = self::FILTERED;
                } elseif (is_string($key) && is_string($item) && in_array(strtolower($key), self::PAGE_ADDRESS_KEYS, true)) {
                    $redacted[$safeKey] = $this->redactDiagnosticString((string) $this->pathOnly($item));
                } elseif (is_string($key) && is_string($item) && strtolower($key) === 'endpoint') {
                    $redacted[$safeKey] = $this->redactDiagnosticString($this->redactEndpointQuery($item));
                } else {
                    $redacted[$safeKey] = $this->redactDiagnosticValue($item, $depth + 1);
                }
                $count++;
            }

            return $redacted;
        }

        if (is_string($value)) {
            return $this->redactDiagnosticString($value);
        }

        if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
            return $value;
        }

        return $this->redactDiagnosticString((string) $value);
    }

    private function redactDiagnosticKey(string $key): string
    {
        if (preg_match(self::SENSITIVE_KEY_PATTERN, $key)) {
            return self::FILTERED;
        }

        return Str::limit($key, 120, '');
    }

    private function redactDiagnosticString(string $value): string
    {
        $redacted = preg_replace('/Bearer\s+[A-Za-z0-9._~+\/=-]+/i', 'Bearer ' . self::FILTERED, $value) ?? $value;
        $redacted = preg_replace('/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i', self::FILTERED, $redacted) ?? $redacted;
        // A web address quoted in free text keeps its path only (F-281).
        $redacted = preg_replace('~(https?://[^\s?#"\'<>]+)[?#][^\s"\'<>]*~i', '$1', $redacted) ?? $redacted;

        return Str::limit($redacted, self::MAX_DIAGNOSTIC_STRING_LENGTH, '');
    }

    /**
     * F-281: drop an address's query string and fragment. Credentials travel in
     * both, and a support report is stored and shown to every community admin.
     */
    private function pathOnly(?string $address): ?string
    {
        if ($address === null) {
            return null;
        }

        $path = trim(preg_split('/[?#]/', $address, 2)[0] ?? '');

        return $path === '' ? null : $path;
    }

    /**
     * F-281: the page address is opened by staff in a new window, so only an
     * http(s) or site-relative address is kept — and never its query or fragment.
     */
    private function safePageUrl(?string $pageUrl): ?string
    {
        $path = $this->pathOnly($pageUrl);
        if ($path === null) {
            return null;
        }

        if (preg_match('~^https?://~i', $path)) {
            return $path;
        }

        // F-358: a site-relative address must actually be site-relative.
        // "//attacker.example/collect" starts with "/" and was therefore kept,
        // but it is PROTOCOL-relative: window.open() resolves it against the
        // admin console's own scheme and lands on the attacker's host. The URL
        // parser treats "\" as "/" for special schemes, so "/\host", "\/host"
        // and "\\host" are the same shape and are refused with it.
        if (preg_match('~^[/\\\\][/\\\\]~', $path)) {
            return null;
        }

        if (str_starts_with($path, '/')) {
            return $path;
        }

        return null;
    }

    /**
     * F-358: the Sentry issue address is opened by staff in a new window from
     * the same admin console, but it was written straight from the request body
     * with no scheme check at all — so `javascript:`, a protocol-relative host
     * and a credential-bearing query all reached window.open. A Sentry issue
     * always lives on an absolute http(s) address, so there is no site-relative
     * form to allow.
     */
    private function safeSentryIssueUrl(?string $issueUrl): ?string
    {
        $path = $this->pathOnly($issueUrl);
        if ($path === null) {
            return null;
        }

        return preg_match('~^https?://~i', $path) ? $path : null;
    }

    /**
     * F-281: an API request address keeps its parameter names, but a value is
     * kept only under a plainly non-secret name; the fragment is dropped.
     */
    private function redactEndpointQuery(string $endpoint): string
    {
        $withoutFragment = explode('#', $endpoint, 2)[0];
        $parts = explode('?', $withoutFragment, 2);
        if (!isset($parts[1]) || $parts[1] === '') {
            return $parts[0];
        }

        $pairs = [];
        foreach (explode('&', $parts[1]) as $pair) {
            if ($pair === '') {
                continue;
            }
            [$rawKey] = explode('=', $pair, 2);
            $key = strtolower(urldecode($rawKey));
            $safe = in_array($key, self::SAFE_QUERY_KEYS, true)
                && !preg_match(self::SENSITIVE_KEY_PATTERN, $key);
            $pairs[] = $safe ? $pair : $rawKey . '=' . self::FILTERED;
        }

        return $parts[0] . ($pairs === [] ? '' : '?' . implode('&', $pairs));
    }

    private function nullableString(mixed $value, int $maxLength = 2048): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);
        if ($string === '') {
            return null;
        }

        return Str::limit($string, $maxLength, '');
    }

    private function hashIpAddress(?string $ipAddress): ?string
    {
        if (!$ipAddress) {
            return null;
        }

        $key = config('app.key') ?: 'nexus-support-report-ip-hash';

        return hash_hmac('sha256', $ipAddress, (string) $key);
    }
}
