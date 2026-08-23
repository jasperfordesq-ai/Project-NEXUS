# Screen-reader test pack — accessible frontend

**Why this exists.** It is the largest single gap in
[CURRENT_WEBUK_PRODUCTION_STATUS.md](CURRENT_WEBUK_PRODUCTION_STATUS.md): **−30
points, "no screen-reader speech-output sign-off"**. Nothing in this repository
can close it. Automated tooling — axe, the 320px reflow checks, the structural
sweeps — catches roughly a third of real accessibility barriers, and none of it
can tell you whether a blind member can actually finish a task. A person has to
listen.

**Time needed:** about an hour for the core set. You do not need to be a screen
reader expert; the point is whether the speech makes sense, not whether you are
fast at it.

**What is already machine-checked, so you can ignore it:** axe (WCAG 2.0/2.1/2.2
A and AA) is clean on 33 signed-in pages, there are no duplicate ids, no
unlabelled form controls, no images without alt text, no skipped heading levels,
no links without an accessible name, and no page scrolls sideways at 320px.
**Do not re-check those.** Look for the things a machine cannot judge.

---

## Setting up (10 minutes)

**Windows — NVDA (free, recommended):** download from nvaccess.org, install,
start it with `Ctrl+Alt+N`. Stop it with `Insert+Q`. Turn on speech viewer
(NVDA menu → Tools → Speech Viewer) so you can *read* what it says — far easier
than listening and remembering.

**Mac — VoiceOver (built in):** `Cmd+F5` to start and stop. Turn on the caption
panel (VoiceOver Utility → Visuals → Caption Panel) for the same reason.

**Keys you need, and no more:**

| Action | NVDA | VoiceOver |
|---|---|---|
| Next item | `Down arrow` | `Ctrl+Alt+Right` |
| Next heading | `H` | `Ctrl+Alt+Cmd+H` |
| Next form field | `F` | `Ctrl+Alt+Cmd+J` |
| List all headings | `Insert+F7` | `Ctrl+Alt+U` |
| Activate | `Enter` | `Ctrl+Alt+Space` |
| Move by keyboard only | `Tab` | `Tab` |

Use **the live site**: https://accessible.project-nexus.ie — sign in as
yourself. Use a real community.

---

## The seven journeys

Do them in order. For each, the question is always the same: **could you have
done this with the screen on?** Write one line per journey in the results table
at the bottom.

### 1. Sign in
Start at the sign-in page with the screen reader on. Tab through and sign in.
- Is it clear what each field wants *before* you type in it?
- Deliberately submit with the password blank. **Is the error read out, and does
  it tell you which field and what to do?** (An error you cannot hear is the
  most common serious failure in any service.)

### 2. Find out what you have
Go to your dashboard, then your wallet.
- List the headings (`Insert+F7` / `Ctrl+Alt+U`). **Does the list alone tell you
  what is on the page?**
- On the wallet: **is your balance announced with its meaning** ("Time-credit
  balance, 100.0 hours") or as a bare number?

### 3. Read the community feed
Go to Feed.
- Move through two or three posts. **Can you tell where one post ends and the
  next begins?**
- Each post has Like and reaction buttons. **Do they say what they will do and
  what state they are in** — or just "button"?
- React to a post. **Is anything announced to confirm it worked?**

### 4. Offer something (the core task of the product)
Go to Listings → create a listing. Fill it in and save.
- **Does the form tell you what is required before you submit?**
- Submit it incomplete on purpose. **Are you told what is wrong, and can you get
  to the field that is wrong?**
- After saving: **are you told it worked**, or does the page just change?

### 5. Send a message
Go to Messages, find a member, send one.
- **Is it clear who you are writing to?**
- After sending, **is the sent message announced or discoverable?**

### 6. Change something about yourself
Go to Profile → settings. Change one field and save.
- The page has many sections. **Can you navigate between them by heading?**
- **Is the save confirmation announced?**

### 7. The way out
From any signed-in page, find and use "Sign out".
- **Could you find it without looking?**

---

## Also worth five minutes each

- **Skip link:** on any page, press `Tab` once from the very top. You should hear
  "Skip to main content". Press `Enter`. **Did focus actually move past the
  navigation?**
- **Language:** switch the site to Irish or Arabic, then listen to a page.
  **Does the screen reader pronounce it as that language**, or read it in an
  English voice? (This is the `lang` attribute doing its job or not.)
- **Windows high-contrast:** `Left Alt + Left Shift + Print Screen` toggles it.
  **Does anything disappear?** Particularly buttons, tags and the coloured
  status chips.

---

## What counts as a problem

Write it down if **any** of these happen. Do not try to judge severity — that is
our job, not yours.

- You could not complete a journey without looking at the screen.
- Something was announced as "button", "link", "clickable" or "graphic" with no
  useful name.
- An error happened and you were not told, or could not find what was wrong.
- Something succeeded and you were not told.
- The reading order jumped somewhere unexpected.
- You heard raw code — a translation key like `feed.item_types.post`, the word
  "undefined", or "null".
- The same thing was read twice in a row.
- You got stuck somewhere and could not `Tab` out.

## Results

Copy this in, fill it in, and hand it back. **"Fine" is a valid and useful
answer** — that is what sign-off means.

| # | Journey | Completed without looking? | What you heard that was wrong |
|---|---------|---------------------------|-------------------------------|
| 1 | Sign in | | |
| 2 | Dashboard and wallet | | |
| 3 | Feed | | |
| 4 | Create a listing | | |
| 5 | Send a message | | |
| 6 | Profile settings | | |
| 7 | Sign out | | |
| + | Skip link | | |
| + | Irish or Arabic | | |
| + | High contrast | | |

**Screen reader used:** ______  **Browser:** ______  **Date:** ______
**Signed off by:** ______

Anything found here becomes a fix with a regression test, exactly like every
other defect in this audit. Once this table is filled in and its findings are
closed, the −30 deduction can be closed against real evidence — and the
accessible frontend can honestly be called accessible, rather than "passes the
automated checks".
