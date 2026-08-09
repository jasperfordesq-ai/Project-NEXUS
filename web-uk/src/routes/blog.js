// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getBlogPosts, getBlogPost } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { normalizeResponse } = require('../lib/normalizeResponse');

const router = express.Router();

router.use(requireAuth);

// List blog posts
router.get('/', asyncRoute(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const category = req.query.category || null;

  const result = await getBlogPosts(req.token, { page, limit: 20, category });

  const posts = (result.items || result.data || []).map(normalizeResponse);

  res.render('blog/index', {
    title: 'Blog',
    posts,
    category,
    pagination: result.pagination || { page, totalPages: 1 },
    successMessage: req.flash ? req.flash('success')[0] : null
  });
}));

// View blog post
router.get('/:id', asyncRoute(async (req, res) => {
  const result = await getBlogPost(req.token, req.params.id);
  const post = normalizeResponse(result.post || result);

  res.render('blog/detail', {
    title: post.title || 'Blog post',
    post,
    successMessage: req.flash ? req.flash('success')[0] : null
  });
}, { notFoundTitle: 'Blog post not found' }));

module.exports = router;
