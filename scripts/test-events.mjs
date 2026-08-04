// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const rawArguments = process.argv.slice(2);
const phpBatchArgument = rawArguments.find((argument) => argument.startsWith('--php-batch='));
const phpBatch = phpBatchArgument?.slice('--php-batch='.length) ?? null;
const phpFilterArgument = rawArguments.find((argument) => argument.startsWith('--php-filter='));
const phpFilter = phpFilterArgument?.slice('--php-filter='.length) ?? null;
const selection = new Set(rawArguments.filter(
  (argument) => argument !== phpBatchArgument && argument !== phpFilterArgument,
));
const only = selection.size === 0
  ? (phpBatch === null ? null : new Set(['--php-only']))
  : selection;
const shouldRun = (name) => only === null || only.has(`--${name}-only`);

function npmInvocation(args) {
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]];
  }

  return ['npm', args];
}

function run(label, command, args, options = {}) {
  process.stdout.write(`\n[events] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    input: options.input,
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

function collectPhpTests(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('Test.php'))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name).replaceAll('\\', '/'))
    .sort();
}

function assertPathsExist(paths, label) {
  const missing = paths.filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required test paths:\n${missing.join('\n')}`);
  }
}

function prepareIsolatedTestDatabase(database) {
  if (!/^nexus_test_events_[0-9]+(?:_[0-9]+)?$/.test(database)) {
    throw new Error('Refusing to prepare an unexpected Events test database name.');
  }

  const quotedDatabase = '\\`' + database + '\\`';
  const createCommand = `mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS ${quotedDatabase}; CREATE DATABASE ${quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON ${quotedDatabase}.* TO '$MARIADB_USER'@'%'; FLUSH PRIVILEGES"`;
  runChecked('docker', ['exec', 'nexus-php-db', 'sh', '-lc', createCommand]);

  const schema = readFileSync(join(process.cwd(), 'database/schema/mysql-schema.sql'));
  const importCommand = `mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" ${database}`;
  runChecked('docker', ['exec', '-i', 'nexus-php-db', 'sh', '-lc', importCommand], { input: schema });

  // The checked-in schema is a fast baseline, not a substitute for pending
  // expand migrations added by the current worktree. Applying the migration
  // tail keeps focused Events tests honest for new outbox/calendar tables.
  runChecked('docker', [
    'exec',
    '-e', 'APP_ENV=testing',
    '-e', 'APP_KEY=base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=',
    '-e', `DB_NAME=${database}`,
    '-e', `DB_DATABASE=${database}`,
    'nexus-php-app',
    'php',
    'artisan',
    'migrate',
    '--force',
    '--no-interaction',
  ]);
}

function cleanupIsolatedTestDatabase(database) {
  if (!/^nexus_test_events_[0-9]+(?:_[0-9]+)?$/.test(database)) {
    return;
  }

  const quotedDatabase = '\\`' + database + '\\`';
  const cleanupCommand = `mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS ${quotedDatabase}; REVOKE ALL PRIVILEGES ON ${quotedDatabase}.* FROM '$MARIADB_USER'@'%'; FLUSH PRIVILEGES"`;
  const result = spawnSync('docker', ['exec', 'nexus-php-db', 'sh', '-lc', cleanupCommand], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    process.stderr.write(`[events] Warning: could not remove isolated test database ${database}.\n`);
  }
}

let activeIsolatedDatabase = null;
let cleaningIsolatedDatabase = false;

function cleanupActiveIsolatedDatabase() {
  if (activeIsolatedDatabase === null || cleaningIsolatedDatabase) {
    return;
  }

  const database = activeIsolatedDatabase;
  activeIsolatedDatabase = null;
  cleaningIsolatedDatabase = true;
  try {
    cleanupIsolatedTestDatabase(database);
  } finally {
    cleaningIsolatedDatabase = false;
  }
}

process.on('exit', cleanupActiveIsolatedDatabase);
for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.once(signal, () => {
    cleanupActiveIsolatedDatabase();
    process.exit(exitCode);
  });
}

const phpBatches = [
  'core',
  'core-a',
  'core-b',
  'core-1',
  'core-2',
  'core-3',
  'core-4',
  'contract',
  'lifecycle',
  'notifications',
  'outbox',
  'health',
  'registration',
  'people',
  'staff',
  'calendar',
  'agenda',
  'reminders',
  'federation',
  'offline',
  'forms',
  'ticketing',
  'templates',
  'analytics',
  'safety',
  'broadcasts',
  'performance',
  'migrations',
];

if (only && ![...only].every((arg) => ['--php-only', '--react-only', '--mobile-only'].includes(arg))) {
  process.stderr.write(`Usage: node scripts/test-events.mjs [--php-only|--react-only|--mobile-only] [--php-batch=${phpBatches.join('|')}] [--php-filter=pattern]\n`);
  process.exit(2);
}
if (phpBatch !== null && !phpBatches.includes(phpBatch)) {
  process.stderr.write(`Unknown Events PHP batch. Expected one of: ${phpBatches.join(', ')}.\n`);
  process.exit(2);
}
if (phpBatch !== null && only !== null && !only.has('--php-only')) {
  process.stderr.write('--php-batch may only be combined with --php-only.\n');
  process.exit(2);
}
if (phpFilter !== null && (phpFilter.trim() === '' || only === null || !only.has('--php-only'))) {
  process.stderr.write('--php-filter requires --php-only and a non-empty PHPUnit filter.\n');
  process.exit(2);
}

if (shouldRun('php')) {
  const explicitPhpTests = [
    'tests/Laravel/Feature/Controllers/EventsControllerTest.php',
    'tests/Laravel/Feature/Controllers/AdminEventsControllerTest.php',
    'tests/Laravel/Feature/GovukAlpha/EventsParityTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventCanonicalMutationTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventOperationsTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventModerationTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventRegistrationProductTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventAgendaTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventAnalyticsTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventLifecycleHistoryTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventSafetyTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventTemplatesTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventTicketsTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventTimeIdentityTest.php',
    'tests/Laravel/Feature/GovukAlpha/AccessibleEventVenueAccessibilityTest.php',
    'tests/Laravel/Integration/EventNotificationStateTest.php',
    'tests/Laravel/Integration/EventEmailReliabilityTest.php',
    'tests/Laravel/Integration/EventNotificationProducerLocaleTest.php',
    'tests/Laravel/Unit/Listeners/NotifyAdminOfNewCommunityEventTest.php',
    'tests/Laravel/Unit/Listeners/HandleFederatedCommunityEventReceivedTest.php',
    'tests/Laravel/Unit/Listeners/PushCommunityEventToFederatedPartnersTest.php',
    'tests/Laravel/Unit/Observers/EventObserverTest.php',
    'tests/Laravel/Unit/Observers/EventPrerenderObserverTest.php',
    'tests/Laravel/Unit/Providers/EventServiceProviderTest.php',
    'tests/Laravel/Unit/Services/EventCategoryResolutionTest.php',
    'tests/Laravel/Unit/Services/EventCheckinCredentialSignerTest.php',
    'tests/Laravel/Unit/Services/EventFederationPayloadBuilderTest.php',
    'tests/Laravel/Unit/Enums/EventBroadcastEnumsTest.php',
    'tests/Laravel/Unit/Http/Resources/EventBroadcastResourceTest.php',
    'tests/Laravel/Unit/Http/Resources/EventAnalyticsResourceTest.php',
    'tests/Laravel/Unit/Services/AccessibleEventCommunicationsStaticTest.php',
    'tests/Laravel/Unit/Services/EventAgendaEnterpriseStaticTest.php',
    'tests/Laravel/Unit/Services/EventMigrationChainSafetyStaticTest.php',
    'tests/Laravel/Unit/Services/EventAccessibilityDiscoveryStaticTest.php',
    'tests/Laravel/Unit/Services/EventBroadcastPhaseBStaticTest.php',
    'tests/Laravel/Unit/Services/EventGuardianConsentStatusNotificationStaticTest.php',
    'tests/Laravel/Unit/Services/EventFederationPhaseBStaticTest.php',
    'tests/Laravel/Unit/Services/EventNotificationEnterpriseStaticTest.php',
    'tests/Laravel/Unit/Services/EventOfflineCheckinAccessibleStaticTest.php',
    'tests/Laravel/Unit/Services/EventRegistrationSettingsOutboxContractTest.php',
    'tests/Laravel/Unit/Services/EventNotificationServiceTest.php',
    'tests/Laravel/Unit/Services/EventReminderServiceTest.php',
    'tests/Laravel/Unit/Services/EventServiceTest.php',
    'tests/Laravel/Unit/Services/EventRecurrenceServiceTest.php',
    'tests/Laravel/Unit/Services/EventRecurrenceCapabilityServiceTest.php',
    'tests/Laravel/Unit/Services/NotificationServiceTest.php',
    'tests/Laravel/Unit/Helpers/IcsHelperTest.php',
    'tests/Laravel/Unit/Helpers/IcsEnterpriseContractTest.php',
    'tests/Laravel/Unit/Middleware/RedactEventCalendarFeedSecretTest.php',
    'tests/Laravel/Unit/Models/EventTimeIdentityModelTest.php',
    'tests/Laravel/Unit/Models/EventLifecycleModelTest.php',
    'tests/Laravel/Unit/Models/EventTest.php',
    'tests/Laravel/Unit/Models/EventRsvpTest.php',
    'tests/Laravel/Unit/Enums/EventContractEnumsTest.php',
    'tests/Laravel/Unit/Enums/EventStaffRoleTest.php',
    'tests/Laravel/Unit/Enums/EventLifecycleEnumsTest.php',
    'tests/Laravel/Unit/Support/EventContractMapperPermissionsTest.php',
    'tests/Laravel/Unit/Support/EventRegistrationFormRuleSetTest.php',
    'tests/Laravel/Unit/Support/EventSessionContractMapperTest.php',
    'tests/Laravel/Unit/Support/EventAnalyticsCsvTest.php',
    'tests/Laravel/Unit/Support/EventSafetyContractMapperTest.php',
    'tests/Laravel/Unit/Services/AI/Tools/SearchEventsToolTest.php',
    // Settings persistence is a cross-module controller, but Events email
    // preference changes must stay covered by the focused Events gate.
    'tests/Laravel/Feature/Controllers/MemberSelfServiceTest.php',
    'tests/Laravel/Feature/Controllers/NotificationsControllerTest.php',
    // Retained explicit entries make the intended containment boundary clear
    // even if the Feature/Events collector is narrowed in the future.
    'tests/Laravel/Feature/Events/EventFeatureBoundaryTest.php',
    'tests/Laravel/Feature/Events/EventCheckInIdempotencyTest.php',
    'tests/Laravel/Feature/Events/EventGamificationIdempotencyTest.php',
    'tests/Laravel/Feature/Events/EventMutationSafetyTest.php',
    'tests/Laravel/Feature/Events/EventIntegrityAuditTest.php',
    'tests/Laravel/Feature/Events/EventOutboxFoundationTest.php',
    'tests/Laravel/Feature/Events/EventNotificationOutboxProcessorTest.php',
    'tests/Laravel/Feature/Events/EventNotificationPreferenceComplianceTest.php',
  ];
  assertPathsExist(explicitPhpTests, 'Events PHP harness');
  let candidates = [
    ...collectPhpTests('tests/Laravel/Feature/Events'),
    ...explicitPhpTests,
  ].filter((path, index, all) => all.indexOf(path) === index);

  if (phpBatch === 'performance') {
    candidates = [
      'tests/Performance/Events/EventPeopleRosterPerformanceTest.php',
    ];
    assertPathsExist(candidates, 'Events performance harness');
  } else if (phpBatch === 'migrations') {
    candidates = candidates.filter((path) => /MigrationTest\.php$/.test(path));
  } else if (phpBatch === 'calendar') {
    const calendarTests = new Set([
      'tests/Laravel/Feature/Events/EventCalendarIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventCalendarFeedTokenConcurrencyTest.php',
      'tests/Laravel/Feature/Events/EventIntegrityAuditTest.php',
      'tests/Laravel/Feature/Events/EventPolicyIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventPolicyTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceDefinitionBlueprintIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceCapabilityControllerTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceMaterializationTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceV2IntegrationTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceRevisionIntegrationTest.php',
      'tests/Laravel/Feature/GovukAlpha/EventsParityTest.php',
      'tests/Laravel/Feature/GovukAlpha/GovukAlphaCsrfMiddlewareTest.php',
      'tests/Laravel/Unit/Helpers/IcsHelperTest.php',
      'tests/Laravel/Unit/Helpers/IcsEnterpriseContractTest.php',
      'tests/Laravel/Unit/Middleware/RedactEventCalendarFeedSecretTest.php',
      'tests/Laravel/Unit/Middleware/SecurityHeadersTest.php',
      'tests/Laravel/Unit/Services/EventRecurrenceServiceTest.php',
      'tests/Laravel/Unit/Services/EventRecurrenceCapabilityServiceTest.php',
    ]);
    candidates = candidates.filter((path) => calendarTests.has(path));
  } else if (phpBatch === 'agenda') {
    candidates = candidates.filter((path) => (
      /EventAgenda/.test(path)
      || /EventSession/.test(path)
      || /EventContractMapperPermissionsTest/.test(path)
    ));
  } else if (phpBatch === 'reminders') {
    candidates = candidates.filter((path) => (
      /EventReminder/.test(path)
      || /EventNotificationPreferenceComplianceTest/.test(path)
      || /EventNotificationProducerLocaleTest/.test(path)
    ));
  } else if (phpBatch === 'federation') {
    candidates = candidates.filter((path) => (
      /Events\/Federation\//.test(path)
      || /EventFederation/.test(path)
      || /PushCommunityEventToFederatedPartners/.test(path)
    ));
  } else if (phpBatch === 'offline') {
    candidates = candidates.filter((path) => (
      /EventOffline/.test(path)
      || /EventCheckin(Credential|Device|Manifest)/.test(path)
    ));
  } else if (phpBatch === 'forms') {
    candidates = candidates.filter((path) => (
      /EventRegistrationForms/.test(path)
      || /EventRegistration(SettingsAndForm|Submission|GuestAndRetention|PhaseB|SettingsOutbox)/.test(path)
      || /EventRegistrationFormRuleSet/.test(path)
      || /EventInvitation/.test(path)
      || /AccessibleEventRegistration/.test(path)
    ));
  } else if (phpBatch === 'ticketing') {
    candidates = candidates.filter((path) => /EventTicket|EventTimeCreditTicket/.test(path));
  } else if (phpBatch === 'templates') {
    candidates = candidates.filter((path) => /EventTemplate/.test(path));
  } else if (phpBatch === 'analytics') {
    candidates = candidates.filter((path) => /EventAnalytics/.test(path));
  } else if (phpBatch === 'safety') {
    candidates = candidates.filter((path) => /EventSafety|EventParticipation/.test(path));
  } else if (phpBatch === 'broadcasts') {
    candidates = candidates.filter((path) => (
      /EventBroadcast/.test(path)
      || /EventGuardianConsentStatusNotification/.test(path)
      || /EventNotificationEnterpriseStaticTest/.test(path)
      || /AccessibleEventCommunications/.test(path)
    ));
  } else if (phpBatch === 'contract') {
    const contractTests = new Set([
      'tests/Laravel/Feature/Events/EventCanonicalContractTest.php',
      'tests/Laravel/Feature/Events/EventDiscoveryContractTest.php',
      'tests/Laravel/Feature/Events/EventFeatureBoundaryTest.php',
      'tests/Laravel/Feature/Events/EventOpenApiCoverageTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceCapabilityControllerTest.php',
      'tests/Laravel/Feature/Events/EventPolicyIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventPolicyTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceDefinitionBlueprintMigrationTest.php',
      'tests/Laravel/Feature/Events/EventRecurrenceOverrideMigrationTest.php',
      'tests/Laravel/Feature/Events/EventTimeIdentityIntegrityTest.php',
      'tests/Laravel/Feature/Events/EventVenueAccessibilityMigrationTest.php',
      'tests/Laravel/Feature/Events/EventWriterContractTest.php',
      'tests/Laravel/Feature/GovukAlpha/AccessibleEventTimeIdentityTest.php',
      'tests/Laravel/Feature/GovukAlpha/AccessibleEventVenueAccessibilityTest.php',
      'tests/Laravel/Unit/Services/EventMigrationChainSafetyStaticTest.php',
      'tests/Laravel/Unit/Services/EventRecurrenceCapabilityServiceTest.php',
      'tests/Laravel/Unit/Support/EventContractMapperPermissionsTest.php',
    ]);
    candidates = candidates.filter((path) => contractTests.has(path));
  } else if (phpBatch === 'lifecycle') {
    const lifecycleTests = new Set([
      'tests/Laravel/Feature/Controllers/AdminEventsControllerTest.php',
      'tests/Laravel/Feature/Events/EventLifecycleCompatibilityIntegrationTest.php',
      'tests/Laravel/Feature/GovukAlpha/EventsParityTest.php',
    ]);
    candidates = candidates.filter((path) => lifecycleTests.has(path));
  } else if (phpBatch === 'outbox') {
    const outboxTests = new Set([
      'tests/Laravel/Feature/Events/EventOutboxFoundationTest.php',
      'tests/Laravel/Feature/Events/EventNotificationOutboxProcessorTest.php',
      'tests/Laravel/Integration/EventNotificationStateTest.php',
    ]);
    candidates = candidates.filter((path) => outboxTests.has(path));
  } else if (phpBatch === 'health') {
    const healthTests = new Set([
      'tests/Laravel/Feature/Events/EventHealthCommandTest.php',
      'tests/Laravel/Feature/Events/EventIntegrityAuditTest.php',
      'tests/Laravel/Feature/Events/EventNotificationOutboxProcessorTest.php',
    ]);
    candidates = candidates.filter((path) => healthTests.has(path));
  } else if (phpBatch === 'staff') {
    const staffTests = new Set([
      'tests/Laravel/Feature/Events/EventFeatureBoundaryTest.php',
      'tests/Laravel/Feature/Events/EventPolicyIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventPolicyTest.php',
      'tests/Laravel/Feature/Events/EventRoleMigrationTest.php',
      'tests/Laravel/Feature/Events/EventRoleRollbackSafetyTest.php',
      'tests/Laravel/Feature/Events/EventRoleServiceTest.php',
      'tests/Laravel/Feature/Events/EventStaffControllerTest.php',
      'tests/Laravel/Feature/Events/EventStaffRoleConcurrencyTest.php',
      'tests/Laravel/Unit/Enums/EventStaffRoleTest.php',
      'tests/Laravel/Unit/Support/EventContractMapperPermissionsTest.php',
    ]);
    candidates = candidates.filter((path) => staffTests.has(path));
  } else if (phpBatch === 'registration') {
    const registrationTests = new Set([
      'tests/Laravel/Feature/Controllers/EventsControllerTest.php',
      'tests/Laravel/Feature/Events/EventAttendanceApiIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventAttendanceServiceTest.php',
      'tests/Laravel/Feature/Events/EventIntegrityAuditTest.php',
      'tests/Laravel/Feature/Events/EventLegacyRegistrationCanonicalParityTest.php',
      'tests/Laravel/Feature/Events/EventLifecycleServiceTest.php',
      'tests/Laravel/Feature/Events/EventParticipationEligibilityTest.php',
      'tests/Laravel/Feature/Events/EventPeoplePaginationTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationConcurrencyTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationControllerTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationIntegrityAuditTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationServiceTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationWaitlistMigrationTest.php',
      'tests/Laravel/Feature/Events/EventWaitlistOfferEnvelopeMigrationTest.php',
      'tests/Laravel/Feature/Events/EventWaitlistOfferEnvelopeServiceTest.php',
      'tests/Laravel/Feature/Events/EventWaitlistServiceTest.php',
      'tests/Laravel/Feature/Events/ExpireEventWaitlistOffersCommandTest.php',
      'tests/Laravel/Feature/GovukAlpha/AccessibleEventCanonicalMutationTest.php',
    ]);
    candidates = candidates.filter((path) => registrationTests.has(path));
  } else if (phpBatch === 'people') {
    const peopleTests = new Set([
      'tests/Laravel/Feature/Events/EventAttendanceApiIntegrationTest.php',
      'tests/Laravel/Feature/Events/EventAttendanceServiceTest.php',
      'tests/Laravel/Feature/Events/EventCanonicalContractTest.php',
      'tests/Laravel/Feature/Events/EventCheckInIdempotencyTest.php',
      'tests/Laravel/Feature/Events/EventPeopleOperationsServiceTest.php',
      'tests/Laravel/Feature/Events/EventPeopleOperationsApiTest.php',
      'tests/Laravel/Feature/Events/EventPeoplePaginationTest.php',
      'tests/Laravel/Feature/GovukAlpha/AccessibleEventOperationsTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationConcurrencyTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationControllerTest.php',
      'tests/Laravel/Feature/Events/EventRegistrationServiceTest.php',
    ]);
    candidates = candidates.filter((path) => peopleTests.has(path));
  } else if (phpBatch === 'notifications') {
    const notificationTests = new Set([
      'tests/Laravel/Feature/Events/EventNotificationPreferenceComplianceTest.php',
      'tests/Laravel/Feature/Events/EventNotificationOutboxProcessorTest.php',
      'tests/Laravel/Feature/Events/EventOutboxFoundationTest.php',
      'tests/Laravel/Feature/Events/EventReminderSuppressedRecipientTest.php',
      'tests/Laravel/Integration/EventNotificationStateTest.php',
      'tests/Laravel/Integration/EventEmailReliabilityTest.php',
      'tests/Laravel/Integration/EventNotificationProducerLocaleTest.php',
      'tests/Laravel/Unit/Listeners/NotifyAdminOfNewCommunityEventTest.php',
      'tests/Laravel/Unit/Services/EventNotificationEnterpriseStaticTest.php',
      'tests/Laravel/Unit/Services/EventNotificationServiceTest.php',
      'tests/Laravel/Unit/Services/EventReminderServiceTest.php',
      'tests/Laravel/Unit/Services/NotificationServiceTest.php',
      'tests/Laravel/Feature/Controllers/MemberSelfServiceTest.php',
      'tests/Laravel/Feature/Controllers/NotificationsControllerTest.php',
    ]);
    candidates = candidates.filter((path) => notificationTests.has(path));
  } else if (phpBatch === 'core'
    || phpBatch === 'core-a'
    || phpBatch === 'core-b'
    || /^core-[1-4]$/.test(phpBatch)) {
    const notificationTests = new Set([
      'tests/Laravel/Feature/Events/EventNotificationPreferenceComplianceTest.php',
      'tests/Laravel/Feature/Events/EventNotificationOutboxProcessorTest.php',
      'tests/Laravel/Feature/Events/EventOutboxFoundationTest.php',
      'tests/Laravel/Feature/Events/EventReminderSuppressedRecipientTest.php',
      'tests/Laravel/Integration/EventNotificationStateTest.php',
      'tests/Laravel/Integration/EventEmailReliabilityTest.php',
      'tests/Laravel/Integration/EventNotificationProducerLocaleTest.php',
      'tests/Laravel/Unit/Listeners/NotifyAdminOfNewCommunityEventTest.php',
      'tests/Laravel/Unit/Services/EventNotificationEnterpriseStaticTest.php',
      'tests/Laravel/Unit/Services/EventNotificationServiceTest.php',
      'tests/Laravel/Unit/Services/EventReminderServiceTest.php',
      'tests/Laravel/Unit/Services/NotificationServiceTest.php',
      'tests/Laravel/Feature/Controllers/MemberSelfServiceTest.php',
      'tests/Laravel/Feature/Controllers/NotificationsControllerTest.php',
    ]);
    candidates = candidates.filter((path) => !notificationTests.has(path));
    if (phpBatch === 'core-a' || phpBatch === 'core-b') {
      // The complete residual core regularly exceeds CI/agent command limits.
      // Split its already-sorted path list at one stable midpoint so the two
      // isolated shards preserve exactly the same coverage as `core`.
      const midpoint = Math.ceil(candidates.length / 2);
      candidates = phpBatch === 'core-a'
        ? candidates.slice(0, midpoint)
        : candidates.slice(midpoint);
    } else if (/^core-[1-4]$/.test(phpBatch)) {
      // Quarter shards are the bounded CI form of the same residual list.
      const shardNumber = Number.parseInt(phpBatch.slice('core-'.length), 10);
      const shardSize = Math.ceil(candidates.length / 4);
      const start = (shardNumber - 1) * shardSize;
      candidates = candidates.slice(start, Math.min(start + shardSize, candidates.length));
    }
  }

  // Schema round-trip tests mutate global indexes, constraints and triggers.
  // MariaDB can rebind an earlier foreign key to a later equivalent index when
  // those tests share one database, making later rollback checks order-dependent.
  // The migrations batch below runs every such file in its own fresh database.
  if (phpBatch !== null && phpBatch !== 'migrations') {
    candidates = candidates.filter((path) => !/MigrationTest\.php$/.test(path));
  }

  const appDocker = spawnSync(
    'docker',
    ['inspect', '-f', '{{.State.Running}}', 'nexus-php-app'],
    { encoding: 'utf8' },
  );
  const databaseDocker = spawnSync(
    'docker',
    ['inspect', '-f', '{{.State.Running}}', 'nexus-php-db'],
    { encoding: 'utf8' },
  );
  if (appDocker.status === 0 && appDocker.stdout.trim() === 'true'
    && databaseDocker.status === 0 && databaseDocker.stdout.trim() === 'true') {
    const testSets = phpBatch === 'migrations'
      ? candidates.map((path) => [path])
      : [candidates];
    for (const [setIndex, testSet] of testSets.entries()) {
      const suffix = testSets.length === 1 ? '' : `_${setIndex + 1}`;
      const database = `nexus_test_events_${process.pid}${suffix}`;
      const setLabel = testSets.length === 1
        ? ''
        : ` (${setIndex + 1}/${testSets.length}: ${testSet[0]})`;
      process.stdout.write(
        `\n[events] Laravel Events tests${setLabel} (isolated database ${database})\n`,
      );

      let result;
      activeIsolatedDatabase = database;
      try {
        prepareIsolatedTestDatabase(database);
        result = spawnSync('docker', [
        'exec',
        '-e', 'APP_ENV=testing',
        '-e', 'APP_KEY=base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=',
        '-e', `DB_NAME=${database}`,
        '-e', `DB_DATABASE=${database}`,
        '-e', 'CACHE_DRIVER=array',
        '-e', 'SESSION_DRIVER=array',
        '-e', 'QUEUE_CONNECTION=sync',
        '-e', 'MAIL_DRIVER=array',
        '-e', 'MAIL_MAILER=array',
        '-e', 'LOG_CHANNEL=null',
        '-e', 'BROADCAST_CONNECTION=null',
        'nexus-php-app',
        'php',
        'vendor/bin/phpunit',
        '--no-configuration',
        '--bootstrap', 'tests/bootstrap.php',
        '--no-coverage',
        '--colors=always',
        '--fail-on-warning',
        '--fail-on-risky',
        '--fail-on-incomplete',
        '--fail-on-skipped',
        '--fail-on-empty-test-suite',
        '--display-incomplete',
        '--display-skipped',
        ...(phpFilter === null ? [] : ['--filter', phpFilter]),
          ...testSet,
        ], { cwd: process.cwd(), stdio: 'inherit' });
      } finally {
        cleanupActiveIsolatedDatabase();
      }

      if (result?.error) {
        throw result.error;
      }
      if (result?.status !== 0) {
        process.exit(result?.status ?? 1);
      }
    }
  } else {
    process.stderr.write(
      '[events] Refusing to run PHP Events tests without both nexus-php-app and nexus-php-db. '
      + 'The harness requires an isolated disposable database and will not fall back to host PHP.\n',
    );
    process.exit(2);
  }
}

if (shouldRun('react')) {
  const reactTests = [
    'src/pages/events',
    'src/lib/events-api.test.ts',
    'src/lib/event-analytics-api.test.ts',
    'src/lib/event-communications-api.test.ts',
    'src/lib/event-offline-checkin-store.test.ts',
    'src/lib/event-registration-api.test.ts',
    'src/lib/event-registration-form-rules.test.ts',
    'src/lib/event-safety-api.test.ts',
    'src/lib/event-templates-api.test.ts',
    'src/lib/event-tickets-api.test.ts',
    'src/lib/eventLocalDateTime.test.ts',
    'src/App.route-gates.test.tsx',
    'src/admin/modules/events/EventsAdmin.test.tsx',
    'src/components/compose/tabs/EventTab.test.tsx',
  ];
  // Concurrency is deliberately NOT pinned here. react-frontend/vitest.config.ts
  // owns it and already distinguishes the two environments: CI keeps the old
  // serial behaviour (maxForks 2, fileParallelism false) while a developer
  // workstation scales to half its logical cores. Re-adding --maxWorkers=1 /
  // --no-file-parallelism here would override that and silently reimpose the
  // serial run everywhere. Set NEXUS_VITEST_MAX_FORKS=1 to force serial for a
  // one-off debugging run instead.
  const [npmCommand, npmArgs] = npmInvocation([
    '--prefix', 'react-frontend', 'run', 'test', '--',
    '--run',
    ...reactTests,
  ]);
  run(
    'React Events tests',
    npmCommand,
    npmArgs,
    { env: { NEXUS_FAIL_ON_UNEXPECTED_CONSOLE: '1' } },
  );
}

if (shouldRun('mobile')) {
  const [npmCommand, npmArgs] = npmInvocation([
    '--prefix', 'mobile', 'test', '--',
    '--runInBand',
    '--runTestsByPath',
    'app/(tabs)/events.test.tsx',
    'app/(modals)/event-detail.test.tsx',
    'app/(modals)/event-attendance.test.tsx',
    'app/(modals)/event-communications.test.tsx',
    'app/(modals)/event-recurrence-blueprints.test.tsx',
    'app/(modals)/event-templates.test.tsx',
    'app/(modals)/event-tickets.test.tsx',
    'app/(modals)/federation-groups-events.test.tsx',
    'app/(modals)/new-event.test.tsx',
    'components/events/EventAgendaEnterprisePanel.test.tsx',
    'components/events/EventAnalyticsCard.test.tsx',
    'components/events/EventCheckinCredentialCard.test.tsx',
    'components/events/EventRegistrationPanel.test.tsx',
    'components/events/EventSafetyCard.test.tsx',
    'lib/api/client.test.ts',
    'lib/api/eventAnalytics.test.ts',
    'lib/api/eventCommunications.test.ts',
    'lib/api/eventOfflineCheckin.test.ts',
    'lib/api/eventRegistration.test.ts',
    'lib/api/eventSafety.test.ts',
    'lib/api/eventTemplates.test.ts',
    'lib/api/eventTickets.test.ts',
    'lib/api/events.test.ts',
    'lib/eventOfflineCheckinStore.test.ts',
    'lib/events/eventRegistrationFormRules.test.ts',
    'lib/utils/eventDateTime.test.ts',
    'locales/event-communications-content.test.ts',
    'locales/event-recurrence-blueprints-content.test.ts',
    'locales/event-templates-content.test.ts',
    'locales/event-tickets-content.test.ts',
    'locales/events-content.test.ts',
  ]);
  run('Native mobile Events tests', npmCommand, npmArgs);
}

process.stdout.write('\n[events] All selected Events gates passed.\n');
