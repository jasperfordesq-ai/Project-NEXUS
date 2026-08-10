// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const router = express.Router();

const pages = {};

const staticPaths = Object.keys(pages);

if (staticPaths.length > 0) {
  router.get(staticPaths, (req, res) => {
    const page = pages[req.path];
    res.render('static-page', {
      title: page.title,
      body: page.body,
      returnUrl: req.query.return || ''
    });
  });
}

module.exports = router;
module.exports.pages = pages;
