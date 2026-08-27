// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

const BUNDLE_IDENTIFIER = 'ie.project.nexus';
const DEFAULT_OUTPUT = path.resolve(
  __dirname,
  '../../react-frontend/public/.well-known/apple-app-site-association',
);

// These flows have no safe native completion path. They must remain in the
// browser that started them even after Universal Links are enabled.
const BROWSER_ONLY_COMPONENTS = [
  '/admin/*',
  '/admin-legacy/*',
  '/broker/*',
  '/super-admin/*',
  '/auth/*',
  '/verify-identity/callback*',
];

function normalizeTeamId(value) {
  const teamId = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error('Apple Team ID must be exactly 10 uppercase letters or digits.');
  }
  return teamId;
}

function buildAssociation(teamIdInput) {
  const teamId = normalizeTeamId(teamIdInput);
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${BUNDLE_IDENTIFIER}`],
          components: [
            ...BROWSER_ONLY_COMPONENTS.map((pathname) => ({
              '/': pathname,
              exclude: true,
              comment: 'Keep this browser-owned or staff-only flow out of the native app.',
            })),
            {
              '/': '/*',
              comment: 'Open member-facing Project NEXUS links in Timebank Global.',
            },
          ],
        },
      ],
    },
  };
}

function validateAssociation(value, expectedTeamId) {
  const details = value?.applinks?.details;
  if (!Array.isArray(details) || details.length !== 1) {
    throw new Error('AASA must contain exactly one applinks.details entry.');
  }

  const appIDs = details[0]?.appIDs;
  if (!Array.isArray(appIDs) || appIDs.length !== 1) {
    throw new Error('AASA must contain exactly one appID.');
  }

  const [teamId, ...bundleParts] = String(appIDs[0]).split('.');
  normalizeTeamId(teamId);
  if (bundleParts.join('.') !== BUNDLE_IDENTIFIER) {
    throw new Error(`AASA bundle identifier must be ${BUNDLE_IDENTIFIER}.`);
  }
  if (expectedTeamId && teamId !== normalizeTeamId(expectedTeamId)) {
    throw new Error('AASA appID does not match the expected Apple Team ID.');
  }

  const components = details[0]?.components;
  if (!Array.isArray(components)) {
    throw new Error('AASA must define path components.');
  }
  for (const pathname of BROWSER_ONLY_COMPONENTS) {
    const exclusion = components.find((entry) => entry?.['/'] === pathname);
    if (exclusion?.exclude !== true) {
      throw new Error(`AASA must exclude ${pathname} from Universal Links.`);
    }
  }
  if (!components.some((entry) => entry?.['/'] === '/*' && entry?.exclude !== true)) {
    throw new Error('AASA must admit member-facing paths after its exclusions.');
  }

  return { teamId, appID: appIDs[0] };
}

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function run(args = process.argv.slice(2), env = process.env) {
  const output = path.resolve(readArgument(args, '--output') ?? DEFAULT_OUTPUT);
  const expectedTeamId = readArgument(args, '--team-id') ?? env.APPLE_TEAM_ID;

  if (args.includes('--check')) {
    if (!fs.existsSync(output)) {
      throw new Error(`AASA file is missing: ${output}`);
    }
    const result = validateAssociation(JSON.parse(fs.readFileSync(output, 'utf8')), expectedTeamId);
    console.log(`Apple association file is valid for ${result.appID}.`);
    return result;
  }

  const association = buildAssociation(expectedTeamId);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(association, null, 2)}\n`, 'utf8');
  const result = validateAssociation(association, expectedTeamId);
  console.log(`Wrote Apple association file for ${result.appID}: ${output}`);
  return result;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  BROWSER_ONLY_COMPONENTS,
  BUNDLE_IDENTIFIER,
  DEFAULT_OUTPUT,
  buildAssociation,
  normalizeTeamId,
  run,
  validateAssociation,
};
