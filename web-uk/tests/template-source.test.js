const fs = require('fs');
const path = require('path');

function nunjucksFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return nunjucksFilesUnder(entryPath);
    return entry.isFile() && entry.name.endsWith('.njk') ? [entryPath] : [];
  });
}

describe('read-only member rating accessibility', () => {
  it('keeps Blade rating tags paired with assistive copy', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'members', 'profile.njk'),
      'utf8'
    );
    expect(template).not.toContain('app-star-display');
    expect(template).toContain('class="govuk-tag govuk-tag--blue">{{ t("ux.rating_out_of"');
    expect(template).toContain('class="govuk-visually-hidden">{{ t("polish_members.rating_accessible"');
  });
});

describe('tenant-aware template helper conversion', () => {
  it('keeps event detail local links and forms behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'events', 'detail.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href=['"]\/(?:events|groups|members)\//);
    expect(template).not.toMatch(/action=['"]\/events\//);
    expect(template).not.toContain('href: "/events/"');
    expect(template).toContain('urlFor(');
    expect(template).toContain('t("events.detail_title")');
    expect(template).toContain('t("events.description_title")');
    expect(template).toContain('t("events.summary_title")');
    expect(template).toContain('t("events.starts")');
    expect(template).toContain('t("events.attendees_label")');
    expect(template).toContain('t("events.interested_label")');
    expect(template).not.toContain('About this event');
    expect(template).not.toContain('key: { text: "Group" }');
  });

  it('keeps event index and form controls behind urlFor()', () => {
    const templates = [
      path.join('events', 'index.njk'),
      path.join('events', 'new.njk'),
      path.join('events', 'edit.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:events|groups)/);
      expect(template).not.toMatch(/action="\/events/);
      expect(template).not.toContain('href: "/events');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/events/);
    expect(source).not.toMatch(/urlFor\(["']\/groups/);

    const index = templates[0];
    expect(index).toContain('t("events.caption", { community: tenantName or serviceName })');
    expect(index).toContain('t("events.description")');
    expect(index).toContain('t("events.filters_title")');
    expect(index).toContain('name="category_id"');
    expect(index).toContain('name="near"');
    expect(index).toContain('tc("events.result_count"');
    expect(index).toContain('class="nexus-alpha-card-list"');
    expect(index).not.toContain('govukTag');
    expect(index).not.toContain('name="group_id"');
  });

  it('keeps core event forms on the Laravel datetime and cancellation contracts', () => {
    const createTemplate = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'events', 'new.njk'),
      'utf8'
    );
    const editTemplate = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'events', 'edit.njk'),
      'utf8'
    );
    const detailTemplate = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'events', 'detail.njk'),
      'utf8'
    );
    const formSource = `${createTemplate}\n${editTemplate}`;

    expect(formSource).toContain('name: "start_time"');
    expect(formSource).toContain('name: "end_time"');
    expect(formSource).not.toMatch(/name(?:=|:)\s*"(?:starts_at|ends_at)_(?:date|time)"/);
    expect(formSource).toMatch(/id: "description"[\s\S]*?"required": "required"/);
    expect(createTemplate).toContain('t("events.caption", { community: tenantName or serviceName })');
    expect(createTemplate).toContain('t("events.create_description")');
    expect(createTemplate).toContain('t("events.create_details_title")');
    expect(createTemplate).toContain('t("events.create_time_title")');
    expect(createTemplate).toContain('t("events.create_place_title")');
    expect(createTemplate).toContain('t("events.create_capacity_title")');
    expect(editTemplate).toContain('t("events.edit_title")');
    expect(editTemplate).toContain('t("events.polish_events.edit_image_label")');
    expect(formSource).not.toContain('name: "group_id"');
    expect(formSource).not.toContain('polish_federation.transfer_cancel');
    expect(detailTemplate).toContain('event.start_time');
    expect(detailTemplate).toContain('event.end_time');
    expect(detailTemplate).toContain('name="reason"');
    expect(detailTemplate).toContain("t(\"events.cancel_reason_label\")");
    expect(detailTemplate).toContain("urlFor('/events/' + (event.id | string) + '/cancel')");
  });

  it('keeps event depth controls behind urlFor()', () => {
    const templates = [
      path.join('events', 'browse.njk'),
      path.join('events', 'map.njk'),
      path.join('events', 'polls.njk'),
      path.join('events', 'recurring-edit.njk'),
      path.join('events', 'translate.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/events/);
      expect(template).not.toMatch(/action="\/events/);
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/events/);
  });

  it('keeps event route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'events.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|events)/);
    expect(route).not.toContain('return `/events');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps poll browse, create, manage, rank, and detail controls behind urlFor()', () => {
    const templates = [
      path.join('polls', 'index.njk'),
      path.join('polls', 'create.njk'),
      path.join('polls', 'detail.njk'),
      path.join('polls', 'manage.njk'),
      path.join('polls', 'rank.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/(?:href|action)="\/polls/);
    expect(source).toMatch(/urlFor\(["']\/polls/);
  });

  it('keeps account hub links and logout form behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'account.njk'),
      'utf8'
    );

    expect(template).toContain('href="{{ urlFor(item.href) }}"');
    expect(template).toContain('action="{{ urlFor(\'/logout\') }}"');
    expect(template).not.toContain('href="{{ item.href }}"');
    expect(template).not.toContain('action="/logout"');
  });

  it('keeps activity dashboard and insights links behind urlFor()', () => {
    const dashboardTemplate = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'activity', 'index.njk'),
      'utf8'
    );
    const insightsTemplate = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'activity', 'insights.njk'),
      'utf8'
    );

    expect(dashboardTemplate).toContain('href="{{ urlFor(\'/activity/insights\') }}"');
    expect(dashboardTemplate).not.toContain('href="/activity/insights"');
    expect(insightsTemplate).toContain('href="{{ urlFor(\'/activity\') }}"');
    expect(insightsTemplate).not.toContain('href="/activity"');
  });

  it('keeps activity route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'activity.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps shared auth and error middleware redirects behind the active tenant URL helper', () => {
    const sources = [
      path.join('src', 'middleware', 'auth.js'),
      path.join('src', 'lib', 'errorHandler.js')
    ].map((sourcePath) => fs.readFileSync(
      path.join(__dirname, '..', sourcePath),
      'utf8'
    ));
    const source = sources.join('\n');

    expect(source).toContain('res.locals.urlFor');
    expect(source).not.toMatch(/res\.redirect\(['"`]\/(?:login|dashboard)/);
  });

  it('keeps member dashboard links behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'dashboard', 'index.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/(?:onboarding|exchanges|listings|events|profile|feed|messages|members|volunteering)/);
    expect(template).toMatch(/urlFor\(["']\/listings/);
    expect(template).toMatch(/urlFor\(["']\/events/);
    expect(template).toMatch(/urlFor\(["']\/profile/);
  });

  it('keeps member onboarding route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'onboarding-posts.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|onboarding|dashboard)/);
    expect(route).not.toMatch(/res\.redirect\(`\/(?:login|onboarding|dashboard)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps member onboarding wizard links and forms behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'onboarding', 'index.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/onboarding/);
    expect(template).not.toMatch(/action="\/onboarding/);
    expect(template).toMatch(/urlFor\(["']\/onboarding/);
  });

  it('keeps Explore live-content links behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'explore.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/(?:listings|events)/);
    expect(template).not.toContain('href="{{ listing.href }}"');
    expect(template).not.toContain('href="{{ event.href }}"');
    expect(template).toMatch(/urlFor\((?:listing|event)\.href\)/);
    expect(template).toMatch(/urlFor\(["']\/listings/);
    expect(template).toMatch(/urlFor\(["']\/events/);
  });

  it('keeps Explore route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'explore.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/login/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps achievements navigation and forms behind urlFor()', () => {
    const templates = [
      'index.njk',
      'shop.njk',
      'collections.njk',
      'engagement.njk',
      'showcase.njk',
      'badge.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'achievements', file),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/achievements/);
      expect(template).not.toMatch(/action="\/achievements/);
    }

    expect(templates.join('\n')).toContain("urlFor('/achievements");
  });

  it('keeps achievements route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'achievements.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|achievements)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps leaderboard and NEXUS score links and forms behind urlFor()', () => {
    const leaderboardTemplates = [
      'index.njk',
      'competitive.njk',
      'seasons.njk',
      'journey.njk',
      'spotlight.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'leaderboard', file),
      'utf8'
    ));
    const nexusScoreTemplates = [
      'index.njk',
      'tiers.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'nexus-score', file),
      'utf8'
    ));
    const templates = [...leaderboardTemplates, ...nexusScoreTemplates];

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:leaderboard|nexus-score|members)/);
      expect(template).not.toMatch(/action="\/(?:leaderboard|nexus-score)/);
    }

    expect(templates.join('\n')).not.toContain('href="{{ row.href }}"');
    expect(templates.join('\n')).not.toContain('href="{{ member.href }}"');
    expect(templates.join('\n')).toContain("urlFor('/leaderboard");
    expect(templates.join('\n')).toContain("urlFor('/nexus-score");
  });

  it('keeps leaderboard and NEXUS score route redirects behind the active tenant URL helper', () => {
    const routeSources = [
      'leaderboard.js',
      'nexus-score.js'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', file),
      'utf8'
    ));

    for (const route of routeSources) {
      expect(route).not.toContain('res.redirect(loginRedirect())');
      expect(route).toContain('function redirectTo(res, pathname)');
      expect(route).toContain('res.locals.urlFor');
      expect(route).toContain('redirectTo(res, loginRedirect())');
    }
  });

  it('keeps profile and settings links and forms behind urlFor()', () => {
    const profileTemplates = [
      'index.njk',
      'settings.njk',
      'two-factor.njk',
      'blocked.njk',
      'delete.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'profile', file),
      'utf8'
    ));
    const settingsTemplates = [
      'appearance.njk',
      'availability.njk',
      'data-rights.njk',
      'insurance.njk',
      'linked-accounts.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'settings', file),
      'utf8'
    ));
    const templates = [...profileTemplates, ...settingsTemplates];

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:profile|settings|account|dashboard|achievements|leaderboard)/);
      expect(template).not.toMatch(/action="\/(?:profile|settings|members)/);
      expect(template).not.toContain('href: "/profile');
    }

    expect(templates.join('\n')).not.toContain('href="{{ item.href }}"');
    expect(templates.join('\n')).toContain("urlFor('/profile");
    expect(templates.join('\n')).toContain("urlFor('/settings");
  });

  it('keeps profile route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'profile.js'),
      'utf8'
    );

    expect(route).not.toContain('res.redirect(loginRedirect())');
    expect(route).not.toContain('res.redirect(profileSettingsRedirect(');
    expect(route).not.toContain('res.redirect(twoFactorRedirect(');
    expect(route).not.toContain('res.redirect(deleteAccountRedirect(');
    expect(route).not.toContain("res.redirect('/login?status=account-deletion-requested')");
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
    expect(route).toContain('redirectTo(res, profileSettingsRedirect(');
    expect(route).toContain('redirectTo(res, twoFactorRedirect(');
    expect(route).toContain('redirectTo(res, deleteAccountRedirect(');
  });

  it('keeps settings action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'settings.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).not.toMatch(/res\.redirect\(\s*settingsStatusRedirect/);
    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/(?:login|settings)/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps group, listing, member detail, and report links behind urlFor()', () => {
    const templates = [
      path.join('groups', 'detail.njk'),
      path.join('listings', 'detail.njk'),
      path.join('members', 'profile.njk'),
      path.join('partials', 'report-link.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:groups|listings|members|events|messages|report-a-problem)/);
      expect(template).not.toMatch(/action="\/(?:groups|listings|members|connections)/);
      expect(template).not.toMatch(/href:\s*"\/(?:groups|listings|members)/);
      expect(template).not.toMatch(/returnTo\s*=\s*"\/(?:groups|listings|members)/);
      expect(template).not.toMatch(/value="\/members\//);
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/groups/);
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/listings/);
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/members/);
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/report-a-problem/);
  });

  it('keeps listing analytics, comments, and report controls behind urlFor()', () => {
    const templates = [
      path.join('listings', 'analytics.njk'),
      path.join('listings', 'comments.njk'),
      path.join('listings', 'report.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/listings/);
      expect(template).not.toMatch(/action="\/listings/);
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/listings/);
  });

  it('keeps group announcement, group file, and recommended volunteering links behind urlFor()', () => {
    const templates = [
      path.join('groups', 'announcements.njk'),
      path.join('groups', 'files.njk'),
      path.join('volunteering', 'recommended-shifts.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/href="\/(?:groups|volunteering)/);
    expect(source).not.toMatch(/action="\/groups/);
    expect(source).toMatch(/urlFor\(["']\/groups/);
    expect(source).toMatch(/urlFor\(["']\/volunteering/);

    const groupFiles = templates[1];
    expect(groupFiles).toContain('class="nexus-alpha-table-scroll" role="region" aria-label="{{ t(\'govuk_alpha_groups.files.title\') }}" tabindex="0"');
    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'assets', 'scss', 'main.scss'),
      'utf8'
    );
    expect(styles).toMatch(/\.nexus-alpha-table-scroll\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*auto;/);
  });

  it('keeps group depth templates behind urlFor()', () => {
    const templates = [
      path.join('groups', 'announcement-edit.njk'),
      path.join('groups', 'discussion-create.njk'),
      path.join('groups', 'discussion-detail.njk'),
      path.join('groups', 'discussions.njk'),
      path.join('groups', 'image.njk'),
      path.join('groups', 'invite.njk'),
      path.join('groups', 'manage.njk'),
      path.join('groups', 'notifications.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    const source = templates.join('\n');

    expect(source).not.toMatch(/href="\/(?:groups|members)/);
    expect(source).not.toMatch(/action="\/groups/);
    expect(source).toMatch(/urlFor\(["']\/groups/);
    expect(source).toMatch(/urlFor\(["']\/members/);
    expect(templates[5]).toContain("class=\"nexus-alpha-table-scroll\" role=\"region\" aria-label=\"{{ t('govuk_alpha_groups.invite.pending_heading') }}\" tabindex=\"0\"");
    expect(templates[5]).toContain('class="govuk-table__caption govuk-table__caption--s govuk-visually-hidden">{{ t("govuk_alpha_groups.invite.pending_heading") }}</caption>');
  });

  it('keeps group route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'groups.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(`\/groups/);
    expect(route).not.toMatch(/res\.redirect\(['"]\/groups/);
    expect(route).not.toContain('res.redirect(loginRedirect(res))');
    expect(route).not.toContain("res.redirect(typeof failureRedirect === 'function' ? failureRedirect(error) : failureRedirect)");
    expect(route).not.toMatch(/statusRedirect\(`\/groups/);
    expect(route).toContain('redirectTo(res, loginRedirect())');
    expect(route).toContain('redirectTo(res, failurePath)');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps public volunteering links, filters, and apply CTAs behind urlFor()', () => {
    const templates = [
      'volunteering.njk',
      'volunteer-opportunity.njk'
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/href="\/(?:volunteering|organisations)/);
    expect(source).not.toMatch(/action="\/volunteering/);
    expect(source).not.toContain('href="{{ loadMoreHref }}"');
    expect(source).toMatch(/urlFor\(["']\/volunteering/);
    expect(source).toMatch(/urlFor\(["']\/organisations/);
  });

  it('keeps every Web UK template free of literal root-relative links and form actions', () => {
    const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
    const volunteeringDirectory = path.join(viewsDirectory, 'volunteering');
    const templatePaths = nunjucksFilesUnder(viewsDirectory);
    const violations = [];

    for (const templatePath of templatePaths) {
      const source = fs.readFileSync(templatePath, 'utf8');
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        const isRootPublicAsset = /\bhref=["']\/(?:assets|css)\//.test(line);
        if (/\b(?:href|action)=["']\/(?!\/)/.test(line) && !isRootPublicAsset) {
          violations.push(`${path.relative(viewsDirectory, templatePath)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(templatePaths.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);

    const donations = fs.readFileSync(path.join(volunteeringDirectory, 'donations.njk'), 'utf8');
    const emergencyAlerts = fs.readFileSync(path.join(volunteeringDirectory, 'emergency-alerts.njk'), 'utf8');
    const myOrganisations = fs.readFileSync(path.join(volunteeringDirectory, 'my-organisations.njk'), 'utf8');
    const orgVolunteers = fs.readFileSync(path.join(volunteeringDirectory, 'org-volunteers.njk'), 'utf8');

    expect(donations).toContain("urlFor('/volunteering/donations#donate')");
    expect(myOrganisations).toContain("urlFor('/volunteering?tab=organisations')");
    expect(emergencyAlerts).not.toContain('dashboard.nextHref');
    expect(myOrganisations).toContain('urlFor(nextHref)');
    expect(orgVolunteers).toContain('urlFor(nextHref)');
  });

  it('keeps volunteering action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'volunteering-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|volunteering)/);
    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps volunteering money copy tenant-neutral and exposes the tenant currency code', () => {
    const donations = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'volunteering', 'donations.njk'),
      'utf8'
    );
    const expenses = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'volunteering', 'expenses.njk'),
      'utf8'
    );

    expect(donations).toContain('<div class="govuk-input__prefix">{{ tenantCurrency }}</div>');
    expect(donations).not.toMatch(/aria-hidden="true">(?:&euro;|€)/i);
    expect(donations).not.toMatch(/\beuro\b/i);
    expect(expenses).toContain('{{ t("govuk_alpha_volunteering.expenses.currency_hint") }}');
    expect(expenses).not.toMatch(/\buse euro\b/i);
  });

  it('uses Warning only for the emergency and group-cancellation advisory prefixes', () => {
    const emergencyAlerts = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'volunteering', 'emergency-alerts.njk'),
      'utf8'
    );
    const groupSignups = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'volunteering', 'group-signups.njk'),
      'utf8'
    );

    expect(emergencyAlerts).toMatch(/<span class="govuk-visually-hidden">{{ t\("govuk_alpha\.states\.warning_prefix"\) }}<\/span>\r?\n\s+{{ t\("govuk_alpha_volunteering\.emergency\.accept_warning"\) }}/);
    expect(groupSignups).toMatch(/<span class="govuk-visually-hidden">{{ t\("govuk_alpha\.states\.warning_prefix"\) }}<\/span>\r?\n\s+{{ t\("govuk_alpha_volunteering\.group_signups\.cancel_warning"\) }}/);
    expect(emergencyAlerts).toContain('<h2 class="govuk-error-summary__title">{{ t("govuk_alpha_volunteering.shared.error_title") }}</h2>');
    expect(groupSignups).toContain('<h2 class="govuk-error-summary__title">{{ t("govuk_alpha_volunteering.shared.error_title") }}</h2>');
    expect(emergencyAlerts).not.toContain('<span class="govuk-visually-hidden">There is a problem</span>');
    expect(groupSignups).not.toContain('<span class="govuk-visually-hidden">There is a problem</span>');
  });

  it('keeps volunteering certificate and credential controls behind urlFor()', () => {
    const templates = [
      path.join('volunteering', 'certificates.njk'),
      path.join('volunteering', 'credentials.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/(?:href|action)="\/volunteering/);
    expect(source).toMatch(/urlFor\(["']\/volunteering/);

    const styles = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'assets', 'scss', 'main.scss'),
      'utf8'
    );
    expect(styles).toMatch(/\.nexus-alpha-table-scroll\s*\{[^}]*contain:\s*inline-size layout paint;/s);
  });

  it('keeps member directory, discovery, nearby, and insights controls behind urlFor()', () => {
    const templates = [
      path.join('members', 'index.njk'),
      path.join('members', 'discover.njk'),
      path.join('members', 'nearby.njk'),
      path.join('members', 'insights.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:members|connections|profile)/);
      expect(template).not.toMatch(/action="\/members/);
      expect(template).not.toContain('href: "/members');
      expect(template).not.toContain('baseUrl: "/members"');
      expect(template).not.toContain('href="{{ nextHref }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/members/);
  });

  it('keeps member action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'members.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|members|profile\/blocked)/);
    expect(route).not.toContain('return `/members');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps podcast browse, detail, studio, and management controls behind urlFor()', () => {
    const templates = [
      path.join('podcasts', 'detail.njk'),
      path.join('podcasts', 'episode.njk'),
      path.join('podcasts', 'form.njk'),
      path.join('podcasts', 'index.njk'),
      path.join('podcasts', 'manage.njk'),
      path.join('podcasts', 'studio.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/podcasts/);
      expect(template).not.toMatch(/action="\/podcasts/);
      expect(template).not.toContain('action="{{ action }}"');
      expect(template).not.toContain('action="{{ episodeStoreAction }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/podcasts/);
  });

  it('keeps podcast action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'podcast-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/podcasts/);
    expect(route).not.toMatch(/res\.redirect\(\s*statusRedirect/);
    expect(route).not.toMatch(/res\.redirect\(\s*studioRedirect/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps podcast page redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'podcasts.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/login/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps feed browse, hashtag, permalink, and engagement controls behind urlFor()', () => {
    const templates = [
      path.join('feed', 'hashtag.njk'),
      path.join('feed', 'hashtags.njk'),
      path.join('feed', 'index.njk'),
      path.join('feed', 'item.njk'),
      path.join('feed', 'post.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:feed|members|groups|login)/);
      expect(template).not.toMatch(/action="\/feed/);
      expect(template).not.toContain('href: "/feed');
      expect(template).not.toContain('href="{{ nextHref }}"');
      expect(template).not.toContain('href="{{ item.deepLink.href }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/feed/);
  });

  it('keeps feed action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'feed-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/feed/);
    expect(route).not.toMatch(/res\.redirect\(`\/feed/);
    expect(route).not.toMatch(/return `\/feed/);
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps AI chat and matches links and forms behind urlFor()', () => {
    const templates = [
      path.join('ai-chat', 'index.njk'),
      path.join('matches', 'index.njk'),
      path.join('matches', 'board.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:chat|explore|matches|listings|groups|events)/);
      expect(template).not.toMatch(/action="\/(?:chat|matches)/);
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/chat/);
    expect(source).toMatch(/urlFor\(["']\/matches/);
    expect(source).toMatch(/urlFor\(["']\/listings/);
  });

  it('keeps AI chat route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'ai-chat.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|chat)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('does not keep an unmounted legacy chat router beside the Laravel-compatible chat route', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'server.js'),
      'utf8'
    );
    const legacyChatRoute = path.join(__dirname, '..', 'src', 'routes', 'chat.js');
    const legacyChatTemplate = path.join(__dirname, '..', 'src', 'views', 'chat', 'index.njk');

    expect(server).toContain("require('./routes/ai-chat')");
    expect(server).not.toContain("require('./routes/chat')");
    expect(fs.existsSync(legacyChatRoute)).toBe(false);
    expect(fs.existsSync(legacyChatTemplate)).toBe(false);
  });

  it('keeps matches route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'matches.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\((?:['"`]\/matches|`\/matches)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps auth route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'auth.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|dashboard|password)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps server-level redirects behind the active tenant URL helper', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'server.js'),
      'utf8'
    );

    expect(server).not.toMatch(/res\.redirect\(['"`]\/(?:cookies|login|organisations)/);
    expect(server).not.toMatch(/res\.redirect\((?:invalidRedirect|failedRedirect)\)/);
    expect(server).toContain('redirectTo(res,');
    expect(server).toContain('res.locals.urlFor');
  });

  it('keeps contact and report route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'contact-support.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:contact|login|report-a-problem)/);
    expect(route).not.toContain("buildQuery('/contact'");
    expect(route).not.toContain("buildQuery('/report-a-problem'");
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps group index and form controls behind urlFor()', () => {
    const templates = [
      path.join('groups', 'index.njk'),
      path.join('groups', 'new.njk'),
      path.join('groups', 'edit.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/groups/);
      expect(template).not.toMatch(/action="\/groups/);
      expect(template).not.toContain('href: "/groups');
      expect(template).not.toContain('baseUrl: "/groups"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/groups/);
  });

  it('keeps group deletion visible without JavaScript and group results cursor-backed', () => {
    const index = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'groups', 'index.njk'),
      'utf8'
    );
    const edit = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'groups', 'edit.njk'),
      'utf8'
    );
    const detail = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'groups', 'detail.njk'),
      'utf8'
    );

    expect(edit).toContain('{% if isOwner %}');
    expect(edit).toContain('id="confirm-delete" name="confirm" type="checkbox" value="yes" required');
    expect(edit).toContain('t("groups.delete.warning")');
    expect(edit).toContain("urlFor('/groups/' + (group.id | string) + '/delete')");
    expect(edit).not.toContain('onsubmit="return confirm');
    expect(detail).not.toContain('onsubmit="return confirm');
    expect(detail).not.toContain("'/delete')");
    expect(index).toContain('pagination.hasMore and pagination.cursor');
    expect(index).toContain('href="{{ pagination.nextHref }}" rel="next"');
    expect(index).toContain('govuk-pagination__icon govuk-pagination__icon--next');
  });

  it('keeps resource browse, library, upload, delete, and discussion controls behind urlFor()', () => {
    const templates = [
      path.join('resources', 'index.njk'),
      path.join('resources', 'library.njk'),
      path.join('resources', 'upload.njk'),
      path.join('resources', 'delete.njk'),
      path.join('resources', 'comments.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/resources/);
      expect(template).not.toMatch(/action="\/resources/);
      expect(template).not.toContain('href: "/resources');
      expect(template).not.toContain('baseUrl: "/resources');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/resources/);
  });

  it('keeps resource route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'resources.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|resources)/);
    expect(route).not.toMatch(/res\.redirect\(`\/(?:login|resources)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps search forms, tabs, result links, and saved-search controls behind urlFor()', () => {
    const templates = [
      path.join('search', 'index.njk'),
      path.join('search', 'advanced.njk'),
      path.join('search', 'saved-delete.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:search|listings|members|events|groups)/);
      expect(template).not.toMatch(/action="\/search/);
      expect(template).not.toContain('href: "/search');
      expect(template).not.toContain('href: "/listings"');
      expect(template).not.toContain('baseUrl: "/search"');
      expect(template).not.toContain('href="{{ tabHrefs.');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/search/);
    expect(source).toMatch(/urlFor\(["']\/listings/);
    expect(source).toMatch(/urlFor\(["']\/members/);
    expect(source).toMatch(/urlFor\(["']\/events/);
    expect(source).toMatch(/urlFor\(["']\/groups/);
  });

  it('keeps search route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'search.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/login/);
    expect(route).not.toMatch(/res\.redirect\(\s*searchAdvancedUrl/);
    expect(route).toMatch(/redirectTo\(res,\s*['"`]\/login/);
    expect(route).toMatch(/redirectTo\(res,\s*searchAdvancedUrl/);
  });

  it('keeps saved-item, collection, and appreciation controls behind urlFor()', () => {
    const templates = [
      path.join('saved', 'index.njk'),
      path.join('saved-collections', 'index.njk'),
      path.join('saved-collections', 'detail.njk'),
      path.join('saved-social', 'appreciations.njk'),
      path.join('saved-social', 'public-collections.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:saved|me\/collections|members|users)/);
      expect(template).not.toMatch(/action="\/(?:saved|me\/collections|users|appreciations)/);
      expect(template).not.toContain('href="{{ item.href }}"');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/saved/);
    expect(source).toMatch(/urlFor\(["']\/me\/collections/);
    expect(source).toMatch(/urlFor\(["']\/members/);
    expect(source).toMatch(/urlFor\(["']\/users/);
    expect(source).toMatch(/urlFor\(["']\/appreciations/);
  });

  it('keeps saved collection and appreciation route redirects behind the active tenant URL helper', () => {
    const routes = [
      'saved-collections.js',
      'saved-social.js'
    ].map((routePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', routePath),
      'utf8'
    )).join('\n');

    expect(routes).toContain('function redirectTo(res, pathname)');
    expect(routes).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(routes).not.toMatch(/res\.redirect\(['"`]\/(?:saved|me\/collections|users|appreciations)/);
    expect(routes).not.toMatch(/res\.redirect\(`\/(?:saved|me\/collections|users|appreciations)/);
    expect(routes).toMatch(/redirectTo\(res,\s*loginRedirect\(\)/);
    expect(routes).toMatch(/redirectTo\(res,\s*collection/);
    expect(routes).toMatch(/redirectTo\(res,\s*appreciation/);
  });

  it('keeps listing index and form controls behind urlFor()', () => {
    const templates = [
      path.join('listings', 'index.njk'),
      path.join('listings', 'form.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/listings/);
      expect(template).not.toMatch(/action="\/listings/);
      expect(template).not.toContain('href: "/listings');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/listings/);
  });

  it('keeps listing exchange request controls behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'listings', 'exchange-request.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/listings/);
    expect(template).not.toMatch(/action="\/listings/);
    expect(template).toMatch(/urlFor\(["']\/listings\/["']\s*\+/);
    expect(template).toContain("'/exchange-request'");
  });

  it('keeps listing route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'listings.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/listings/);
    expect(route).not.toMatch(/res\.redirect\(`\/listings/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps marketplace offer and management controls behind urlFor()', () => {
    const templates = [
      path.join('marketplace', 'offers.njk'),
      path.join('marketplace', 'manage.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/marketplace/);
      expect(template).not.toMatch(/action="\/marketplace/);
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/marketplace/);
  });

  it('keeps marketplace browse, detail, and buyer action controls behind urlFor()', () => {
    const templates = [
      path.join('marketplace', '_listing-card.njk'),
      path.join('marketplace', '_nav.njk'),
      path.join('marketplace', 'buy.njk'),
      path.join('marketplace', 'detail.njk'),
      path.join('marketplace', 'form.njk'),
      path.join('marketplace', 'index.njk'),
      path.join('marketplace', 'listing-list.njk'),
      path.join('marketplace', 'offer.njk'),
      path.join('marketplace', 'onboarding.njk'),
      path.join('marketplace', 'report.njk'),
      path.join('marketplace', 'search.njk'),
      path.join('marketplace', 'seller.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/marketplace/);
      expect(template).not.toMatch(/action="\/marketplace/);
      expect(template).not.toContain('href="{{ item.href }}"');
      expect(template).not.toContain('href="{{ category.href }}"');
      expect(template).not.toContain('href="{{ backHref }}"');
      expect(template).not.toContain('action="{{ action }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/marketplace/);
  });

  it('keeps marketplace coupons, orders, and pickup slots behind urlFor()', () => {
    const templates = [
      path.join('marketplace', '_slot-form.njk'),
      path.join('marketplace', 'coupon-form.njk'),
      path.join('marketplace', 'coupons.njk'),
      path.join('marketplace', 'orders.njk'),
      path.join('marketplace', 'slot-form.njk'),
      path.join('marketplace', 'slots.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/marketplace/);
      expect(template).not.toMatch(/action="\/marketplace/);
      expect(template).not.toContain('action="{{ action }}"');
      expect(template).not.toContain('href="{{ tabItem.href }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/marketplace/);
  });

  it('keeps marketplace action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'marketplace-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\((?:['"`]\/marketplace|`\/marketplace)/);
    expect(route).not.toContain('res.redirect(loginRedirect())');
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps marketplace page auth redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'marketplace.js'),
      'utf8'
    );

    expect(route).not.toContain('res.redirect(loginRedirect())');
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps federation member navigation and actions behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'federation', 'member.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/federation/);
    expect(template).not.toMatch(/action="\/federation/);
    expect(template).toMatch(/urlFor\(["']\/federation/);
  });

  it('keeps federation hub navigation and partner links behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'federation', 'index.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/federation/);
    expect(template).not.toContain('href="{{ partner.href }}"');
    expect(template).toMatch(/urlFor\(["']\/federation/);
    expect(template).toContain('href="{{ urlFor(partner.href) }}"');
  });

  it('keeps federation onboarding wizard links and forms behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'federation', 'onboarding.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/federation/);
    expect(template).not.toMatch(/action="\/federation/);
    expect(template).toMatch(/urlFor\(["']\/federation/);
  });

  it('keeps federation browse, messaging, settings, and transfer templates behind urlFor()', () => {
    const templates = [
      'connections.njk',
      'conversation.njk',
      'events.njk',
      'groups.njk',
      'listing-show.njk',
      'listings.njk',
      'members.njk',
      'messages.njk',
      'opt-in.njk',
      'opt-out.njk',
      'partner.njk',
      'partners.njk',
      'settings.njk',
      'transfer.njk'
    ].map((file) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'federation', file),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/href="\/federation/);
    expect(source).not.toMatch(/action="\/federation/);
    expect(source).toMatch(/urlFor\(["']\/federation/);
  });

  it('keeps federation route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'federation.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|federation)/);
    expect(route).not.toMatch(/res\.redirect\(`\/(?:login|federation)/);
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps federation action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'federation-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).not.toMatch(/res\.redirect\(['"`]\/federation/);
    expect(route).not.toMatch(/res\.redirect\(`\/federation/);
    expect(route).not.toMatch(/res\.redirect\((?:status|member|transfer|conversation|connectionList)Redirect/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps connections navigation, member links, forms, and pagination behind urlFor()', () => {
    const templates = [
      path.join('connections', 'index.njk'),
      path.join('connections', 'network.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:connections|members)/);
      expect(template).not.toMatch(/action="\/connections/);
      expect(template).not.toContain('baseUrl: "/connections"');
    }

    expect(templates.join('\n')).not.toContain('href="{{ tabHrefs.accepted }}"');
    expect(templates.join('\n')).not.toContain('href="{{ connection.messageHref }}"');
    expect(templates.join('\n')).not.toContain('href="{{ connection.profileHref }}"');
    expect(templates.join('\n')).not.toContain('action="{{ connection.removeAction }}"');
    expect(templates.join('\n')).not.toContain('action="{{ connection.acceptAction }}"');
    expect(templates.join('\n')).not.toContain('action="{{ connection.declineAction }}"');
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/connections/);
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/members/);
  });

  it('keeps connection route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'connections.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/login/);
    expect(route).not.toMatch(/res\.redirect\(connectionActionUrl/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps clubs form and route redirects behind the active tenant URL helper', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'clubs', 'index.njk'),
      'utf8'
    );
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'clubs.js'),
      'utf8'
    );

    expect(template).not.toMatch(/action="\/clubs/);
    expect(template).toMatch(/urlFor\(["']\/clubs/);
    expect(route).not.toMatch(/res\.redirect\(['"`]\/login/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps skills links, form, and route redirects behind the active tenant URL helper', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'skills', 'index.njk'),
      'utf8'
    );
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'skills.js'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/(?:skills|members)/);
    expect(template).not.toMatch(/action="\/skills/);
    expect(template).toMatch(/urlFor\(["']\/skills/);
    expect(template).toMatch(/urlFor\(["']\/members/);
    expect(route).not.toMatch(/res\.redirect\(['"`]\/login/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps notifications filters, actions, redirects, and pagination behind urlFor()', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'notifications', 'index.njk'),
      'utf8'
    );

    expect(template).not.toMatch(/href="\/notifications/);
    expect(template).not.toMatch(/action="\/notifications/);
    expect(template).not.toContain('baseUrl: "/notifications"');
    expect(template).not.toContain('value="{{ notificationLink }}"');
    expect(template).not.toContain('href: "/notifications"');
    expect(template).toMatch(/urlFor\(["']\/notifications/);
    expect(template).toContain('href="{{ urlFor(notificationLink) }}"');
    expect(template).not.toContain('name="redirect"');
  });

  it('keeps notification route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'notifications.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/notifications/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps poll action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'poll-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|polls)/);
    expect(route).not.toContain('return `/polls');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps legacy poll vote redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'polls.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(`\/polls/);
    expect(route).not.toMatch(/res\.redirect\(['"`]\/polls/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps review action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'reviews.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|reviews)/);
    expect(route).not.toMatch(/res\.redirect\(safeReturnUrl\)/);
    expect(route).not.toContain('validateReturnUrl');
    expect(route).not.toContain('return_url');
    expect(route).not.toContain('return `/reviews');
    expect(route).toContain('review-deleted');
    expect(route).toContain('review-delete-failed');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps review summary, list, and comment controls behind urlFor()', () => {
    const templates = [
      path.join('reviews', 'index.njk'),
      path.join('reviews', 'list.njk'),
      path.join('reviews', 'comments.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const source = templates.join('\n');

    expect(source).not.toMatch(/(?:href|action)="\/reviews/);
    expect(source).toMatch(/urlFor\(["']\/reviews/);
    expect(source).toContain('urlFor(loadMoreHref)');
  });

  it('keeps ideation action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'ideation-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|ideation)/);
    expect(route).not.toContain('return `/ideation/');
    expect(route).not.toContain("'/ideation/campaigns?status=campaign-created'");
    expect(route).not.toContain("'/ideation/new?status=challenge-create-failed'");
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps ideation GET auth redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'ideation.js'),
      'utf8'
    );

    expect(route).not.toContain('res.redirect(loginRedirect())');
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps ideation template links and forms behind urlFor()', () => {
    const templates = [
      path.join('ideation', '_nav.njk'),
      path.join('ideation', 'campaign-detail.njk'),
      path.join('ideation', 'campaigns.njk'),
      path.join('ideation', 'challenge-form.njk'),
      path.join('ideation', 'detail.njk'),
      path.join('ideation', 'drafts.njk'),
      path.join('ideation', 'idea-detail.njk'),
      path.join('ideation', 'index.njk'),
      path.join('ideation', 'manage.njk'),
      path.join('ideation', 'outcome-form.njk'),
      path.join('ideation', 'outcomes.njk'),
      path.join('ideation', 'tags.njk')
    ];

    for (const templateName of templates) {
      const template = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'views', templateName),
        'utf8'
      );
      expect(template).not.toMatch(/(?:href|action)="\/ideation/);
      expect(template).not.toContain('"/ideation');
    }
  });

  it('keeps the Ideation campaign create workflow aligned with the Blade contract', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'ideation', 'campaigns.njk'),
      'utf8'
    );
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'ideation-actions.js'),
      'utf8'
    );

    expect(template).toContain('{% if ideationIsAdmin %}');
    expect(template).toContain('name="campaign_status"');
    expect(template).toContain('name="cover_image"');
    expect(template).toContain('name="start_date"');
    expect(template).toContain('name="end_date"');
    expect(template).toContain('govuk_alpha_ideation.campaigns.submit_create');
    expect(route).toContain("ideationSubpageRedirect('campaigns', 'campaign-invalid')");
    expect(route).toContain("ideationSubpageRedirect('campaigns', 'campaign-failed')");
    expect(route).not.toContain('campaign-create-failed');
  });

  it('keeps the Ideation campaign detail management workflow aligned with Blade', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'ideation', 'campaign-detail.njk'),
      'utf8'
    );
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'ideation-actions.js'),
      'utf8'
    );

    expect(template).toContain('{% if ideationIsAdmin %}');
    expect(template).toContain('govuk_alpha_ideation.campaigns.edit_heading');
    expect(template).toContain('govuk_alpha_ideation.campaigns.unlink_aria');
    expect(template).toContain('govuk_alpha_ideation.campaigns.delete_warning');
    expect(template).toContain("urlFor('/ideation/campaigns/' ~ campaign.id ~ '/delete')");
    expect(route).toContain("campaignRedirect(id, 'campaign-updated')");
    expect(route).not.toContain('campaign-save-failed');
    expect(route).not.toContain('campaign-delete-failed');
    expect(route).not.toContain('challenge-unlink-failed');
  });

  it('keeps group exchange tabs, links, and forms behind urlFor()', () => {
    const templates = [
      path.join('group-exchanges', 'index.njk'),
      path.join('group-exchanges', 'create.njk'),
      path.join('group-exchanges', 'detail.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/group-exchanges/);
      expect(template).not.toMatch(/action="\/group-exchanges/);
      expect(template).not.toContain('href: "/group-exchanges');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/group-exchanges/);
    expect(templates.join('\n')).not.toContain('href="{{ tab.href }}"');
  });

  it('keeps group exchange action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'group-exchange-actions.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|group-exchanges)/);
    expect(route).not.toContain('return `/group-exchanges/');
    expect(route).not.toContain("'/group-exchanges/new?status=create-failed'");
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps group exchange GET redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'group-exchanges.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps direct and group message links and forms behind urlFor()', () => {
    const templates = [
      path.join('messages', 'index.njk'),
      path.join('messages', 'conversation.njk'),
      path.join('messages', 'direct-conversation.njk'),
      path.join('messages', 'groups.njk'),
      path.join('messages', 'group-create.njk'),
      path.join('messages', 'group-conversation.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:messages|members|connections|listings)/);
      expect(template).not.toMatch(/action="\/messages/);
      expect(template).not.toMatch(/href:\s*"\/(?:members|connections|messages)/);
    }

    const source = templates.join('\n');
    expect(source).not.toContain('href="{{ olderHref }}"');
    expect(source).toMatch(/urlFor\(["']\/messages/);
    expect(source).toMatch(/urlFor\(["']\/members/);
    expect(source).toMatch(/urlFor\(["']\/listings/);
  });

  it('keeps group-message fixed copy on the Laravel catalog', () => {
    const source = [
      path.join('messages', 'groups.njk'),
      path.join('messages', 'group-create.njk'),
      path.join('messages', 'group-conversation.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    )).join('\n');

    expect(source).toContain('govuk_alpha_messages.groups.title');
    expect(source).toContain('govuk_alpha_messages.create.title');
    expect(source).toContain('govuk_alpha_messages.conversation.members_heading');
    expect(source).toContain('govuk_alpha_messages.manage.leave_warning');
    expect(source).not.toMatch(/>Back to group conversations<|>Start a group conversation<|>Manage members<|>Leave this group<|>React to this message</);
  });

  it('keeps message route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'messages.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|messages)/);
    expect(route).not.toMatch(/res\.redirect\(`\/messages/);
    expect(route).not.toContain('res.redirect(loginRedirect())');
    expect(route).toContain('redirectTo(res,');
    expect(route).toContain('res.locals.urlFor');
  });

  it('keeps wallet links and forms behind urlFor()', () => {
    const templates = [
      path.join('wallet', 'index.njk'),
      path.join('wallet', 'manage.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/wallet/);
      expect(template).not.toMatch(/action="\/wallet/);
      expect(template).not.toContain('href: "/wallet');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/wallet/);
  });

  it('keeps wallet action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'wallet.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(\s*[`'"]\/wallet/);
    expect(route).not.toMatch(/res\.redirect\(\s*walletDonateFailure/);
    expect(route).toMatch(/redirectTo\(res,\s*walletDonateFailure/);
    expect(route).toMatch(/redirectTo\(res,\s*[`'"]\/wallet/);
  });

  it('keeps public auth and support links and forms behind urlFor()', () => {
    const templates = [
      'contact.njk',
      'cookie-settings.njk',
      'forgot-password.njk',
      'login.njk',
      'register.njk',
      'report-problem.njk',
      'reset-password.njk'
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:contact|cookies|legal|login|password|register|report-a-problem)/);
      expect(template).not.toMatch(/action="\/(?:contact|cookie-consent|login|password|register|report-a-problem)/);
      expect(template).not.toContain('action="{{ formAction');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/login/);
    expect(source).toMatch(/urlFor\(["']\/register/);
    expect(source).toMatch(/urlFor\(["']\/contact/);
    expect(source).toMatch(/urlFor\(["']\/report-a-problem/);
  });

  it('keeps public info, legal, support, and cookie banner local links behind urlFor()', () => {
    const templates = [
      path.join('public-info', 'about.njk'),
      path.join('public-info', 'email-verify.njk'),
      path.join('public-info', 'features.njk'),
      path.join('public-info', 'guide.njk'),
      path.join('support', 'help.njk'),
      path.join('support', 'trust-safety.njk'),
      path.join('legal', 'accessibility.njk'),
      path.join('legal', 'document.njk'),
      path.join('partials', 'cookie-banner.njk'),
      'privacy.njk'
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:contact|cookies|dashboard|guide|legal|listings|login|register|wallet)/);
      expect(template).not.toMatch(/action="\/(?:cookie-consent|help)/);
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/contact/);
    expect(source).toMatch(/urlFor\(["']\/cookies/);
    expect(source).toMatch(/urlFor\(["']\/legal/);
  });

  it('keeps public fallback home links behind urlFor()', () => {
    const templates = [
      path.join('public-info', 'newsletter-unsubscribe.njk'),
      'error.njk',
      path.join('errors', '403.njk'),
      path.join('errors', '404.njk'),
      path.join('errors', '429.njk'),
      path.join('errors', '500.njk'),
      path.join('errors', '503.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toContain('href="/"');
      expect(template).toContain("urlFor('/')");
    }
  });

  it('initializes the Blade-matched interactive details disclosures', () => {
    const readView = (templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    );
    const alerts = readView(path.join('jobs', 'alerts.njk'));
    const events = readView(path.join('events', 'detail.njk'));
    const conversation = readView(path.join('messages', 'conversation.njk'));

    expect(alerts).toContain('<details class="govuk-details govuk-!-margin-bottom-0" data-module="govuk-details">');
    expect(events).toContain('<details class="govuk-details govuk-!-margin-bottom-4" data-module="govuk-details">');
    expect(events).toContain('<details class="govuk-details govuk-!-margin-bottom-0" data-module="govuk-details">');
    expect(conversation).toContain('<details class="govuk-details govuk-!-margin-top-2" data-module="govuk-details">');
  });

  it('keeps both wallet transfer forms behind Blade confirmation checkboxes', () => {
    for (const templatePath of [path.join('wallet', 'index.njk'), path.join('wallet', 'manage.njk')]) {
      const template = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', templatePath), 'utf8');
      expect(template).toContain('name="confirm" type="checkbox" value="1" required');
      expect(template).toContain('transfer_confirm_label');
    }
  });

  it('keeps organisation directory and application controls behind urlFor()', () => {
    const templates = [
      'organisation-detail.njk',
      'organisations.njk',
      'organisations-apply.njk',
      'organisations-browse.njk',
      'organisations-jobs.njk',
      'organisations-manage.njk',
      'organisations-register.njk'
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:organisations|volunteering|jobs|login)/);
      expect(template).not.toMatch(/action="\/(?:organisations|volunteering)/);
      expect(template).not.toContain('href="{{ loadMoreHref }}"');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/organisations/);
    expect(source).toMatch(/urlFor\(["']\/volunteering/);
    expect(source).toMatch(/urlFor\(["']\/jobs/);
  });

  it('keeps jobs browse, saved, application, owner, and employer controls behind urlFor()', () => {
    const templates = [
      path.join('jobs', 'alerts.njk'),
      path.join('jobs', 'analytics.njk'),
      path.join('jobs', 'applicants.njk'),
      path.join('jobs', 'application-history.njk'),
      path.join('jobs', 'applications.njk'),
      path.join('jobs', 'bias-audit.njk'),
      path.join('jobs', 'detail.njk'),
      path.join('jobs', 'employer-brand.njk'),
      path.join('jobs', 'form.njk'),
      path.join('jobs', 'index.njk'),
      path.join('jobs', 'mine.njk'),
      path.join('jobs', 'onboarding.njk'),
      path.join('jobs', 'pipeline.njk'),
      path.join('jobs', 'qualification.njk'),
      path.join('jobs', 'responses.njk'),
      path.join('jobs', 'saved.njk'),
      path.join('jobs', 'talent-profile.njk'),
      path.join('jobs', 'talent-search.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/jobs/);
      expect(template).not.toMatch(/action="\/jobs/);
      expect(template).not.toContain('href="{{ nextHref }}"');
      expect(template).not.toContain('href="{{ meta.nextHref }}"');
      expect(template).not.toContain('action="{{ formAction }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/jobs/);
  });

  it('keeps jobs route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'jobs.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/(?:login|jobs)/);
    expect(route).not.toMatch(/res\.redirect\(\s*(?:loginRedirect\(\)|statusRedirect|jobRedirect|bookmarkRedirect)/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
    expect(route).toMatch(/redirectTo\(res,\s*statusRedirect/);
    expect(route).toMatch(/redirectTo\(res,\s*jobRedirect/);
    expect(route).toMatch(/redirectTo\(res,\s*bookmarkRedirect/);
  });

  it('keeps blog index, detail, comments, and reaction controls behind urlFor()', () => {
    const templates = [
      path.join('blog', 'index.njk'),
      path.join('blog', 'detail.njk'),
      path.join('blog', 'comments.njk'),
      path.join('blog', 'likers.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:blog|members)/);
      expect(template).not.toMatch(/action="\/blog/);
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/blog/);
    expect(source).toMatch(/urlFor\(["']\/members/);
  });

  it('keeps blog route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'blog-posts.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|blog|reviews)/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps course browse, learner, and instructor controls behind urlFor()', () => {
    const templates = [
      path.join('courses', '_nav.njk'),
      path.join('courses', 'analytics.njk'),
      path.join('courses', 'detail.njk'),
      path.join('courses', 'form.njk'),
      path.join('courses', 'grading.njk'),
      path.join('courses', 'index.njk'),
      path.join('courses', 'instructor.njk'),
      path.join('courses', 'learn.njk'),
      path.join('courses', 'my-learning.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/courses/);
      expect(template).not.toMatch(/action="\/courses/);
      expect(template).not.toContain('action="{{ formAction }}"');
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/courses/);
  });

  it('keeps the course instructor form aligned with the Laravel commerce catalog', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'courses', 'form.njk'),
      'utf8'
    );

    const requiredKeys = [
      'govuk_alpha_commerce.instructor.back_to_dashboard',
      'govuk_alpha_commerce.instructor.caption',
      'govuk_alpha_commerce.instructor.title_create',
      'govuk_alpha_commerce.instructor.title_edit',
      'govuk_alpha_commerce.instructor.section_about',
      'govuk_alpha_commerce.instructor.section_settings',
      'govuk_alpha_commerce.instructor.builder_notice_title',
      'govuk_alpha_commerce.builder.add_section_heading',
      'govuk_alpha_commerce.builder.add_lesson_heading',
      'govuk_alpha_commerce.instructor.delete_warning'
    ];

    for (const key of requiredKeys) {
      expect(source).toContain(key);
    }

    expect(source).not.toContain('t("events.no_category")');
    expect(source).not.toContain('t("polish_federation.transfer_cancel")');
    expect(source).not.toContain('t("jobs_t3.delete_button")');
  });

  it('keeps course action redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'courses.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/(?:login|courses)/);
    expect(route).not.toMatch(/res\.redirect\(`\/courses/);
    expect(route).not.toMatch(/requireCourseAction\([^,]+,\s*[^,]+,\s*['"`]\/(?:login|courses)/);
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps knowledge-base browse, pagination, and article links behind urlFor()', () => {
    const templates = [
      path.join('kb', 'index.njk'),
      path.join('kb', 'article.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/kb/);
      expect(template).not.toMatch(/action="\/kb/);
      expect(template).not.toContain('href="{{ nextHref }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/kb/);
  });

  it('does not restore the unmounted legacy knowledge-base implementation', () => {
    const legacyPaths = [
      path.join(__dirname, '..', 'src', 'routes', 'knowledge-base.js'),
      path.join(__dirname, '..', 'src', 'views', 'knowledge-base', 'index.njk'),
      path.join(__dirname, '..', 'src', 'views', 'knowledge-base', 'detail.njk')
    ];

    for (const legacyPath of legacyPaths) {
      expect(fs.existsSync(legacyPath)).toBe(false);
    }
  });

  it('does not restore zero-caller loading or legacy my-groups templates', () => {
    const legacyPaths = [
      path.join(__dirname, '..', 'src', 'views', 'groups', 'my.njk'),
      path.join(__dirname, '..', 'src', 'views', 'partials', 'empty-state.njk'),
      path.join(__dirname, '..', 'src', 'views', 'partials', 'loading.njk')
    ];

    for (const legacyPath of legacyPaths) {
      expect(fs.existsSync(legacyPath)).toBe(false);
    }
  });

  it('filters unnamed optional file placeholders before multipart size validation', () => {
    const multipart = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'middleware', 'multipart.js'),
      'utf8'
    );

    expect(multipart).toContain('filter: part =>');
    expect(multipart).toContain("part.originalFilename.trim() !== ''");
    expect(multipart).toContain('allowEmptyFiles: false');
  });

  it('keeps goals browse, detail, progress, and social controls behind urlFor()', () => {
    const templates = [
      'buddy-actions.njk',
      'buddying.njk',
      'checkin.njk',
      'detail.njk',
      'discover.njk',
      'edit.njk',
      'history.njk',
      'index.njk',
      'insights.njk',
      'reminder.njk',
      'social.njk',
      'templates.njk'
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'goals', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/goals/);
      expect(template).not.toMatch(/action="\/goals/);
      expect(template).not.toContain('href: "/goals"');
      expect(template).not.toContain('href="{{ nextHref }}"');
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/goals/);
  });

  it('keeps goals route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'goals.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).not.toMatch(/res\.redirect\(['"`]\/goals/);
    expect(route).not.toContain('return `/goals');
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps exchange list and detail links and forms behind urlFor()', () => {
    const templates = [
      path.join('exchanges', 'index.njk'),
      path.join('exchanges', 'detail.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/(?:exchanges|listings|messages)/);
      expect(template).not.toMatch(/action="\/exchanges/);
    }

    const source = templates.join('\n');
    expect(source).toMatch(/urlFor\(["']\/exchanges/);
    expect(source).toMatch(/urlFor\(["']\/listings/);
    expect(source).toMatch(/urlFor\(["']\/messages/);
  });

  it('keeps exchange route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'exchanges.js'),
      'utf8'
    );

    expect(route).not.toMatch(/res\.redirect\(['"`]\/exchanges/);
    expect(route).not.toMatch(/res\.redirect\(`\/exchanges/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res,');
  });

  it('keeps public coupon list and detail links behind urlFor()', () => {
    const templates = [
      path.join('coupons', 'index.njk'),
      path.join('coupons', 'detail.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/coupons/);
    }

    expect(templates.join('\n')).toMatch(/urlFor\(["']\/coupons/);
  });

  it('keeps public coupon route redirects behind the active tenant URL helper', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'coupons.js'),
      'utf8'
    );

    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(loginRedirect\(\)/);
    expect(route).toContain('res.locals.urlFor');
    expect(route).toContain('redirectTo(res, loginRedirect())');
  });

  it('keeps premium links, forms, redirects, and billing return URLs behind the active tenant URL helper', () => {
    const templates = [
      path.join('premium', 'index.njk'),
      path.join('premium', 'manage.njk'),
      path.join('premium', 'return.njk')
    ].map((templatePath) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', templatePath),
      'utf8'
    ));
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'premium.js'),
      'utf8'
    );

    for (const template of templates) {
      expect(template).not.toMatch(/href="\/premium/);
      expect(template).not.toMatch(/action="\/premium/);
    }

    expect(route).toContain('function localUrl(res, pathname)');
    expect(route).toContain('function redirectTo(res, pathname)');
    expect(route).not.toMatch(/res\.redirect\(\s*['"`]\/(?:login|premium)/);
    expect(route).not.toMatch(/return_url:\s*['"`]\/premium/);
    expect(templates.join('\n')).toMatch(/urlFor\(["']\/premium/);
  });

  it('does not restore the unused generic pagination partial', () => {
    const partialPath = path.join(__dirname, '..', 'src', 'views', 'partials', 'pagination.njk');

    expect(fs.existsSync(partialPath)).toBe(false);
  });

  it('uses Laravel catalog labels in cursor pagination blocks', () => {
    const readTemplate = (...segments) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', ...segments),
      'utf8'
    );
    const exchanges = readTemplate('exchanges', 'index.njk');
    const groupConversation = readTemplate('messages', 'group-conversation.njk');
    const myOrganisations = readTemplate('volunteering', 'my-organisations.njk');
    const jobs = ['index.njk', 'saved.njk', 'applications.njk', 'mine.njk']
      .map((name) => readTemplate('jobs', name));

    expect(exchanges).toContain("t('exchanges.pagination_label')");
    expect(exchanges).toContain('t("exchanges.more_results_label")');
    expect(exchanges).not.toContain('aria-label="Exchange pagination"');
    expect(groupConversation).toContain("t('govuk_alpha_messages.conversation.older_pagination_label')");
    expect(groupConversation).toContain('t("govuk_alpha_messages.conversation.show_older")');
    expect(myOrganisations).toContain("t('govuk_alpha_volunteering.my_orgs.pagination_label')");
    expect(myOrganisations).toContain('t("govuk_alpha_volunteering.my_orgs.more_label")');
    for (const template of jobs) {
      expect(template).toContain("t('members.pagination_label')");
      expect(template).toContain('t("members.more_results_label")');
      expect(template).not.toContain('aria-label="Pagination"');
    }
  });

  it('keeps retired breadcrumb and empty-state partials absent', () => {
    const breadcrumbsPath = path.join(__dirname, '..', 'src', 'views', 'partials', 'breadcrumbs.njk');
    const emptyStatePath = path.join(__dirname, '..', 'src', 'views', 'partials', 'empty-state.njk');

    expect(fs.existsSync(breadcrumbsPath)).toBe(false);
    expect(fs.existsSync(emptyStatePath)).toBe(false);
  });

  it('uses Blade back links instead of invented breadcrumbs on event and group pages', () => {
    const expectations = [
      ['events', 'detail.njk', "urlFor('/events')", 't("actions.back_to_events")'],
      ['events', 'edit.njk', "urlFor('/events/' + (event.id | string))", 't("events.back_to_event")'],
      ['groups', 'detail.njk', "urlFor('/groups')", 't("actions.back_to_groups")'],
      ['groups', 'edit.njk', "urlFor('/groups/' + (group.id | string))", 't("groups.back_to_group")']
    ];

    for (const [family, template, href, label] of expectations) {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'views', family, template),
        'utf8'
      );
      expect(source).toContain('class="govuk-back-link"');
      expect(source).toContain(href);
      expect(source).toContain(label);
      expect(source).not.toContain('partials/breadcrumbs.njk');
    }
  });

  it('matches Blade navigation on listings, messages, and notifications', () => {
    const read = (family, template) => fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', family, template),
      'utf8'
    );
    const listingForm = read('listings', 'form.njk');
    const backLinkPages = [
      [read('listings', 'detail.njk'), "urlFor('/listings')", 't("actions.back_to_listings")'],
      [read('messages', 'conversation.njk'), "urlFor('/messages')", 't("actions.back_to_messages")']
    ];

    expect(listingForm).toContain("urlFor('/listings/' + (listing.id | string))");
    expect(listingForm).toContain('t("listings.edit.back")');
    expect(listingForm).toContain("urlFor('/listings')");
    expect(listingForm).toContain('t("actions.back_to_listings")');
    expect(listingForm).not.toContain('govukBreadcrumbs');

    for (const [source, href, label] of backLinkPages) {
      expect(source).toContain('class="govuk-back-link"');
      expect(source).toContain(href);
      expect(source).toContain(label);
      expect(source).not.toContain('govukBreadcrumbs');
    }

    for (const source of [
      read('listings', 'index.njk'),
      read('messages', 'index.njk'),
      read('notifications', 'index.njk')
    ]) {
      expect(source).not.toContain('govukBreadcrumbs');
      expect(source).not.toContain('govuk-back-link');
    }
  });

  it('uses the exact Blade catalog for listing create and edit form chrome', () => {
    const form = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'listings', 'form.njk'),
      'utf8'
    );
    const keys = [
      'listings.create.caption', 'listings.create.title', 'listings.create.description',
      'listings.create.intent_legend', 'listings.create.intent_hint',
      'listings.create.title_label', 'listings.create.title_hint',
      'listings.create.description_label', 'listings.create.description_hint',
      'listings.create.category_label', 'listings.create.category_hint',
      'listings.create.hours_label', 'listings.create.hours_hint',
      'listings.create.service_type_legend', 'listings.create.location_label',
      'listings.create.location_hint', 'listings.create.image_label',
      'listings.edit.caption', 'listings.edit.title', 'listings.edit.description',
      'listings.edit.image_label', 'listings.edit.image_hint',
      'listings.create.submit', 'listings.edit.submit'
    ];

    for (const key of keys) expect(form).toContain(key);
    expect(form).not.toContain('What are you listing?');
    expect(form).not.toContain('Share an offer or request with your community.');
    expect(form).not.toContain('polish_listings.save_listing');
  });

  it('uses the Blade listing-detail hierarchy instead of internal summary rows', () => {
    const detail = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'listings', 'detail.njk'),
      'utf8'
    );

    for (const key of [
      'listings.detail_title', 'listings.description_title', 'listings.summary_title',
      'listings.type', 'listings.status_label', 'listings.service_type_label',
      'listings.category', 'listings.location', 'listings.hours_label',
      'listings.created', 'listings.expires_label', 'listings.renewals_label',
      'listings.image_alt', 'listings.gallery_title', 'listings.skills_title',
      'listings.author_title', 'listings.edit.edit_listing',
      'listings.member_offers', 'listings.member_requests',
      'members.verified', 'govuk_alpha_listings.detail.author_badges_heading',
      'govuk_alpha_listings.nav.view_analytics', 'polish_listings.save_listing',
      'polish_listings.renew_listing', 'govuk_alpha_listings.detail.comments_link'
    ]) expect(detail).toContain(key);

    expect(detail).not.toContain('key: { text: "ID" }');
    expect(detail).not.toContain('key: { text: "Description" }');
    expect(detail).not.toContain('listings.edit.delete_warning');
    expect(detail.match(/actions.back_to_listings/g)).toHaveLength(1);
  });

  it('derives event owner controls from the signed profile on detail pages', () => {
    const route = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'events.js'),
      'utf8'
    );

    expect(route).toContain('getRequestProfile(req, token)');
    expect(route).toContain('const isCurrentUserOwner = ownerId !== null && currentUserId !== null');
    expect(route).toContain('const canEditFromApi = event.can_edit === true || event.canEdit === true || event.permissions?.edit === true');
    expect(route).toContain('event.can_edit = !event.is_archived && Boolean(token) && (canEditFromApi || isCurrentUserOwner)');
    expect(route).toContain('event.canEdit = event.can_edit');
    expect(route).toContain("['http:', 'https:'].includes(parsed.protocol)");
    expect(route).toContain('const event = currentEventDetail(eventFrom(eventResult))');
    expect(route).toContain('online_link: safeExternalHttpUrl(');
    expect(route).toContain('video_url: safeExternalHttpUrl(');
    expect(route).toContain("trimmed(onlineAccess.reveal_state).toLowerCase() === 'available'");
  });

  it('avoids duplicate navigation on direct conversations', () => {
    const directConversation = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'messages', 'direct-conversation.njk'),
      'utf8'
    );

    expect(directConversation.match(/class="govuk-back-link"/g)).toHaveLength(1);
    expect(directConversation).toContain("urlFor('/messages')");
    expect(directConversation).toContain('t("govuk_alpha.actions.back_to_messages")');
    expect(directConversation).not.toContain('govukBreadcrumbs');
  });
});

describe('Jobs owner form source contract', () => {
  it('keeps fixed create and edit copy on the Laravel catalog', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'jobs', 'form.njk'),
      'utf8'
    );

    expect(source).toContain('govuk_alpha.jobs_t3.create_caption');
    expect(source).toContain('govuk_alpha.jobs_t3.label_description');
    expect(source).toContain('govuk_alpha.jobs_t3.label_status');
    expect(source).toContain('govuk_alpha.jobs_t3.submit_update');
    expect(source).not.toMatch(/>Project NEXUS Accessible<|>Description<|>Location \(optional\)<|>Closing date \(optional\)<|>Visibility</);
  });
});

describe('localized progressive validation source contract', () => {
  it('gives every enhanced form localized summary and screen-reader prefix copy', () => {
    const viewsRoot = path.join(__dirname, '..', 'src', 'views');
    const enhancedForms = nunjucksFilesUnder(viewsRoot)
      .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }))
      .filter(({ source }) => source.includes('data-validate-form'));

    expect(enhancedForms).toHaveLength(5);
    for (const { file, source } of enhancedForms) {
      const openingTag = source.match(/<form\b[^>]*data-validate-form[^>]*>/s)?.[0] || '';
      expect({
        file,
        hasErrorTitle: openingTag.includes('data-validation-error-title="{{ t(\'states.error_title\') }}"'),
        hasErrorPrefix: openingTag.includes('data-validation-error-prefix="{{ t(\'states.error_prefix\') }}"')
      }).toEqual({ file, hasErrorTitle: true, hasErrorPrefix: true });
    }
  });

  it('keeps focus on the actionable summary and supports field-level localized messages', () => {
    const validation = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'validation.js'),
      'utf8'
    );

    expect(validation).toContain('form.dataset.validationErrorTitle');
    expect(validation).toContain('form.dataset.validationErrorPrefix');
    expect(validation).toContain('field.dataset[`${ruleName}Message`]');
    expect(validation).toContain('summary.focus()');
    expect(validation).not.toContain('firstErrorField.focus()');
  });
});

describe('Laravel-first Jobs sub-navigation source contract', () => {
  it('uses one exact catalog-backed partial on every Laravel Jobs tab surface', () => {
    const viewsRoot = path.join(__dirname, '..', 'src', 'views', 'jobs');
    const nav = fs.readFileSync(path.join(viewsRoot, '_nav.njk'), 'utf8');
    const activePages = {
      'index.njk': 'browse',
      'saved.njk': 'saved',
      'applications.njk': 'applications',
      'responses.njk': 'responses',
      'alerts.njk': 'alerts',
      'mine.njk': 'mine',
      'onboarding.njk': 'mine'
    };

    expect(nav).toContain('t("govuk_alpha.jobs.title")');
    expect(nav).toContain('t("govuk_alpha.jobs_t2.nav_browse")');
    expect(nav).toContain('t("govuk_alpha.jobs_t2.nav_saved")');
    expect(nav).toContain('t("govuk_alpha.jobs_t2.nav_applications")');
    expect(nav).toContain('t("govuk_alpha_jobs.responses.title")');
    expect(nav).toContain('t("govuk_alpha.jobs_t4.nav_alerts")');
    expect(nav).toContain('t("govuk_alpha.jobs_t3.nav_mine")');
    expect(nav).toContain('t("govuk_alpha.jobs_t3.nav_create")');
    expect(nav).toContain('aria-current="page"');

    for (const [file, activeTab] of Object.entries(activePages)) {
      const source = fs.readFileSync(path.join(viewsRoot, file), 'utf8');
      expect(source).toContain(`{% set jobsActiveTab = "${activeTab}" %}`);
      expect(source).toContain('{% include "jobs/_nav.njk" %}');
      expect(source).not.toContain('<ul class="govuk-tabs__list">');
    }
  });

  it('keeps employer onboarding on the exact default-English Blade catalog', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'jobs', 'onboarding.njk'),
      'utf8'
    );

    for (const key of [
      'caption', 'title', 'returning_heading', 'returning_body', 'welcome_heading',
      'welcome_body', 'how_heading', 'step_1', 'step_2', 'step_3',
      'transparency_note', 'tips_heading', 'tip_1', 'tip_2', 'tip_3', 'tip_4',
      'start_button', 'view_mine_button', 'browse_link'
    ]) {
      expect(source).toContain(`t("govuk_alpha_jobs.onboarding.${key}")`);
    }

    expect(source).not.toContain('Get started as an employer');
    expect(source).not.toContain('Tips for more applicants');
    expect(source).not.toContain('about.how_it_works.title');
  });
});

describe('Laravel-first Messages sub-navigation source contract', () => {
  it('shares the exact direct/group switch with one current page', () => {
    const viewsRoot = path.join(__dirname, '..', 'src', 'views', 'messages');
    const subnav = fs.readFileSync(path.join(viewsRoot, '_subnav.njk'), 'utf8');

    expect(subnav).toContain("t('govuk_alpha.messages.tabs_title')");
    expect(subnav).toContain('t("govuk_alpha_messages.groups.tab_direct")');
    expect(subnav).toContain('t("govuk_alpha_messages.groups.tab_groups")');
    expect(subnav).toContain("urlFor('/messages')");
    expect(subnav).toContain("urlFor('/messages/groups')");
    expect(subnav).toContain('aria-current="page"');

    for (const [file, activeTab] of [['index.njk', 'direct'], ['groups.njk', 'groups']]) {
      const source = fs.readFileSync(path.join(viewsRoot, file), 'utf8');
      expect(source).toContain(`{% set messagesActive = "${activeTab}" %}`);
      expect(source).toContain('{% include "messages/_subnav.njk" %}');
      expect(source).not.toContain('govuk-list--inline');
    }
  });
});

describe('Laravel-first Commerce and Ideation sub-navigation source contract', () => {
  it('uses the exact Courses catalog and default active tab', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'courses', '_nav.njk'),
      'utf8'
    );

    for (const key of ['heading', 'browse', 'learning', 'teaching']) {
      expect(source).toContain(`t("govuk_alpha_commerce.courses_nav.${key}")`);
    }
    expect(source).toContain("{% set active = activeTab or 'browse' %}");
    expect(source).not.toMatch(/>Browse<|>My learning<|>Courses I teach</);
  });

  it('uses the exact member-visible Ideation catalog and default active tab', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'ideation', '_nav.njk'),
      'utf8'
    );

    for (const key of ['heading', 'challenges', 'campaigns', 'outcomes']) {
      expect(source).toContain(`t("govuk_alpha_ideation.nav.${key}")`);
    }
    expect(source).toContain('t("govuk_alpha_ideation.nav.create")');
    expect(source).toContain('{% if ideationIsAdmin %}');
    expect(source).toContain("{% set active = activeTab or 'challenges' %}");
    expect(source).not.toContain('feed.types.challenges');
    expect(source).not.toMatch(/>Ideation<|>Campaigns<|>Outcomes</);
  });
});

describe('Laravel-first Federation sub-navigation source contract', () => {
  it('uses one exact nine-link partial across every Laravel Federation surface', () => {
    const viewsRoot = path.join(__dirname, '..', 'src', 'views', 'federation');
    const nav = fs.readFileSync(path.join(viewsRoot, '_nav.njk'), 'utf8');
    const surfaces = [
      'index.njk', 'partners.njk', 'partner.njk', 'onboarding.njk', 'opt-in.njk',
      'opt-out.njk', 'settings.njk', 'members.njk', 'member.njk', 'listings.njk',
      'listing-show.njk', 'events.njk', 'connections.njk', 'messages.njk',
      'conversation.njk', 'transfer.njk', 'groups.njk'
    ];

    expect(nav).toContain('t("govuk_alpha.federation.nav.label")');
    expect(nav).toContain('t("govuk_alpha.federation.title")');
    for (const key of [
      'overview', 'partners', 'members', 'listings', 'events', 'groups',
      'connections', 'messages', 'settings'
    ]) {
      expect(nav).toContain(`t("govuk_alpha.federation.nav.${key}")`);
    }
    expect(nav).toContain('aria-current="page"');

    for (const file of surfaces) {
      const source = fs.readFileSync(path.join(viewsRoot, file), 'utf8');
      expect(source).toContain('{% include "federation/_nav.njk" %}');
      expect(source).not.toContain('govuk-service-navigation');
      expect(source).not.toContain('aria-label="Federation"');
    }
  });
});

describe('Laravel-first Gamification sub-navigation source contract', () => {
  it('shares the exact achievements and leaderboard tab groups', () => {
    const viewsRoot = path.join(__dirname, '..', 'src', 'views');
    const nav = fs.readFileSync(path.join(viewsRoot, 'partials', 'gamification-nav.njk'), 'utf8');
    const surfaces = {
      'achievements/index.njk': ['achievements', ''],
      'achievements/shop.njk': ['achievements', 'shop'],
      'achievements/collections.njk': ['achievements', 'collections'],
      'achievements/showcase.njk': ['achievements', 'showcase'],
      'achievements/engagement.njk': ['achievements', 'engagement'],
      'leaderboard/index.njk': ['leaderboard', ''],
      'leaderboard/competitive.njk': ['leaderboard', 'competitive'],
      'leaderboard/seasons.njk': ['leaderboard', 'seasons'],
      'leaderboard/journey.njk': ['leaderboard', 'journey'],
      'leaderboard/spotlight.njk': ['leaderboard', 'spotlight']
    };

    for (const key of [
      'leaderboard_heading', 'competitive', 'seasons', 'journey', 'spotlight',
      'heading', 'shop', 'collections', 'showcase', 'engagement'
    ]) {
      expect(nav).toContain(`t("govuk_alpha_gamification.nav.${key}")`);
    }
    expect(nav).toContain('aria-current="page"');

    for (const [file, [group, active]] of Object.entries(surfaces)) {
      const source = fs.readFileSync(path.join(viewsRoot, file), 'utf8');
      expect(source).toContain(`{% set gamificationNavGroup = "${group}" %}`);
      expect(source).toContain(`{% set gamificationActiveTab = "${active}" %}`);
      expect(source).toContain('{% include "partials/gamification-nav.njk" %}');
      expect(source).not.toContain('<ul class="govuk-tabs__list">');
    }
  });
});

describe('GOV.UK Frontend palette compatibility', () => {
  it('avoids removed legacy colour names in the shared visual layer', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'assets', 'scss', 'main.scss'),
      'utf8'
    );

    expect(source).not.toContain('govuk-colour("light-grey")');
    expect(source).not.toContain('govuk-colour("turquoise")');
    expect(source).toContain('govuk-colour("black", $variant: "tint-95")');
    expect(source).toContain('govuk-colour("teal", $variant: "primary")');
  });
});
