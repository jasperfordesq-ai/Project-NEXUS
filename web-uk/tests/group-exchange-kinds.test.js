// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group exchanges now come in five kinds (workshop, team, equal, weighted, custom).
 *
 * This file pins what the accessible site owes a member in that world:
 *
 * - the create form offers all five kinds, in that order, workshop selected, and
 *   works with no JavaScript (every kind's input is in the page; the server picks the
 *   one that belongs to the chosen kind);
 * - the chosen kind is SENT to Laravel as chosen. It used to be coerced to `equal`
 *   unless it was literally `custom`, so a team or a workshop would have silently been
 *   saved as something else;
 * - "Check the hours" asks Laravel what everyone would earn or pay, keeps what was
 *   typed, and shows the server's own problem message when the split cannot go ahead;
 * - the detail page names the kind, shows what each person earns or pays, the community
 *   time fund's share, and "You will earn/pay N hours" beside Confirm;
 * - nobody is ever called a "provider" or a "receiver", and nothing is a "transfer".
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callGroupExchangeApi: jest.fn(),
    previewGroupExchange: jest.fn(),
    searchUsers: jest.fn(),
    getProfile: jest.fn()
  };
});

const api = require('../src/lib/api');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/group-exchanges`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const KINDS = ['workshop', 'team', 'equal', 'weighted', 'custom'];

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'group-exchange-kinds-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'group-exchange-kinds-test.sid'
  }));

  const actionRoutes = require('../src/routes/group-exchange-actions');
  const pageRoutes = require('../src/routes/group-exchanges');

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: MOUNT,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, actionRoutes, pageRoutes);

  return app;
}

/** What a screen-reader user hears: the page with every tag and attribute removed. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

function exchange(overrides = {}) {
  return {
    data: {
      id: 7,
      title: 'Knitting class',
      status: 'draft',
      split_type: 'workshop',
      total_hours: 2,
      community_fund_hours: 0,
      organizer_id: 101,
      participants: [
        { user_id: 101, name: 'Mary Byrne', role: 'provider', hours: 2, confirmed: false },
        { user_id: 55, name: 'Tom Adams', role: 'receiver', hours: 2, confirmed: false }
      ],
      calculated_split: [
        { user_id: 101, role: 'provider', hours: 2 },
        { user_id: 55, role: 'receiver', hours: 2 }
      ],
      ...overrides
    }
  };
}

beforeEach(() => {
  api.callGroupExchangeApi.mockReset();
  api.previewGroupExchange.mockReset();
  api.searchUsers.mockReset();
  api.getProfile.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 101, name: 'Mary Byrne' } });
  api.callGroupExchangeApi.mockResolvedValue({ data: { id: 42 } });
});

describe('the create form offers the five kinds', () => {
  let html;

  beforeEach(async () => {
    const response = await request(createApp()).get(`${MOUNT}/new`);
    expect(response.status).toBe(200);
    html = response.text;
  });

  it('lists all five radios in order with workshop checked', () => {
    const radios = [...html.matchAll(/<input[^>]*name="split_type"[^>]*>/g)].map((match) => match[0]);
    expect(radios.map((tag) => /value="([^"]+)"/.exec(tag)[1])).toEqual(KINDS);
    expect(radios.map((tag) => /\schecked/.test(tag))).toEqual([true, false, false, false, false]);
    expect(html).toContain('data-module="govuk-radios"');
  });

  it('explains each kind with its name, its sentence and its worked example', () => {
    const text = visibleText(html);
    expect(text).toContain('What kind of group exchange is this?');
    expect(text).toContain('One hour of time is one time credit. People giving time earn credits; people receiving time pay them.');
    for (const phrase of [
      'Workshop or class',
      'Someone runs a session for a group.',
      'Mary runs a 2-hour class for 4 people.',
      'A team helping someone',
      'Several people give their time to one person.',
      'Two volunteers spend 1 hour moving furniture for Tom.',
      'Share equally',
      'Set one total.',
      'Share by amount of effort',
      'Like sharing equally, but you mark who did more.',
      'Type each person\'s hours',
      'You enter exactly what each person earns or pays.'
    ]) {
      expect(text).toContain(phrase);
    }
    expect(html).toContain('govuk-inset-text');
  });

  it('works without JavaScript: every kind has its own number input and none is required', () => {
    for (const kind of KINDS) {
      const input = new RegExp(`<input[^>]*name="total_hours_${kind}"[^>]*>`).exec(html);
      expect(input).not.toBeNull();
      // A required input inside a hidden reveal would stop the whole form submitting.
      expect(input[0]).not.toMatch(/\srequired/);
    }
    expect(visibleText(html)).toContain('How long was the session (in hours)?');
    expect(visibleText(html)).toContain('How many hours did each helper spend?');
  });

  it('has no provider, receiver or transfer wording', () => {
    expect(visibleText(html)).not.toMatch(/provider|receiver|transfer/i);
  });
});

describe('creating an exchange sends the chosen kind', () => {
  it('sends team as team, not equal', async () => {
    const response = await request(createApp())
      .post(`${MOUNT}/new`)
      .type('form')
      .send({
        title: 'Moving furniture',
        description: '',
        split_type: 'team',
        total_hours_workshop: '',
        total_hours_team: '1.5'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${MOUNT}/42?status=created`);
    expect(api.callGroupExchangeApi).toHaveBeenLastCalledWith('test-token', 'POST', '', {
      title: 'Moving furniture',
      description: '',
      total_hours: 1.5,
      split_type: 'team',
      status: 'draft'
    });
  });

  it('sends every one of the five kinds as chosen, using that kind\'s own number', async () => {
    for (const kind of KINDS) {
      api.callGroupExchangeApi.mockClear();
      await request(createApp())
        .post(`${MOUNT}/new`)
        .type('form')
        .send({ title: `A ${kind}`, split_type: kind, [`total_hours_${kind}`]: '3' });
      expect(api.callGroupExchangeApi).toHaveBeenLastCalledWith('test-token', 'POST', '', expect.objectContaining({
        split_type: kind,
        total_hours: 3
      }));
    }
  });

  it('shows Laravel\'s own message when it refuses the kind', async () => {
    api.callGroupExchangeApi.mockRejectedValueOnce(new api.ApiError(
      'Choose one of the five kinds of group exchange.',
      422,
      { errors: [{ code: 'SPLIT_TYPE_INVALID', message: 'Choose one of the five kinds of group exchange.', field: 'split_type' }] }
    ));
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/new`)
      .type('form')
      .send({ title: 'Odd one', split_type: 'banana', total_hours: '2' });

    // The unknown kind went to Laravel exactly as typed; web-uk does not decide for it.
    expect(api.callGroupExchangeApi).toHaveBeenLastCalledWith('test-token', 'POST', '', expect.objectContaining({
      split_type: 'banana'
    }));
    expect(post.headers.location).toContain('status=create-failed');

    const page = await agent.get(post.headers.location);
    const summary = /<div class="govuk-error-summary"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(page.text);
    expect(summary).not.toBeNull();
    expect(summary[0]).toContain('Choose one of the five kinds of group exchange.');
  });

  it('keeps what was typed, in the chosen kind\'s own box, when the form is refused', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/new`)
      .type('form')
      .send({ title: '', description: 'Helping Tom move', split_type: 'team', total_hours_team: '2.5' });
    expect(post.headers.location).toContain('status=create-invalid');

    const page = await agent.get(post.headers.location);
    const team = /<input[^>]*id="split-team"[^>]*>/.exec(page.text)[0];
    const workshop = /<input[^>]*id="split-workshop"[^>]*>/.exec(page.text)[0];
    expect(team).toMatch(/\schecked/);
    expect(workshop).not.toMatch(/\schecked/);
    expect(/<input[^>]*name="total_hours_team"[^>]*>/.exec(page.text)[0]).toContain('value="2.5"');
    expect(page.text).toContain('Helping Tom move');
  });
});

describe('adding a person asks only for what the kind needs', () => {
  async function detailFor(splitType, totalHours = 2) {
    api.callGroupExchangeApi.mockResolvedValue(exchange({ split_type: splitType, total_hours: totalHours }));
    api.searchUsers.mockResolvedValue({ data: { items: [{ id: 77, name: 'Ann Murphy' }] } });
    const response = await request(createApp()).get(`${MOUNT}/7?participant_q=ann`);
    expect(response.status).toBe(200);
    return response.text;
  }

  // The form that adds a person (it carries participant_id), not the "Check the hours" one.
  const addFormOf = (html) => [...html.matchAll(/<form[^>]*action="[^"]*\/participants"[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((form) => form.includes('name="participant_id"'));

  it('workshop and team pre-fill the hours; custom starts empty and needs a number', async () => {
    const workshop = addFormOf(await detailFor('workshop', 2));
    expect(/<input[^>]*name="hours"[^>]*>/.exec(workshop)[0]).toContain('value="2"');
    expect(workshop).not.toContain('name="weight"');

    const team = addFormOf(await detailFor('team', 1.5));
    expect(/<input[^>]*name="hours"[^>]*>/.exec(team)[0]).toContain('value="1.5"');

    const custom = addFormOf(await detailFor('custom', 4));
    const customHours = /<input[^>]*name="hours"[^>]*>/.exec(custom)[0];
    expect(customHours).not.toContain('value="4"');
    expect(customHours).toMatch(/\srequired/);
  });

  it('equal asks for no number at all, weighted asks for a weight', async () => {
    const equal = addFormOf(await detailFor('equal', 6));
    expect(equal).not.toContain('name="hours"');
    expect(equal).not.toContain('name="weight"');

    const weighted = addFormOf(await detailFor('weighted', 6));
    expect(weighted).not.toContain('name="hours"');
    expect(/<input[^>]*name="weight"[^>]*>/.exec(weighted)[0]).toContain('value="1"');
    expect(visibleText(weighted)).toContain('Share of the effort for Ann Murphy');
    expect(visibleText(weighted)).toContain('1 is a normal share. 2 is twice as much.');
  });

  it('sends a typed weight, and leaves a team receiver\'s hours out', async () => {
    api.callGroupExchangeApi.mockResolvedValue(exchange({ split_type: 'weighted' }));
    await request(createApp())
      .post(`${MOUNT}/7/participants`)
      .type('form')
      .send({ participant_id: '77', role: 'provider', weight: '2' });
    expect(api.callGroupExchangeApi).toHaveBeenLastCalledWith('test-token', 'POST', '/7/participants', {
      user_id: 77,
      role: 'provider',
      hours: 0,
      weight: 2
    });

    api.callGroupExchangeApi.mockResolvedValue(exchange({ split_type: 'team' }));
    await request(createApp())
      .post(`${MOUNT}/7/participants`)
      .type('form')
      .send({ participant_id: '78', role: 'receiver', hours: '1' });
    expect(api.callGroupExchangeApi).toHaveBeenLastCalledWith('test-token', 'POST', '/7/participants', {
      user_id: 78,
      role: 'receiver',
      hours: 0,
      weight: 1
    });
  });
});

describe('Check the hours', () => {
  const previewData = {
    data: {
      lines: [
        { user_id: 101, name: 'Mary Byrne', role: 'provider', hours: 2, verb: 'earns' },
        { user_id: 55, name: 'Tom Adams', role: 'receiver', hours: 2, verb: 'pays' },
        { user_id: 77, name: null, role: 'receiver', hours: 2, verb: 'pays' }
      ],
      community_fund_hours: 2,
      totals: { earned: 2, paid: 4, to_fund: 2 },
      problem: null
    }
  };

  async function runPreview(agent, body, data = previewData, exchangeBody = exchange()) {
    api.callGroupExchangeApi.mockResolvedValue(exchangeBody);
    api.searchUsers.mockResolvedValue({ data: { items: [{ id: 77, name: 'Ann Murphy' }] } });
    api.previewGroupExchange.mockResolvedValue(data);
    const post = await agent
      .post(`${MOUNT}/7/participants`)
      .type('form')
      .send({ action: 'preview', participant_q: 'ann', ...body });
    expect(post.status).toBe(302);
    return post;
  }

  it('asks Laravel with the people already in the exchange plus the person being added', async () => {
    const agent = request.agent(createApp());
    await runPreview(agent, { participant_id: '77', role: 'receiver', hours: '1.5' });

    expect(api.previewGroupExchange).toHaveBeenCalledTimes(1);
    expect(api.previewGroupExchange).toHaveBeenCalledWith('test-token', {
      split_type: 'workshop',
      total_hours: 2,
      participants: [
        { user_id: 101, role: 'provider', hours: 2, weight: 1 },
        { user_id: 55, role: 'receiver', hours: 2, weight: 1 },
        { user_id: 77, role: 'receiver', hours: 1.5, weight: 1 }
      ]
    });
    // Nothing is written: no participant was added.
    expect(api.callGroupExchangeApi).not.toHaveBeenCalledWith('test-token', 'POST', '/7/participants', expect.anything());
  });

  it('shows what everyone would earn or pay, the fund line and the totals, and keeps what was typed', async () => {
    const agent = request.agent(createApp());
    const post = await runPreview(agent, { participant_id: '77', role: 'receiver', hours: '1.5' });
    expect(post.headers.location).toContain(`${MOUNT}/7`);

    const page = await agent.get(post.headers.location);
    expect(page.status).toBe(200);
    const text = visibleText(page.text);
    expect(page.text).toContain('govuk-summary-list');
    expect(text).toContain('What everyone will earn or pay');
    expect(text).toContain('Mary Byrne earns 2 hours');
    expect(text).toContain('Tom Adams pays 2 hours');
    // A person Laravel could not name is "A member", never blank.
    expect(text).toContain('A member pays 2 hours');
    expect(text).toContain('2 hours go to the community time fund');
    expect(text).toContain('4 hours paid · 2 hours earned · 2 hours to the community time fund');

    // The search the organiser had open is still open, with the typed values in place.
    expect(text).toContain('Ann Murphy');
    const addForm = [...page.text.matchAll(/<form[^>]*action="[^"]*\/participants"[\s\S]*?<\/form>/g)]
      .map((match) => match[0])
      .find((form) => form.includes('name="participant_id"'));
    expect(/<input[^>]*name="hours"[^>]*>/.exec(addForm)[0]).toContain('value="1.5"');
    expect(/<option[^>]*value="receiver"[^>]*>/.exec(addForm)[0]).toMatch(/\sselected/);
  });

  it('shows the server\'s problem message in the error summary', async () => {
    const agent = request.agent(createApp());
    const problem = {
      data: {
        lines: [],
        community_fund_hours: 0,
        totals: { earned: 3, paid: 2, to_fund: 0 },
        problem: {
          code: 'EARNED_EXCEEDS_PAID',
          message: 'The people giving time would earn more hours than the people receiving time pay.'
        }
      }
    };
    const post = await runPreview(agent, {}, problem);
    const page = await agent.get(post.headers.location);
    const summary = /<div class="govuk-error-summary"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(page.text);
    expect(summary).not.toBeNull();
    expect(summary[0]).toContain('The people giving time would earn more hours than the people receiving time pay.');
  });

  it('says so, and keeps the page, when Laravel cannot be asked', async () => {
    const agent = request.agent(createApp());
    api.callGroupExchangeApi.mockResolvedValue(exchange());
    api.previewGroupExchange.mockRejectedValue(new api.ApiError('down', 503, {}));
    const post = await agent
      .post(`${MOUNT}/7/participants`)
      .type('form')
      .send({ action: 'preview' });
    expect(post.headers.location).toContain('status=check-failed');

    const page = await agent.get(post.headers.location);
    expect(page.status).toBe(200);
    expect(visibleText(page.text)).toContain('Something went wrong. Please try again.');
  });

  it('uses the preview once only', async () => {
    const agent = request.agent(createApp());
    const post = await runPreview(agent, {});
    const first = await agent.get(post.headers.location);
    expect(visibleText(first.text)).toContain('Mary Byrne earns 2 hours');
    // The detail page itself still shows the saved split, so look for the PREVIEW heading
    // being gone rather than the lines.
    const second = await agent.get(`${MOUNT}/7`);
    expect(second.text).not.toContain('id="hours-check"');
  });

  it('offers the button beside each person being added and in its own section', async () => {
    api.callGroupExchangeApi.mockResolvedValue(exchange());
    api.searchUsers.mockResolvedValue({ data: { items: [{ id: 77, name: 'Ann Murphy' }] } });
    const page = await request(createApp()).get(`${MOUNT}/7?participant_q=ann`);
    const buttons = [...page.text.matchAll(/<button[^>]*name="action"[^>]*value="preview"[^>]*>([\s\S]*?)<\/button>/g)];
    // One in the "add a person" form, one for the people already in the exchange.
    expect(buttons.length).toBe(2);
    for (const button of buttons) expect(button[1].trim()).toBe('Check the hours');
  });
});

describe('the exchange page', () => {
  async function detail(overrides = {}) {
    api.callGroupExchangeApi.mockResolvedValue(exchange(overrides));
    const response = await request(createApp()).get(`${MOUNT}/7`);
    expect(response.status).toBe(200);
    return response.text;
  }

  it('names an exchange made before the new kinds "Share equally"', async () => {
    const html = await detail({ split_type: 'equal', total_hours: 6 });
    expect(visibleText(html)).toContain('Share equally');
    expect(visibleText(html)).not.toContain('equal ');
  });

  it('names each of the five kinds in words', async () => {
    const names = {
      workshop: 'Workshop or class',
      team: 'A team helping someone',
      equal: 'Share equally',
      weighted: 'Share by amount of effort',
      custom: 'Type each person\'s hours'
    };
    for (const [kind, name] of Object.entries(names)) {
      expect(visibleText(await detail({ split_type: kind }))).toContain(name);
    }
  });

  it('shows what each person earns or pays and the community time fund\'s share', async () => {
    const html = await detail({
      community_fund_hours: 6,
      participants: [
        { user_id: 101, name: 'Mary Byrne', role: 'provider', hours: 2, confirmed: false },
        { user_id: 55, name: 'Tom Adams', role: 'receiver', hours: 2, confirmed: false }
      ],
      calculated_split: [
        { user_id: 101, role: 'provider', hours: 2 },
        { user_id: 55, role: 'receiver', hours: 8 }
      ]
    });
    const text = visibleText(html);
    expect(text).toContain('What everyone will earn or pay');
    expect(text).toContain('Mary Byrne earns 2 hours');
    expect(text).toContain('Tom Adams pays 8 hours');
    expect(text).toContain('6 hours go to the community time fund');
    expect(text).toContain('8 hours paid · 2 hours earned · 6 hours to the community time fund');
  });

  it('tells the signed-in participant what they will pay beside Confirm', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 55, name: 'Tom Adams' } });
    const html = await detail({
      status: 'pending_confirmation',
      terms_token: 'terms',
      participants: [
        { user_id: 101, name: 'Mary Byrne', role: 'provider', hours: 2, confirmed: true },
        { user_id: 55, name: 'Tom Adams', role: 'receiver', hours: 2, confirmed: false }
      ]
    });
    const confirmSection = /<section[^>]*aria-labelledby="confirm-heading"[\s\S]*?<\/section>/.exec(html)[0];
    expect(visibleText(confirmSection)).toContain('You will pay 2 hours');
    expect(confirmSection).toContain('action="/acme/accessible/group-exchanges/7/confirm"');
  });

  it('tells a giver what they will earn, with a singular hour', async () => {
    const html = await detail({
      status: 'pending_confirmation',
      terms_token: 'terms',
      participants: [
        { user_id: 101, name: 'Mary Byrne', role: 'provider', hours: 1, confirmed: false },
        { user_id: 55, name: 'Tom Adams', role: 'receiver', hours: 1, confirmed: true }
      ],
      calculated_split: [
        { user_id: 101, role: 'provider', hours: 1 },
        { user_id: 55, role: 'receiver', hours: 1 }
      ]
    });
    const confirmSection = /<section[^>]*aria-labelledby="confirm-heading"[\s\S]*?<\/section>/.exec(html)[0];
    expect(visibleText(confirmSection)).toContain('You will earn 1 hour');
    expect(visibleText(confirmSection)).not.toContain('1 hours');
  });
});

describe('no provider, receiver or transfer wording anywhere a member reads', () => {
  it('holds for the list, the form and the exchange page', async () => {
    const app = createApp();
    api.searchUsers.mockResolvedValue({ data: { items: [{ id: 77, name: 'Ann Murphy' }] } });

    api.callGroupExchangeApi.mockResolvedValue({
      data: { data: [{ id: 7, title: 'Knitting class', status: 'draft', split_type: 'workshop', total_hours: 2 }] }
    });
    const index = await request(app).get(MOUNT);

    const create = await request(app).get(`${MOUNT}/new`);

    const pages = [index, create];
    for (const kind of KINDS) {
      api.callGroupExchangeApi.mockResolvedValue(exchange({ split_type: kind, status: 'draft' }));
      pages.push(await request(app).get(`${MOUNT}/7?participant_q=ann`));
    }
    api.callGroupExchangeApi.mockResolvedValue(exchange({ status: 'pending_confirmation', terms_token: 't' }));
    pages.push(await request(app).get(`${MOUNT}/7`));

    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(visibleText(page.text)).not.toMatch(/provider|receiver|transfer/i);
    }
  });

  it('shows the kind on the list', async () => {
    api.callGroupExchangeApi.mockResolvedValue({
      data: { data: [{ id: 7, title: 'Knitting class', status: 'draft', split_type: 'equal', total_hours: 2 }] }
    });
    const index = await request(createApp()).get(MOUNT);
    expect(visibleText(index.text)).toContain('Share equally');
  });
});
