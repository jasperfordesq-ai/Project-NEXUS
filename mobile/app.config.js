// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Dynamic Expo config, evaluated at build time by EAS.
// Static defaults live in app.json; this file adds environment-specific values.

const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? null;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const notificationIcon = './assets/notification-icon.png';
  const hasGoogleServicesFile = path.isAbsolute(googleServicesFile)
    ? fs.existsSync(googleServicesFile)
    : fs.existsSync(path.join(__dirname, googleServicesFile));
  const hasNotificationIcon = fs.existsSync(path.join(__dirname, notificationIcon));
  const plugins = [...(config.plugins ?? [])];

  const hasPlugin = (name) => plugins.some((plugin) => {
    return Array.isArray(plugin) ? plugin[0] === name : plugin === name;
  });

  if (!hasPlugin('expo-font')) {
    plugins.push('expo-font');
  }

  if (!hasPlugin('@react-native-community/datetimepicker')) {
    plugins.push('@react-native-community/datetimepicker');
  }

  const notificationsPluginIndex = plugins.findIndex((plugin) => {
    return Array.isArray(plugin) ? plugin[0] === 'expo-notifications' : plugin === 'expo-notifications';
  });

  if (notificationsPluginIndex >= 0 && hasNotificationIcon) {
    const notificationsPlugin = plugins[notificationsPluginIndex];
    plugins[notificationsPluginIndex] = [
      'expo-notifications',
      {
        ...(Array.isArray(notificationsPlugin) ? notificationsPlugin[1] ?? {} : {}),
        icon: notificationIcon,
      },
    ];
  }

  if (!hasPlugin('@stripe/stripe-react-native')) {
    plugins.push([
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: '',
        enableGooglePay: false,
      },
    ]);
  }

  return {
    ...config,
    plugins,
    ios: {
      ...config.ios,
      infoPlist: {
        ...(config.ios?.infoPlist ?? {}),
        CFBundleAllowMixedLocalizations: true,
      },
    },
    android: {
      ...config.android,
      ...(hasGoogleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...(config.extra ?? {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.project-nexus.ie',
      defaultTenant: process.env.EXPO_PUBLIC_DEFAULT_TENANT ?? 'hour-timebank',
      ...(projectId ? { eas: { projectId } } : {}),
    },
    ...(projectId
      ? {
          updates: {
            ...config.updates,
            url: `https://u.expo.dev/${projectId}`,
          },
        }
      : {}),
  };
};
