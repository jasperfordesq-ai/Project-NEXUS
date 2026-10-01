// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Input, type InputProps } from '@/components/ui';

/**
 * A masked admin field for a secret that is NOT the signed-in admin's own
 * login password: an API key, SMTP password, OAuth client secret, or a new
 * password being set for someone else.
 *
 * A bare `type="password"` input makes Chrome treat the page as a login form.
 * It then fills the admin's saved password into this field and their saved
 * email into the nearest preceding text input — the sidebar search — and the
 * filled password is saved as the secret if the admin presses Save.
 * `autoComplete="new-password"` stops Chrome filling a stored credential here;
 * the data attributes do the same for 1Password, LastPass and Bitwarden.
 *
 * Pass `type="text"` for a show/hide toggle; the fill guard stays either way.
 */
export function SecretInput({ type = 'password', ...props }: InputProps) {
  return (
    <Input
      {...props}
      type={type}
      autoComplete="new-password"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
    />
  );
}
