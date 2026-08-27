# Partner Demo App Review journey evidence

Last reviewed: 2026-08-27

Verified against production: 27 August 2026

The reviewer credentials are stored only in `.secrets.local/demo-login.env` and must be
copied into App Store Connect immediately before submission. They are not repeated here.
The verification session used the same mobile login endpoint as the app and was logged out.

## Live data available to the reviewer

- Dedicated reviewer account in **Partner Demo**, with no invitation, OTP, payment or
  location restriction.
- **43 other fictional members** in the tenant-scoped directory.
- **20 current feed items** on the first page.
- **18 active marketplace listings**.
- Confirmed physical-goods example: **Quiet room comfort box**, €24, like-new, local pickup,
  owned by fictional member Theo Walsh. It is not the reviewer account's own listing.
- Confirmed member safety example: **Sam Chen**, a fictional same-community member whose
  profile exposes the ordinary member Safety controls.
- Clean reusable baseline: **zero blocked members and zero purchase orders**. Sam Chen was
  not blocked at verification time.

All Partner Demo people, biographies, posts, listings and images are demonstration data;
the screenshots evidence records the owner confirmation for the generated portraits and
the absence of cross-community content.

## Reviewer walk

### Reporting

1. Open **Home**.
2. Open a feed card's overflow menu.
3. Select **Report**, choose a reason and submit.
4. The report goes to the Partner Demo moderation queue. Because the source content and
   people are fictional, this does not report a real member.

### Blocking and reversal

1. Open **Members** and search for **Sam Chen**.
2. Open the profile, then the **Safety** section and select **Block member**.
3. Confirm that contact is prevented.
4. Open **Settings > Blocked users** and unblock Sam before finishing, leaving the reusable
   reviewer account in its original state.

### Physical-goods checkout

1. Open **Marketplace** and search for **Quiet room comfort box**.
2. Open it and select **Buy now**.
3. The checkout identifies a fixed **€24** money price and **local pickup** for a physical,
   like-new item. The native money path uses Stripe PaymentSheet; it is not StoreKit and it
   does not purchase a digital entitlement.
4. Back out before placing the order unless Apple specifically needs to exercise a live
   production payment. Test-card numbers are not accepted by a live Stripe account.

### Account deletion

1. Open **Settings > Delete account**.
2. The app explains the permanent effects and requires the translated confirmation word
   plus the current password before enabling the destructive action.
3. The deletion endpoint is live. If Apple elects to complete deletion, do it as the final
   review action because the supplied login will immediately stop working. Contact the App
   Review contact for a replacement account if further access is needed.

## Re-verification immediately before submission

- Log in once using the protected credentials and Partner Demo selection.
- Confirm the named member and physical listing still exist and are accessible.
- Confirm the reviewer is not currently blocking Sam Chen and has no unfinished order.
- Confirm Settings still exposes account deletion.
- Log the verification session out.
- Put the credentials and review contact only in App Store Connect.
