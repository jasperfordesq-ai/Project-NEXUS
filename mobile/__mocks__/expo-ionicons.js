// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const React = require('react');
const { View } = require('react-native');
const glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');

function MockIonicons(props) {
  return React.createElement(View, props);
}

MockIonicons.glyphMap = glyphMap;

module.exports = MockIonicons;
module.exports.default = MockIonicons;
module.exports.glyphMap = glyphMap;
