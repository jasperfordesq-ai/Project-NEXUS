// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Route } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { lazyWithRetry } from './lazyWithRetry';

const LoginPage = lazyWithRetry(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazyWithRetry(() => import('@/pages/auth/RegisterPage'));
const ForgotPasswordPage = lazyWithRetry(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazyWithRetry(() => import('@/pages/auth/ResetPasswordPage'));
const VerifyEmailPage = lazyWithRetry(() => import('@/pages/auth/VerifyEmailPage'));
const VerifyIdentityPage = lazyWithRetry(() => import('@/pages/auth/VerifyIdentityPage'));
const OauthCallbackPage = lazyWithRetry(() => import('@/pages/auth/OauthCallbackPage'));

const TwoFactorSetupPage = lazyWithRetry(() => import('@/pages/auth/TwoFactorSetupPage'));

export function AuthRoutes() {
  return (
    <Route element={<AuthLayout />}>
      <Route path="auth/two-factor/setup" element={<TwoFactorSetupPage />} />
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route path="password/forgot" element={<ForgotPasswordPage />} />
      <Route path="password/reset" element={<ResetPasswordPage />} />
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="verify-identity" element={<VerifyIdentityPage />} />
      <Route path="auth/oauth/callback" element={<OauthCallbackPage />} />
    </Route>
  );
}
