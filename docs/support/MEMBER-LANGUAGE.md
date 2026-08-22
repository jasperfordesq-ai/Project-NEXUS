# Writing to Members

Last reviewed: 2026-08-22

The translation layer between how this repository describes the platform and how a member needs to hear about it. Everything else under `docs/` is written for developers and operators, correctly and precisely. This page is the exception: it exists because that precision, sent to a member, reads as evasion.

Applies to support replies, in-product copy, notification text and knowledge-base articles.

> `CLAUDE.md` establishes plain English for messages to the repository owner and explicitly exempts files under `docs/` so they keep their technical precision. **This page is a scoped exception to that exemption:** where a page carries member-facing copy, the rules below win.

---

## Who is on the other side

Community timebanking reaches people who did not choose a piece of software — they joined a community and the software came with it. Across the tenant communities that means a substantial share of members who:

- are older, or not confident with technology
- read on a phone, sometimes with a screen reader
- apologise for asking, and **under-report how stuck they are** — someone writing "sorry, it's probably me being silly" may have been locked out for a week
- worry they have broken something, or that their contributed hours are lost

The last point is the one to internalise. A wrong balance is not a data defect to a member; it is a question about whether their contribution counted.

---

## Never use these words with a member

Every term below is correct elsewhere in this repository and wrong in a member-facing message:

tenant · `tenant_id` · feature flag · module · module gate · cache · Redis · deploy · deployment · container · Docker · blue/green · API · endpoint · route · 500 · 403 · 503 · stack trace · Sentry · staging · SPA · webhook · middleware · idempotency · reversal transaction · scope

If a sentence needs one of these to work, the sentence is wrong. Describe what the member will see instead.

### Substitutions that carry the same meaning

| Instead of | Write |
| --- | --- |
| "the feature flag is disabled for your tenant" | "that isn't switched on for your community yet" |
| "your listing is in `pending` status" | "your offer was saved but it's waiting to be approved" |
| "the request returned a 500" | "something went wrong at our end" |
| "a duplicate was rejected by the idempotency guard" | "it only went through once — the second attempt was ignored" |
| "we'll reverse the transaction and re-post it" | "I'll correct the record and put the right hours back" |
| "credits" (when they said hours) | "hours" — use their word |

**Say "your hours" as readily as "your credits".** Both are correct; theirs is better.

---

## Rules

- Plain language. Short paragraphs. No headers.
- No bullet lists unless they are literal steps, one instruction at a time, in the order they appear on screen.
- Describe what they will see rather than a menu path: "tap the three lines at the top, then Wallet".
- Active voice, first person. "I'll look into it", not "this will be investigated".
- Specific dates, written out — "by Friday 28 August", never "shortly".
- Make clear that nothing they did caused the problem, when that is true.
- End by making it easy to come back.
- Irish and UK English: organisation, apologise, recognise.
- Never deflect to "the system" or "the platform" as though it belonged to someone else.
- One clear apology beats four. Over-apologising reads as alarm.

**Where credits are involved, say explicitly that nothing has been lost** — that is the sentence the member is waiting for. Only say it once you have checked the wallet history, and see the reversal caveats in `INTAKE-AND-TRIAGE.md` before promising a correction, because a reversal can leave a balance negative.

**Never describe credits as money, points or tokens.** One hour given earns one hour of credit whatever the task; that equality is the substance of the model, not a rounding convention.

**The test:** would this make sense read aloud to someone who has never opened a website's admin area?

---

## Adjust for the situation

**A new member.** Assume no familiarity with timebanking. One warm sentence if relevant: "one hour given earns one hour of credit, whatever the task."

**Someone who has written more than once.** Acknowledge the wait *first*, before the explanation, and say plainly they should not have had to chase. Then give a real answer or a real date — not another holding reply. Repeated contact from a less confident member means they are more stuck than they are saying.

**Asking for more detail.** Members find "please provide reproduction steps" baffling. Ask one thing at a time: what did you tap just before it happened · are you on your phone or a computer · could you send me a picture of what you're seeing · roughly what time was that. Never send six diagnostic questions to someone who apologised for writing in.

**A screenshot showing another member's details.** Do not copy it onward or quote it back. Describe it instead.

---

## Restriction banners: do not explain the cause

Where a conversation carries a messaging restriction or review notice, the flags behind it are deliberately **cause-agnostic** so that a reader cannot tell whose supporter — or whether a coordinator — is involved (`../SAFEGUARDING-AND-CONSENT.md`).

Support must preserve that. Explain *that* a conversation is subject to review; never *why*, or on whose behalf. Volunteering an explanation defeats a designed privacy boundary.

Note also that broker message copying is tenant-controlled but **on by default** — a tenant must explicitly disable it (`../modules/messaging.md`).

---

## Writing to operators is a different register

Tenant operators, partner organisations and public-sector customers are the audience this repository's other pages already suit. Panel paths and flag names are welcome there — precision reads as competence, and these messages get forwarded internally, so they must stand alone without the thread.

Two constraints regardless of register:

- **Never state an accessibility or compliance conformance position without the operator's own sign-off.** Those claims are contractual. Describe the behaviour and what will change instead.
- **Never commit a date, price or contract term** in a support reply.

## Related

- `INTAKE-AND-TRIAGE.md` — establishing the facts before replying
- `SUPPORT-REPORTS.md` — the in-product report a member may be quoting
