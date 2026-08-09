// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  searchV2,
  getSavedSearches,
  getListingCategories,
  getPopularListingTags,
  saveSavedSearch,
  deleteSavedSearch,
  runSavedSearch,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { resolveBackendAssetUrl } = require('../lib/accessible-shell');

const router = express.Router();

const SEARCH_TYPES = new Set(['all', 'listings', 'users', 'events', 'groups']);
const SIMPLE_SEARCH_TYPES = new Set(['all', 'listing', 'user', 'event', 'group']);
const SIMPLE_SEARCH_API_TYPES = {
  all: 'all',
  listing: 'listings',
  user: 'users',
  event: 'events',
  group: 'groups'
};
const SEARCH_SORTS = new Set(['relevance', 'newest', 'oldest']);

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function allowed(value, choices, fallback) {
  const text = String(value || '').trim();
  return choices.has(text) ? text : fallback;
}

function validDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return '';
  }
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? '' : text;
}

function normaliseSkills(value) {
  const seen = new Set();
  const skills = [];

  for (const part of String(value || '').split(',')) {
    const skill = part.trim().toLowerCase();
    if (skill !== '' && !seen.has(skill)) {
      seen.add(skill);
      skills.push(skill);
    }
    if (skills.length >= 20) break;
  }

  return skills;
}

function queryParamsFrom(input) {
  const params = {};
  const query = String(input.q || '').trim();
  if (query !== '') {
    params.q = query;
  }

  const type = allowed(input.type, SEARCH_TYPES, 'all');
  if (type !== 'all') {
    params.type = type;
  }

  const sort = allowed(input.sort, SEARCH_SORTS, 'relevance');
  if (sort !== 'relevance') {
    params.sort = sort;
  }

  const categoryId = Number(input.category_id);
  if (Number.isInteger(categoryId) && categoryId > 0) {
    params.category_id = String(categoryId);
  }

  const skills = normaliseSkills(input.skills);
  if (skills.length > 0) {
    params.skills = skills.join(',');
  }

  const dateFrom = validDate(input.date_from);
  if (dateFrom !== '') {
    params.date_from = dateFrom;
  }

  const dateTo = validDate(input.date_to);
  if (dateTo !== '') {
    params.date_to = dateTo;
  }

  const location = String(input.location || '').trim();
  if (location !== '') {
    params.location = location.slice(0, 120);
  }

  return params;
}

function searchAdvancedUrl(params = {}, status = null) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') {
      query.set(key, value);
    }
  }
  if (status !== null) {
    query.set('status', status);
  }

  const text = query.toString();
  return `/search/advanced${text ? `?${text}` : ''}`;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function redirectAuthIfNeeded(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, '/login?status=auth-required');
    return true;
  }
  return false;
}

function shouldRenderNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function advancedSearchState(query) {
  const params = queryParamsFrom(query);
  const type = params.type || 'all';
  const sort = params.sort || 'relevance';
  const categoryId = params.category_id || '0';
  const skillsList = normaliseSkills(query.skills);
  const dateFrom = params.date_from || '';
  const dateTo = params.date_to || '';
  const location = params.location || '';
  let activeFilterCount = 0;

  if (type !== 'all') activeFilterCount += 1;
  if (categoryId !== '0') activeFilterCount += 1;
  if (sort !== 'relevance') activeFilterCount += 1;
  if (dateFrom) activeFilterCount += 1;
  if (dateTo) activeFilterCount += 1;
  if (location) activeFilterCount += 1;
  if (skillsList.length) activeFilterCount += 1;

  return {
    searchQuery: params.q || '',
    filters: {
      type,
      category_id: categoryId,
      sort,
      date_from: dateFrom,
      date_to: dateTo,
      location,
      skills: skillsList.join(',')
    },
    skillsList,
    activeFilterCount,
    activeTab: allowed(query.tab, SEARCH_TYPES, 'all')
  };
}

function apiSearchParams(state) {
  const params = {
    q: state.searchQuery,
    type: state.filters.type,
    per_page: 30
  };

  if (state.filters.category_id !== '0') params.category_id = state.filters.category_id;
  if (state.filters.sort !== 'relevance') params.sort = state.filters.sort;
  if (state.filters.skills) params.skills = state.filters.skills;

  return params;
}

function advancedLinkEntries(state) {
  const entries = [];
  if (state.searchQuery) entries.push(['q', state.searchQuery]);
  if (state.filters.type !== 'all') entries.push(['type', state.filters.type]);
  if (state.filters.category_id !== '0') entries.push(['category_id', state.filters.category_id]);
  if (state.filters.sort !== 'relevance') entries.push(['sort', state.filters.sort]);
  if (state.filters.skills) entries.push(['skills', state.filters.skills]);
  if (state.filters.date_from) entries.push(['date_from', state.filters.date_from]);
  if (state.filters.date_to) entries.push(['date_to', state.filters.date_to]);
  if (state.filters.location) entries.push(['location', state.filters.location]);
  return entries;
}

function advancedSearchHref(entries, tab = 'all') {
  const query = new URLSearchParams(entries);
  if (tab !== 'all') {
    query.set('tab', tab);
  }
  const queryString = query.toString();
  return queryString ? `/search/advanced?${queryString}` : '/search/advanced';
}

function advancedTabHrefs(state) {
  const entries = advancedLinkEntries(state);
  return {
    all: advancedSearchHref(entries, 'all'),
    listings: advancedSearchHref(entries, 'listings'),
    users: advancedSearchHref(entries, 'users'),
    events: advancedSearchHref(entries, 'events'),
    groups: advancedSearchHref(entries, 'groups')
  };
}

function objectFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function textFrom(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function intFrom(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function truncate(text, max) {
  const value = textFrom(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function coalescedField(item, primary, fallback) {
  return item[primary] === null || item[primary] === undefined
    ? item[fallback]
    : item[primary];
}

function positiveId(value) {
  const id = intFrom(value);
  return id > 0 ? id : 0;
}

function groupedSearchResults(rows) {
  const grouped = { listings: [], users: [], events: [], groups: [] };
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = objectFrom(row);
    const type = textFrom(item.type);
    if (type === 'listing') {
      grouped.listings.push({
        ...item,
        displayTitle: textFrom(item.title),
        displayDescription: textFrom(item.description),
        displayListingType: textFrom(coalescedField(item, 'listing_type', 'type')),
        displayHours: coalescedField(item, 'hours_estimate', 'estimated_hours'),
        linkId: positiveId(item.id),
        imageAssetUrl: resolveBackendAssetUrl(item.image_url || item.imageUrl)
      });
    }
    if (type === 'user') {
      grouped.users.push({
        ...item,
        displayName: textFrom(item.name),
        displayTagline: textFrom(coalescedField(item, 'tagline', 'bio')),
        displayLocation: textFrom(item.location),
        linkId: positiveId(item.id),
        avatarAssetUrl: resolveBackendAssetUrl(item.avatar || item.avatar_url || item.avatarUrl)
      });
    }
    if (type === 'event') {
      grouped.events.push({
        ...item,
        displayTitle: textFrom(item.title),
        displayDescription: textFrom(item.description),
        displayWhen: textFrom(coalescedField(item, 'start_time', 'start_date')),
        displayLocation: textFrom(item.location),
        linkId: positiveId(item.id)
      });
    }
    if (type === 'group') {
      grouped.groups.push({
        ...item,
        displayName: textFrom(item.name),
        displayDescription: textFrom(item.description),
        displayMembersCount: intFrom(coalescedField(item, 'members_count', 'member_count')),
        linkId: positiveId(item.id)
      });
    }
  }
  return grouped;
}

function simpleSearchResults(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const item = objectFrom(row);
    const selectedTitle = item.title === null || item.title === undefined
      ? item.name
      : item.title;
    const id = intFrom(item.id);

    return {
      ...item,
      displayTitle: textFrom(selectedTitle),
      linkId: id > 0 ? id : 0
    };
  });
}

function filteredSearchResults(rows, state) {
  const from = state.filters.date_from ? new Date(`${state.filters.date_from}T00:00:00Z`) : null;
  const to = state.filters.date_to ? new Date(`${state.filters.date_to}T23:59:59.999Z`) : null;
  const location = state.filters.location.toLocaleLowerCase(getRequestIntlLocale());

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const item = objectFrom(row);
    const rawDate = textFrom(item.type === 'event' ? (item.start_time || item.start_date) : item.created_at);
    if (rawDate) {
      const date = new Date(rawDate);
      if (!Number.isNaN(date.getTime())) {
        if (from && date < from) return false;
        if (to && date > to) return false;
      }
    }

    if (location) {
      const itemLocation = textFrom(item.location).toLocaleLowerCase(getRequestIntlLocale());
      if (itemLocation && !itemLocation.includes(location)) return false;
    }
    return true;
  });
}

function groupedForTab(grouped, activeTab) {
  if (activeTab !== 'all') return grouped;
  return Object.fromEntries(Object.entries(grouped).map(([type, rows]) => [type, rows.slice(0, 4)]));
}

function categoryRows(result) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map((row) => {
    const item = objectFrom(row);
    return { id: intFrom(item.id), name: textFrom(item.name) };
  }).filter((row) => row.id > 0 && row.name !== '')
    .sort((left, right) => left.name.localeCompare(right.name, getRequestIntlLocale()));
}

function popularTagRows(result, state) {
  const selected = new Set(state.skillsList);
  return (Array.isArray(result?.data) ? result.data : [])
    .map((row) => textFrom(objectFrom(row).tag))
    .filter((tag) => tag !== '' && !selected.has(tag))
    .slice(0, 8)
    .map((tag) => {
      const entries = advancedLinkEntries(state);
      const skills = [...state.skillsList, tag].join(',');
      const skillsIndex = entries.findIndex(([key]) => key === 'skills');
      if (skillsIndex >= 0) entries[skillsIndex] = ['skills', skills];
      else entries.push(['skills', skills]);
      return { tag, href: advancedSearchHref(entries) };
    });
}

function resultCounts(grouped, total) {
  return {
    all: total,
    listings: grouped.listings.length,
    users: grouped.users.length,
    events: grouped.events.length,
    groups: grouped.groups.length
  };
}

function resultCountLabel(count, tc) {
  return tc('govuk_alpha_search.results.count', count, { count });
}

function membersCountLabel(count, tc) {
  return tc('govuk_alpha_search.results.members_count', count, { count });
}

function savedSearchRows(result, t) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map((row) => {
    const object = objectFrom(row);
    const queryParams = objectFrom(object.query_params);
    return {
      id: intFrom(object.id),
      name: textFrom(object.name, t ? t('govuk_alpha_search.saved.delete_summary') : 'Saved search'),
      query: textFrom(queryParams.q),
      queryParams: queryParamsFrom(queryParams),
      hasLastResultCount: object.last_result_count !== null && object.last_result_count !== undefined,
      lastResultCount: object.last_result_count === null || object.last_result_count === undefined
        ? ''
        : intFrom(object.last_result_count).toLocaleString(getRequestIntlLocale())
    };
  }).filter((row) => row.id > 0);
}

function savedCountLabel(count, tc) {
  return tc('govuk_alpha_search.saved.count', count, { count });
}

function savedSearchById(result, id, t) {
  return savedSearchRows(result, t).find((row) => row.id === id) || null;
}

router.get('/advanced', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const state = advancedSearchState(req.query);
  const hasSearched = state.searchQuery !== '';
  let searchResult = { data: [], meta: { search: { total: 0 } } };
  let savedResult = { data: [] };
  let categoriesResult = { data: [] };
  let popularTagsResult = { data: [] };
  let searchError = false;

  try {
    const calls = [
      getSavedSearches(token),
      getListingCategories(token).catch(() => ({ data: [] })),
      getPopularListingTags(token, 10).catch(() => ({ data: [] }))
    ];
    if (hasSearched) {
      calls.unshift(searchV2(token, apiSearchParams(state)));
    }
    const results = await Promise.all(calls);
    if (hasSearched) {
      [searchResult, savedResult, categoriesResult, popularTagsResult] = results;
    } else {
      [savedResult, categoriesResult, popularTagsResult] = results;
    }
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    searchError = hasSearched;
  }

  const grouped = groupedSearchResults(filteredSearchResults(searchResult.data, state));
  const total = Object.values(grouped).reduce((sum, rows) => sum + rows.length, 0);
  const counts = resultCounts(grouped, total);
  const savedSearches = savedSearchRows(savedResult, res.locals.t);

  return res.render('search/advanced', {
    title: res.locals.t('govuk_alpha_search.advanced.title'),
    activeNav: 'explore',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    status: allowed(req.query.status, new Set(['search-saved', 'search-deleted', 'search-save-failed', 'search-delete-failed']), ''),
    tryAgainHref: req.originalUrl,
    ...state,
    tabHrefs: advancedTabHrefs(state),
    hasSearched,
    searchError,
    total,
    counts,
    resultCountLabel: resultCountLabel(total, res.locals.tc),
    grouped,
    displayGrouped: groupedForTab(grouped, state.activeTab),
    categories: categoryRows(categoriesResult),
    popularTags: popularTagRows(popularTagsResult, state),
    savedSearches,
    savedCountLabel: savedCountLabel(savedSearches.length, res.locals.tc),
    truncate,
    membersCountLabel: (count) => membersCountLabel(count, res.locals.tc),
    formatEventDate: (value) => value ? res.locals.formatLocaleDate(value, {
      day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }) : ''
  });
}));

router.get('/saved/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = Number(req.params.id);
  const result = await getSavedSearches(token);
  const savedSearch = savedSearchById(result, id, res.locals.t);
  if (savedSearch === null) {
    throw new ApiError('Saved search not found', 404);
  }

  return res.render('search/saved-delete', {
    title: res.locals.t('govuk_alpha_search.saved.delete_title'),
    activeNav: 'explore',
    savedSearch
  });
}));

router.post('/saved', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const name = String(req.body.name || '').trim().slice(0, 255);
  const queryParams = queryParamsFrom(req.body);

  if (name === '' || !queryParams.q) {
    return redirectTo(res, searchAdvancedUrl(queryParams, 'search-save-failed'));
  }

  let status = 'search-saved';
  try {
    await saveSavedSearch(token, {
      name,
      query_params: queryParams,
      notify_on_new: false
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return;
    status = 'search-save-failed';
  }

  return redirectTo(res, searchAdvancedUrl(queryParams, status));
}));

router.post('/saved/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let status = 'search-deleted';
  try {
    await deleteSavedSearch(token, Number(req.params.id));
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return;
    if (shouldRenderNotFound(error)) throw error;
    status = 'search-delete-failed';
  }

  return redirectTo(res, searchAdvancedUrl({}, status));
}));

router.post('/saved/:id(\\d+)/run', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  try {
    const result = await runSavedSearch(token, Number(req.params.id));
    const data = result && result.data && typeof result.data === 'object' ? result.data : {};
    const params = queryParamsFrom(data.query_params && typeof data.query_params === 'object' ? data.query_params : {});
    return redirectTo(res, searchAdvancedUrl(params));
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    if (shouldRenderNotFound(error)) throw error;

    try {
      const savedResult = await getSavedSearches(token);
      const savedSearch = savedSearchById(savedResult, Number(req.params.id), res.locals.t);
      if (savedSearch !== null) {
        return redirectTo(res, searchAdvancedUrl(savedSearch.queryParams));
      }
    } catch {
      // Preserve the original run failure when the recovery read also fails.
    }

    throw error;
  }
}));

// Search results page
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const query = String(req.query.q || '').trim();
  const type = allowed(req.query.type, SIMPLE_SEARCH_TYPES, 'all');

  // If no query, show empty search page
  if (!query) {
    return res.render('search/index', {
      title: res.locals.t('search.title'),
      query: '',
      type: 'all',
      results: null
    });
  }

  try {
    const params = { q: query, type: SIMPLE_SEARCH_API_TYPES[type], per_page: 30 };
    const result = await searchV2(req.token, params);
    const results = simpleSearchResults(result?.data);
    const returnedTotal = results.length;
    const totalResults = intFrom(result?.meta?.search?.total) || returnedTotal;

    res.render('search/index', {
      title: res.locals.t('search.title'),
      query,
      type,
      results,
      totalResults,
      successMessage: req.flash ? req.flash('success')[0] : null,
      errorMessage: req.flash ? req.flash('error')[0] : null
    });
  } catch (error) {
    // Handle non-401 API errors by showing search page with error
    if (error instanceof ApiError && error.status !== 401) {
      return res.render('search/index', {
        title: res.locals.t('search.title'),
        query,
        type,
        results: [],
        totalResults: 0,
        errorMessage: null
      });
    }
    throw error; // Re-throw for asyncRoute to handle 401/503
  }
}));

module.exports = router;
