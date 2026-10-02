<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\SupportReport;
use App\Models\User;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Copies one saved support report into the Jira Service Management help desk
 * (config/support_jira.php). Called only from the CreateSupportJiraTicket job,
 * after the report is already safely stored on the platform.
 *
 * What is sent is the report AS STORED, so it carries the same F-281/F-358
 * redaction as the admin console: page addresses without query or fragment,
 * diagnostics already filtered. The member's IP hash is never sent. The
 * member's email address is sent only when support_jira.send_member_email is on.
 *
 * Creating the ticket is the one step that must succeed; it throws on failure
 * so the queue retries. Setting priority/labels and attaching diagnostics run
 * once the ticket exists and are best-effort: a failure there is recorded on
 * the report (jira_last_error) and logged, but does not create a duplicate
 * ticket by retrying the whole job.
 */
class SupportJiraTicketService
{
    private const MAX_ERROR_LENGTH = 500;

    public static function isEnabled(): bool
    {
        return (bool) config('support_jira.enabled', false);
    }

    /**
     * @throws \RuntimeException when Jira refuses or cannot be reached
     */
    public function sync(SupportReport $report): void
    {
        if (!self::isEnabled() || $report->jira_issue_key) {
            return;
        }

        $missing = $this->missingSettings();
        if ($missing !== []) {
            $message = 'Jira connection is switched on but not configured: missing ' . implode(', ', $missing);
            Log::error('[SupportJiraTicketService] ' . $message, ['report_id' => $report->id, 'tenant_id' => $report->tenant_id]);
            $this->recordError($report, $message);

            return;
        }

        $serviceDeskId = (string) config('support_jira.service_desk_id');
        $requestType = $this->requestType($report);
        $member = $report->user_id ? User::query()->withoutGlobalScopes()
            ->where('tenant_id', $report->tenant_id)
            ->find($report->user_id) : null;
        $tenant = DB::table('tenants')->where('id', $report->tenant_id)->first(['id', 'name', 'slug']);

        $payload = [
            'serviceDeskId' => $serviceDeskId,
            'requestTypeId' => (string) config('support_jira.request_types.' . $requestType),
            'requestFieldValues' => [
                'summary' => Str::limit((string) $report->summary, 250, ''),
                'description' => $this->description($report, $requestType, $tenant),
            ],
        ];

        if ($this->sendMemberEmail() && $member && $member->email) {
            $payload['raiseOnBehalfOf'] = $this->customerAccountId($serviceDeskId, $member);
        }

        $response = $this->client()->post('/rest/servicedeskapi/request', $payload);
        if (!$response->successful()) {
            $this->fail($report, 'create the ticket', $response);
        }

        $issueKey = (string) ($response->json('issueKey') ?? '');
        if ($issueKey === '') {
            $this->fail($report, 'read the new ticket key', $response);
        }

        // Saved before the follow-up steps so a retry never raises a second ticket.
        $report->jira_issue_key = Str::limit($issueKey, 32, '');
        $report->jira_synced_at = now();
        $report->jira_last_error = null;
        $report->save();

        $warnings = array_filter([
            $this->setPriorityAndLabels($issueKey, $report, $requestType, $tenant),
            $this->attachDiagnostics($serviceDeskId, $issueKey, $report),
        ]);

        if ($warnings !== []) {
            $this->recordError($report, implode(' | ', $warnings));
        }
    }

    public function issueUrl(?string $issueKey): ?string
    {
        $base = (string) config('support_jira.base_url', '');
        if (!$issueKey || $base === '') {
            return null;
        }

        return $base . '/browse/' . rawurlencode($issueKey);
    }

    private function requestType(SupportReport $report): string
    {
        $type = (string) ($report->request_type ?: 'broken');

        return array_key_exists($type, (array) config('support_jira.request_types', [])) ? $type : 'broken';
    }

    private function description(SupportReport $report, string $requestType, ?object $tenant): string
    {
        $lines = [
            trim((string) $report->description),
            '',
            '----',
            'Reference: ' . $report->reference,
            'Request type: ' . $requestType,
            'Community: ' . ($tenant->name ?? 'unknown') . ' (tenant id ' . $report->tenant_id . ')',
            'Platform user id: ' . ($report->user_id ?? 'unknown'),
        ];

        if ($requestType === 'broken') {
            $lines[] = 'Impact: ' . $report->impact;
        }
        if ($report->route) {
            $lines[] = 'Page: ' . $report->route;
        }
        if ($report->page_url) {
            $lines[] = 'Page address: ' . $report->page_url;
        }
        $lines[] = 'App version: ' . (string) config('app.version', 'unknown');
        if ($report->sentry_issue_url) {
            $lines[] = 'Sentry issue: ' . $report->sentry_issue_url;
        } elseif ($report->sentry_event_id) {
            $lines[] = 'Sentry event id: ' . $report->sentry_event_id;
        }
        if ($report->user_agent) {
            $lines[] = 'Browser: ' . $report->user_agent;
        }
        if (!empty($report->diagnostics)) {
            $lines[] = 'Technical details: attached as ' . $this->diagnosticsFilename($report);
        }

        return implode("\n", $lines);
    }

    /**
     * Returns a warning string on failure, null on success.
     */
    private function setPriorityAndLabels(string $issueKey, SupportReport $report, string $requestType, ?object $tenant): ?string
    {
        $fields = [
            'labels' => array_values(array_filter([
                'nexus-in-app',
                'nexus-' . str_replace('_', '-', $requestType),
                $this->tenantLabel($tenant, (int) $report->tenant_id),
            ])),
        ];

        $priority = $requestType === 'broken'
            ? config('support_jira.priorities.' . $report->impact)
            : null;
        if (is_string($priority) && $priority !== '') {
            $fields['priority'] = ['name' => $priority];
        }

        try {
            $response = $this->client()->put('/rest/api/3/issue/' . rawurlencode($issueKey), ['fields' => $fields]);
        } catch (\Throwable $e) {
            return $this->warn($report, 'set priority and labels', $e->getMessage());
        }

        return $response->successful() ? null : $this->warn($report, 'set priority and labels', 'HTTP ' . $response->status());
    }

    /**
     * Returns a warning string on failure, null on success or when there is nothing to attach.
     */
    private function attachDiagnostics(string $serviceDeskId, string $issueKey, SupportReport $report): ?string
    {
        if (empty($report->diagnostics)) {
            return null;
        }

        try {
            $json = json_encode($report->diagnostics, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $upload = $this->client(json: false)
                ->withHeaders(['X-Atlassian-Token' => 'no-check', 'X-ExperimentalApi' => 'opt-in'])
                ->attach('file', $json, $this->diagnosticsFilename($report), ['Content-Type' => 'application/json'])
                ->post('/rest/servicedeskapi/servicedesk/' . rawurlencode($serviceDeskId) . '/attachTemporaryFile');
            if (!$upload->successful()) {
                return $this->warn($report, 'upload technical details', 'HTTP ' . $upload->status());
            }

            $temporaryIds = array_values(array_filter(array_map(
                fn ($item) => is_array($item) ? ($item['temporaryAttachmentId'] ?? null) : null,
                (array) $upload->json('temporaryAttachments', []),
            )));
            if ($temporaryIds === []) {
                return $this->warn($report, 'upload technical details', 'no attachment id returned');
            }

            $attach = $this->client()->post('/rest/servicedeskapi/request/' . rawurlencode($issueKey) . '/attachment', [
                'temporaryAttachmentIds' => $temporaryIds,
                // Internal to agents: the member already has their own report.
                'public' => false,
            ]);
        } catch (\Throwable $e) {
            return $this->warn($report, 'attach technical details', $e->getMessage());
        }

        return $attach->successful() ? null : $this->warn($report, 'attach technical details', 'HTTP ' . $attach->status());
    }

    /**
     * Finds or creates the member as a help-desk customer and makes sure they
     * belong to this service desk (channel access is Restricted).
     *
     * @throws \RuntimeException
     */
    private function customerAccountId(string $serviceDeskId, User $member): string
    {
        $email = (string) $member->email;
        $created = $this->client()->post('/rest/servicedeskapi/customer', [
            'email' => $email,
            'displayName' => trim((string) $member->name) !== '' ? (string) $member->name : $email,
        ]);

        $accountId = $created->successful() ? (string) ($created->json('accountId') ?? '') : '';
        if ($accountId === '' && $created->status() === 400) {
            $found = $this->client()->get('/rest/api/3/user/search', ['query' => $email]);
            if ($found->successful()) {
                $accountId = (string) ($found->json('0.accountId') ?? '');
            }
        }

        if ($accountId === '') {
            throw new \RuntimeException('Jira: could not find or create the help-desk customer (HTTP ' . $created->status() . ')');
        }

        $added = $this->client()->post('/rest/servicedeskapi/servicedesk/' . rawurlencode($serviceDeskId) . '/customer', [
            'accountIds' => [$accountId],
        ]);
        if (!$added->successful()) {
            throw new \RuntimeException('Jira: could not add the customer to the help desk (HTTP ' . $added->status() . ')');
        }

        return $accountId;
    }

    private function tenantLabel(?object $tenant, int $tenantId): string
    {
        $slug = Str::slug((string) ($tenant->slug ?? ''));

        // Jira labels cannot contain spaces; keep them short and predictable.
        return 'tenant-' . ($slug !== '' ? Str::limit($slug, 60, '') : (string) $tenantId);
    }

    private function diagnosticsFilename(SupportReport $report): string
    {
        return 'diagnostics-' . preg_replace('/[^A-Za-z0-9-]/', '', (string) $report->reference) . '.json';
    }

    private function sendMemberEmail(): bool
    {
        return (bool) config('support_jira.send_member_email', false);
    }

    /**
     * @return list<string>
     */
    private function missingSettings(): array
    {
        $missing = [];
        foreach (['base_url', 'service_desk_id', 'email', 'api_token'] as $key) {
            if (trim((string) config('support_jira.' . $key, '')) === '') {
                $missing[] = 'SUPPORT_JIRA_' . strtoupper($key);
            }
        }

        return $missing;
    }

    /**
     * @param bool $json false for the multipart attachment upload, which must
     *                   not carry a JSON Content-Type header
     */
    private function client(bool $json = true): PendingRequest
    {
        $client = Http::baseUrl((string) config('support_jira.base_url'))
            ->withBasicAuth((string) config('support_jira.email'), (string) config('support_jira.api_token'))
            ->acceptJson()
            ->timeout(max(1, (int) config('support_jira.timeout_seconds', 15)));

        return $json ? $client->asJson() : $client;
    }

    /**
     * @throws \RuntimeException
     */
    private function fail(SupportReport $report, string $step, Response $response): never
    {
        $message = 'Jira: could not ' . $step . ' (HTTP ' . $response->status() . ')';
        $detail = $this->jiraErrorDetail($response);
        if ($detail !== '') {
            $message .= ': ' . $detail;
        }

        $this->recordError($report, $message);

        throw new \RuntimeException($message);
    }

    private function warn(SupportReport $report, string $step, string $detail): string
    {
        $message = 'Jira ticket created, but could not ' . $step . ': ' . $this->scrub($detail);
        Log::error('[SupportJiraTicketService] ' . $message, ['report_id' => $report->id, 'tenant_id' => $report->tenant_id]);

        return $message;
    }

    private function jiraErrorDetail(Response $response): string
    {
        $json = $response->json();
        if (!is_array($json)) {
            return '';
        }

        $parts = [];
        if (isset($json['errorMessage']) && is_string($json['errorMessage'])) {
            $parts[] = $json['errorMessage'];
        }
        foreach ((array) ($json['errorMessages'] ?? []) as $item) {
            if (is_string($item)) {
                $parts[] = $item;
            }
        }
        foreach ((array) ($json['errors'] ?? []) as $field => $item) {
            if (is_string($item)) {
                $parts[] = $field . ': ' . $item;
            }
        }

        return $this->scrub(implode('; ', $parts));
    }

    private function recordError(SupportReport $report, string $message): void
    {
        $report->jira_last_error = Str::limit($this->scrub($message), self::MAX_ERROR_LENGTH, '');
        $report->save();
    }

    /** Belt and braces: the API token must never reach a log line or the database. */
    private function scrub(string $text): string
    {
        $token = (string) config('support_jira.api_token', '');

        return $token !== '' ? str_replace($token, '[filtered]', $text) : $text;
    }
}
