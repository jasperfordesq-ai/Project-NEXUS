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
     * True when Jira itself will email the member (the ticket is raised in
     * their name), so the platform's own receipt would be a second, duplicate
     * confirmation. The platform receipt is then sent only as a fallback if
     * the ticket finally cannot be created (CreateSupportJiraTicket::failed).
     */
    public static function willEmailMember(): bool
    {
        return self::isEnabled() && (bool) config('support_jira.send_member_email', false);
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
                'description' => $this->description($report, $requestType, $tenant, $this->sendMemberEmail() ? $member : null),
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
            $this->assignIssue($issueKey, $report),
            $this->attachDiagnostics($serviceDeskId, $issueKey, $report),
        ]);

        if ($warnings !== []) {
            $this->recordError($report, implode(' | ', $warnings));
        }
    }

    /**
     * Jira → platform status mirror (run every 15 minutes by
     * support:jira-sync-status). Jira is the one place a copied report is
     * answered, so the platform READS ticket status and never writes to Jira:
     *
     * - done in Jira                        → report 'resolved'
     * - not done, but the report 'resolved' → 'triaged' (reopened in Jira)
     * - a report an admin 'closed'          → left alone, not even asked about
     *
     * Runs across every community (it is a platform job), but each row is
     * updated by id AND its own tenant_id. A failed batch changes nothing and
     * is logged at error; the next run tries again.
     *
     * @return array{checked:int, updated:int, failed_batches:int}
     */
    public function syncStatuses(int $limit = 500): array
    {
        $result = ['checked' => 0, 'updated' => 0, 'failed_batches' => 0];
        if (!self::isEnabled() || $this->missingSettings() !== []) {
            return $result;
        }

        $reports = DB::table('support_reports')
            ->whereNotNull('jira_issue_key')
            ->where('status', '!=', 'closed')
            ->orderBy('jira_status_checked_at')
            ->orderByDesc('id')
            ->limit(max(1, $limit))
            ->get(['id', 'tenant_id', 'status', 'jira_issue_key']);

        foreach ($reports->chunk(50) as $batch) {
            $keys = $batch->pluck('jira_issue_key')
                ->filter(fn ($key) => is_string($key) && preg_match('/^[A-Z][A-Z0-9_]*-\d+$/', $key))
                ->unique()
                ->values()
                ->all();
            if ($keys === []) {
                continue;
            }

            $statuses = $this->fetchStatuses($keys);
            if ($statuses === null) {
                $result['failed_batches']++;
                continue;
            }

            foreach ($batch as $row) {
                $result['checked']++;
                $status = $statuses[$row->jira_issue_key] ?? null;
                if ($status === null) {
                    continue;
                }
                if ($this->applyStatus($row, $status['name'], $status['done'])) {
                    $result['updated']++;
                }
            }
        }

        return $result;
    }

    /**
     * @param list<string> $keys
     * @return array<string, array{name:string, done:bool}>|null null when Jira could not be asked
     */
    private function fetchStatuses(array $keys): ?array
    {
        try {
            $response = $this->client()->post('/rest/api/3/search/jql', [
                'jql' => 'key in (' . implode(',', $keys) . ')',
                'fields' => ['status'],
                'maxResults' => count($keys),
            ]);
        } catch (\Throwable $e) {
            Log::error('[SupportJiraTicketService] status check could not reach Jira', ['error' => $this->scrub($e->getMessage())]);

            return null;
        }

        if (!$response->successful()) {
            Log::error('[SupportJiraTicketService] status check refused by Jira', [
                'status' => $response->status(),
                'detail' => $this->jiraErrorDetail($response),
            ]);

            return null;
        }

        $statuses = [];
        foreach ((array) $response->json('issues', []) as $issue) {
            $key = is_array($issue) ? ($issue['key'] ?? null) : null;
            $name = is_array($issue) ? ($issue['fields']['status']['name'] ?? null) : null;
            if (!is_string($key) || !is_string($name)) {
                continue;
            }
            $statuses[$key] = [
                'name' => $name,
                'done' => ($issue['fields']['status']['statusCategory']['key'] ?? null) === 'done',
            ];
        }

        return $statuses;
    }

    private function applyStatus(object $row, string $jiraStatus, bool $done): bool
    {
        $updates = [
            'jira_status' => Str::limit($jiraStatus, 100, ''),
            'jira_status_checked_at' => now(),
        ];

        $changed = false;
        if ($done && $row->status !== 'resolved') {
            $updates['status'] = 'resolved';
            $updates['resolved_at'] = now();
            $changed = true;
        } elseif (!$done && $row->status === 'resolved') {
            $updates['status'] = 'triaged';
            $updates['resolved_at'] = null;
            $changed = true;
        }

        if ($changed) {
            $updates['updated_at'] = now();
        }

        DB::table('support_reports')
            ->where('id', $row->id)
            ->where('tenant_id', $row->tenant_id)
            ->update($updates);

        return $changed;
    }

    /**
     * Read-only connection check for `support:jira-check`. Deliberately does
     * NOT look at support_jira.enabled: it exists to prove the connection
     * while the member-facing switch is still off.
     *
     * @return array{
     *     ok: bool,
     *     missing: list<string>,
     *     api_base: string,
     *     service_desk: array{ok: bool, status: int|null, project_key: string|null, name: string|null},
     *     request_types: array<string, array{configured: string, found: bool, name: string|null}>
     * }
     */
    public function checkConnection(): array
    {
        $result = [
            'ok' => false,
            'missing' => $this->missingSettings(),
            'api_base' => $this->apiBaseUrl(),
            'service_desk' => ['ok' => false, 'status' => null, 'project_key' => null, 'name' => null],
            'request_types' => [],
        ];
        if ($result['missing'] !== []) {
            return $result;
        }

        $deskPath = '/rest/servicedeskapi/servicedesk/' . rawurlencode((string) config('support_jira.service_desk_id'));
        try {
            $desk = $this->client()->get($deskPath);
        } catch (\Throwable $e) {
            Log::error('[SupportJiraTicketService] connection check could not reach Jira', ['error' => $this->scrub($e->getMessage())]);

            return $result;
        }

        $result['service_desk']['status'] = $desk->status();
        if (!$desk->successful()) {
            return $result;
        }
        $result['service_desk'] = [
            'ok' => true,
            'status' => $desk->status(),
            'project_key' => is_string($desk->json('projectKey')) ? $desk->json('projectKey') : null,
            'name' => is_string($desk->json('projectName')) ? $desk->json('projectName') : null,
        ];

        $types = $this->client()->get($deskPath . '/requesttype', ['limit' => 100]);
        $available = [];
        if ($types->successful()) {
            foreach ((array) $types->json('values', []) as $type) {
                if (is_array($type) && isset($type['id'])) {
                    $available[(string) $type['id']] = is_string($type['name'] ?? null) ? $type['name'] : null;
                }
            }
        }

        $allFound = $types->successful();
        foreach ((array) config('support_jira.request_types', []) as $kind => $id) {
            $found = array_key_exists((string) $id, $available);
            $allFound = $allFound && $found;
            $result['request_types'][(string) $kind] = [
                'configured' => (string) $id,
                'found' => $found,
                'name' => $found ? $available[(string) $id] : null,
            ];
        }

        $result['ok'] = $allFound;

        return $result;
    }

    /**
     * Raises exactly one ticket marked TEST, through the same steps a real
     * report takes (create, priority + labels, internal JSON attachment), and
     * stores nothing on the platform. Ignores support_jira.enabled on purpose.
     * Never raised in a member's name.
     *
     * @return array{ok: bool, issue_key: string|null, issue_url: string|null, steps: list<array{step: string, ok: bool, detail: string|null}>}
     */
    public function createTestTicket(): array
    {
        $serviceDeskId = (string) config('support_jira.service_desk_id');
        $result = ['ok' => false, 'issue_key' => null, 'issue_url' => null, 'steps' => []];

        $description = implode("\n", [
            'This is a TEST ticket raised by the Project NEXUS platform to check its connection to this help desk.',
            'It is safe to close. No member is involved.',
            '',
            '----',
            'Raised by: php artisan support:jira-check --create-test-ticket',
            'At: ' . now()->toIso8601String(),
            'App version: ' . (string) config('app.version', 'unknown'),
        ]);

        try {
            $created = $this->client()->post('/rest/servicedeskapi/request', [
                'serviceDeskId' => $serviceDeskId,
                'requestTypeId' => (string) config('support_jira.request_types.broken'),
                'requestFieldValues' => [
                    'summary' => 'TEST - platform connection check, please ignore',
                    'description' => $description,
                ],
            ]);
        } catch (\Throwable $e) {
            $result['steps'][] = ['step' => 'create the ticket', 'ok' => false, 'detail' => $this->scrub($e->getMessage())];

            return $result;
        }

        $issueKey = $created->successful() ? (string) ($created->json('issueKey') ?? '') : '';
        if ($issueKey === '') {
            $detail = 'HTTP ' . $created->status();
            $jira = $this->jiraErrorDetail($created);
            $result['steps'][] = ['step' => 'create the ticket', 'ok' => false, 'detail' => $jira !== '' ? $detail . ': ' . $jira : $detail];

            return $result;
        }

        $result['issue_key'] = $issueKey;
        $result['issue_url'] = $this->issueUrl($issueKey);
        $result['steps'][] = ['step' => 'create the ticket', 'ok' => true, 'detail' => $issueKey];

        $edit = $this->editIssueFields($issueKey, [
            'labels' => ['nexus-in-app', 'nexus-test'],
            'priority' => ['name' => (string) config('support_jira.priorities.cosmetic', 'Low')],
        ]);
        $result['steps'][] = ['step' => 'set priority and labels', 'ok' => $edit === null, 'detail' => $edit];

        $attach = $this->attachJsonFile(
            $serviceDeskId,
            $issueKey,
            (string) json_encode(['test' => true, 'note' => 'Connection check; no member data.'], JSON_PRETTY_PRINT),
            'diagnostics-TEST.json',
        );
        $result['steps'][] = ['step' => 'attach a technical-details file', 'ok' => $attach === null, 'detail' => $attach];

        $result['ok'] = $edit === null && $attach === null;

        return $result;
    }

    public function issueUrl(?string $issueKey): ?string
    {
        // Always the site address: the API gateway serves no browser pages.
        $base = (string) config('support_jira.site_url', '');
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

    /**
     * @param User|null $member set ONLY when send_member_email is on; the
     *                          member's name and email are never sent otherwise
     */
    private function description(SupportReport $report, string $requestType, ?object $tenant, ?User $member = null): string
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

        if ($member !== null) {
            $memberName = trim((string) $member->name);
            if ($memberName !== '') {
                $lines[] = 'Member: ' . $memberName;
            }
            if (!empty($member->email)) {
                $lines[] = 'Member email: ' . $member->email;
            }
        }

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

        $error = $this->editIssueFields($issueKey, $fields);

        return $error === null ? null : $this->warn($report, 'set priority and labels', $error);
    }

    /**
     * Assigns the new ticket to support_jira.assignee_account_id (the person
     * who answers the help desk), so Jira emails them "assigned to you".
     * Returns a warning string on failure, null on success or when unset.
     */
    private function assignIssue(string $issueKey, SupportReport $report): ?string
    {
        $accountId = trim((string) config('support_jira.assignee_account_id', ''));
        if ($accountId === '') {
            return null;
        }

        try {
            $response = $this->client()->put('/rest/api/3/issue/' . rawurlencode($issueKey) . '/assignee', [
                'accountId' => $accountId,
            ]);
        } catch (\Throwable $e) {
            return $this->warn($report, 'assign the ticket', $e->getMessage());
        }

        return $response->successful() ? null : $this->warn($report, 'assign the ticket', 'HTTP ' . $response->status());
    }

    /**
     * Returns an error detail on failure, null on success.
     *
     * @param array<string, mixed> $fields
     */
    private function editIssueFields(string $issueKey, array $fields): ?string
    {
        try {
            $response = $this->client()->put('/rest/api/3/issue/' . rawurlencode($issueKey), ['fields' => $fields]);
        } catch (\Throwable $e) {
            return $this->scrub($e->getMessage());
        }

        return $response->successful() ? null : 'HTTP ' . $response->status();
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
        } catch (\Throwable $e) {
            return $this->warn($report, 'attach technical details', $e->getMessage());
        }

        $error = $this->attachJsonFile($serviceDeskId, $issueKey, $json, $this->diagnosticsFilename($report));

        return $error === null ? null : $this->warn($report, 'attach technical details', $error);
    }

    /**
     * Uploads a JSON file and attaches it to the request, internal to agents
     * (the member already has their own report). Returns an error detail on
     * failure, null on success.
     */
    private function attachJsonFile(string $serviceDeskId, string $issueKey, string $json, string $filename): ?string
    {
        try {
            $upload = $this->client(json: false)
                ->withHeaders(['X-Atlassian-Token' => 'no-check', 'X-ExperimentalApi' => 'opt-in'])
                ->attach('file', $json, $filename, ['Content-Type' => 'application/json'])
                ->post('/rest/servicedeskapi/servicedesk/' . rawurlencode($serviceDeskId) . '/attachTemporaryFile');
            if (!$upload->successful()) {
                return 'upload refused (HTTP ' . $upload->status() . ')';
            }

            $temporaryIds = array_values(array_filter(array_map(
                fn ($item) => is_array($item) ? ($item['temporaryAttachmentId'] ?? null) : null,
                (array) $upload->json('temporaryAttachments', []),
            )));
            if ($temporaryIds === []) {
                return 'no attachment id returned';
            }

            $attach = $this->client()->post('/rest/servicedeskapi/request/' . rawurlencode($issueKey) . '/attachment', [
                'temporaryAttachmentIds' => $temporaryIds,
                'public' => false,
            ]);
        } catch (\Throwable $e) {
            return $this->scrub($e->getMessage());
        }

        return $attach->successful() ? null : 'HTTP ' . $attach->status();
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
            // Already an Atlassian account. Look in this help desk's own
            // customers first (portal-only customers are not Jira users, so
            // the user search may not see them), then the user search.
            try {
                $inDesk = $this->client()->get(
                    '/rest/servicedeskapi/servicedesk/' . rawurlencode($serviceDeskId) . '/customer',
                    ['query' => $email, 'limit' => 1],
                );
                if ($inDesk->successful()) {
                    $accountId = (string) ($inDesk->json('values.0.accountId') ?? '');
                }
            } catch (\Throwable $e) {
                // Fall through to the user search below; the outcome is
                // still decided by whether an account id is found.
                Log::warning('[SupportJiraTicketService] help-desk customer lookup failed', ['error' => $this->scrub($e->getMessage())]);
            }
            if ($accountId === '') {
                $found = $this->client()->get('/rest/api/3/user/search', ['query' => $email]);
                if ($found->successful()) {
                    $accountId = (string) ($found->json('0.accountId') ?? '');
                }
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
        foreach (['site_url', 'service_desk_id', 'email', 'api_token'] as $key) {
            if (trim((string) config('support_jira.' . $key, '')) === '') {
                $missing[] = 'SUPPORT_JIRA_' . strtoupper($key);
            }
        }

        // The cloud id is built into a URL, so anything but a UUID is refused
        // outright rather than trusted.
        $cloudId = (string) config('support_jira.cloud_id', '');
        if ($cloudId !== '' && !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $cloudId)) {
            $missing[] = 'SUPPORT_JIRA_CLOUD_ID (not a valid cloud id)';
        }

        return $missing;
    }

    /**
     * A service-account (scoped) token only works through the Atlassian
     * platform gateway; a classic user token works on the site address.
     */
    private function apiBaseUrl(): string
    {
        $cloudId = (string) config('support_jira.cloud_id', '');

        return $cloudId !== ''
            ? 'https://api.atlassian.com/ex/jira/' . strtolower($cloudId)
            : (string) config('support_jira.site_url', '');
    }

    /**
     * @param bool $json false for the multipart attachment upload, which must
     *                   not carry a JSON Content-Type header
     */
    private function client(bool $json = true): PendingRequest
    {
        $client = Http::baseUrl($this->apiBaseUrl())
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
