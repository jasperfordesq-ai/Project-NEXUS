// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { sendAiChat, getAiConversations, getAiConversation, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function normaliseConversationId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function conversationIdFrom(result) {
  const data = result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : result;
  const id = data && data.conversation_id;
  return normaliseConversationId(id);
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.conversations)) return data.conversations;
  return [];
}

function normalizeConversation(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const id = normaliseConversationId(raw.id);
  return {
    id,
    title: String(raw.title || raw.first_message || '').trim(),
    updated_at: raw.updated_at || raw.updatedAt || raw.created_at || raw.createdAt || ''
  };
}

function normalizeMessage(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const role = raw.role === 'user' ? 'user' : 'assistant';
  return {
    id: raw.id || `${role}-${String(raw.content || '').slice(0, 12)}`,
    role,
    content: String(raw.content || ''),
    created_at: raw.created_at || raw.createdAt || ''
  };
}

function messagesFrom(result) {
  const data = dataFrom(result);
  if (data && Array.isArray(data.messages)) return data.messages.map(normalizeMessage);
  if (data && data.conversation && Array.isArray(data.conversation.messages)) {
    return data.conversation.messages.map(normalizeMessage);
  }
  return [];
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const selectedId = normaliseConversationId(req.query.c);
  let conversations = [];
  let messages = [];
  let apiError = null;
  let currentConversationId = selectedId;

  try {
    conversations = collectionFrom(await getAiConversations(token, { limit: 20 }))
      .map(normalizeConversation)
      .filter((conversation) => conversation.id !== null);

    if (selectedId !== null) {
      try {
        messages = messagesFrom(await getAiConversation(token, selectedId));
      } catch (error) {
        if (isAuthError(error)) throw error;
        currentConversationId = null;
      }
    }
  } catch (error) {
    if (isAuthError(error)) throw error;
    apiError = true;
  }

  return res.render('ai-chat/index', {
    title: 'AI assistant',
    titleKey: 'govuk_alpha_aichat.title',
    activeNav: 'explore',
    conversations,
    messages,
    selectedId: currentConversationId,
    status: String(req.query.status || ''),
    apiError
  });
}));

router.post('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const message = String(req.body.message || '').trim().slice(0, 4000);
  if (message === '') {
    return redirectTo(res, '/chat?status=empty');
  }

  const payload = { message };
  const conversationId = normaliseConversationId(req.body.conversation_id);
  if (conversationId !== null) {
    payload.conversation_id = conversationId;
  }

  let status = 'sent';
  let nextConversationId = conversationId;

  try {
    const result = await sendAiChat(token, payload);
    nextConversationId = conversationIdFrom(result) || nextConversationId;
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'failed';
  }

  const query = new URLSearchParams();
  if (nextConversationId !== null) {
    query.set('c', String(nextConversationId));
  }
  query.set('status', status);

  return redirectTo(res, `/chat?${query.toString()}`);
}));

module.exports = router;
