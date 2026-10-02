<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\SupportJiraTicketService;
use Illuminate\Console\Command;

/**
 * Proves the Jira help-desk connection works while SUPPORT_JIRA_ENABLED is
 * still OFF, so the member-facing switch is only flipped once it is known to
 * work. Read-only by default; --create-test-ticket raises exactly one ticket
 * marked TEST and stores nothing on the platform.
 *
 * Run by hand, never scheduled, so it exits 1 when something is wrong. It
 * never prints the API token.
 */
class CheckSupportJiraConnection extends Command
{
    protected $signature = 'support:jira-check
        {--create-test-ticket : Also raise one ticket marked TEST in the help desk}';

    protected $description = 'Check the Jira help-desk connection (and optionally raise one TEST ticket), even while it is switched off';

    public function handle(SupportJiraTicketService $service): int
    {
        $this->line('Member-facing switch (SUPPORT_JIRA_ENABLED): ' . (SupportJiraTicketService::isEnabled() ? 'ON' : 'OFF'));

        $check = $service->checkConnection();

        if ($check['missing'] !== []) {
            $this->error('Settings missing or invalid: ' . implode(', ', $check['missing']));

            return self::FAILURE;
        }

        $this->line('Talking to: ' . $check['api_base']);

        $desk = $check['service_desk'];
        if (!$desk['ok']) {
            $this->error(match (true) {
                $desk['status'] === 401 => 'Jira refused the key (HTTP 401). Check SUPPORT_JIRA_EMAIL and SUPPORT_JIRA_API_TOKEN, and that the token has not expired.',
                $desk['status'] === 403 => 'The key works but is not allowed to see the help desk (HTTP 403). Check the token\'s scopes, and that the service account is an agent in the help desk.',
                $desk['status'] === 404 => 'The service account cannot see help desk ' . config('support_jira.service_desk_id') . ' (HTTP 404). Check SUPPORT_JIRA_SERVICE_DESK_ID, or add the service account to the help desk\'s agents.',
                $desk['status'] === null => 'Could not reach Jira at all (network or address problem). See the error log.',
                default => 'Jira answered HTTP ' . $desk['status'] . ' when asked for the help desk.',
            });

            return self::FAILURE;
        }

        $this->info('Help desk found: ' . ($desk['project_key'] ?? '?') . ' (' . ($desk['name'] ?? 'no name') . ')');

        $mismatches = array_filter($check['request_types'], fn (array $type) => !$type['found']);
        foreach ($check['request_types'] as $kind => $type) {
            $this->line(sprintf(
                '  %s → request type %s: %s',
                $kind,
                $type['configured'],
                $type['found'] ? 'found ("' . $type['name'] . '")' : 'NOT FOUND in the help desk',
            ));
        }

        if ($mismatches !== [] || !$check['ok']) {
            $this->error('Request types do not match the help desk. Fix SUPPORT_JIRA_REQUEST_TYPE_* before switching on.');

            return self::FAILURE;
        }

        $this->info('All four request types match.');

        if (!$this->option('create-test-ticket')) {
            $this->line('Read-only check passed. Nothing was created. Add --create-test-ticket to raise one TEST ticket.');

            return self::SUCCESS;
        }

        $ticket = $service->createTestTicket();
        foreach ($ticket['steps'] as $step) {
            $this->line(sprintf('  %s %s%s', $step['ok'] ? 'OK  ' : 'FAIL', $step['step'], $step['detail'] ? ' — ' . $step['detail'] : ''));
        }

        if ($ticket['issue_key'] === null) {
            $this->error('No test ticket was created.');

            return self::FAILURE;
        }

        $this->info('Test ticket ' . $ticket['issue_key'] . ' created: ' . ($ticket['issue_url'] ?? ''));
        if (!$ticket['ok']) {
            $this->warn('The ticket exists, but a follow-up step failed (see above). Real reports would still be saved and ticketed.');

            return self::FAILURE;
        }

        $this->info('Everything works. You can close the test ticket in Jira.');

        return self::SUCCESS;
    }
}
