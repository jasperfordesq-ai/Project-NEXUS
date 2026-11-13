# Voice and tone — how the platform speaks to members

Last reviewed: 2026-11-13

Approved by the project owner on 13 November 2026. It applies to every word a member can be shown: the
React website, the accessible site (`web-uk`), the phone app, emails, notifications, and the server messages
the clients pass straight through.

## The voice in one line

**A kind neighbour who knows how the site works** — plain, warm, brief, and always ready with the next step.

## Why this is written down

A community site can look warm and still sound like a machine. Measured on 13 November 2026, in English, the
member-facing website text held 906 messages that read cold out of 22,135 — 458 beginning "Failed to…", 119
"…not found", 107 "Unable to…" and 70 bare "…is required". The phone app held 175, the accessible site 99,
and the server's own message files several hundred more that the clients show unchanged.

## The eight rules

1. **Say "we" and "you".** The site is people, not a system. "We couldn't save that" — not "Failed to save".
2. **Never blame the member.** "That code has run out" — not "Invalid code".
3. **Always give the next step.** A message that says something went wrong says what to do now.
4. **Name the thing in the member's words.** "Your offer", "this event" — not "listing", "resource", "item".
5. **Sentence case, no shouting.** No capitals for emphasis. One exclamation mark at most, and only for good
   news. No emoji in email subjects.
6. **The community's name, not the platform's.** A member belongs to their community. The platform's name
   appears in attribution and legal text, not in a greeting or a subject line.
7. **First names.** "Maeve would like to exchange with you" — the person, not "a user" or "New request".
   (Members never see another member's surname; see [ROLES-AND-PERMISSIONS.md](ROLES-AND-PERMISSIONS.md)
   for who may.)
8. **Short.** One sentence if it fits, two at most. Keep "please" for a real request, not as padding.

## What does not change

- **Safeguarding, legal and security wording keeps its exact meaning.** It is made kinder only where that
  changes nothing it says. A message that deliberately gives no detail — for example, a sign-in or
  registration refusal that must not reveal whether an address is registered — stays as vague as it is.
- **A label a member must press or type is never renamed in a message alone.** Rename the control and every
  message and help guide that quotes it in the same change (`guides.labels.test.ts` enforces the guides).
- **Staff screens** (admin, broker) may be more exact and more technical. This guide is about members.

## Examples

| Instead of | Write |
|---|---|
| Failed to save listing | We couldn't save your offer just now. Please try again. |
| Failed to load more events | We couldn't load more events. Try again in a moment. |
| Unable to Load Members | We couldn't load the members list |
| Something went wrong | That didn't work — sorry |
| An unexpected error occurred. Please try again or go back to the home page. | Something went wrong on our side. Try again, or go back to the home page. |
| Error | We couldn't load your wallet |
| Title is required | Give your offer a title |
| Location is required | Tell us roughly where you are |
| Invalid file type | We can't use that kind of file. Try a JPEG, PNG or WebP picture. |
| Failed to reset password. The link may have expired. | That link has run out. Ask for a new one and we'll send it straight away. |
| Cannot Request Exchange | You can't request this exchange yet |
| No events found | No events match that. Try a different date or kind. |
| No members found | Nobody matches that name. Check the spelling, or search by first name. |
| Offer or request not found | We can't find that offer or request. It may have been taken down. |
| New Exchange Request | Maeve would like to exchange with you |
| Your Weekly Digest from Project NEXUS | This week at Riverside Timebank |
| Exchange Completed! | Your exchange with Maeve is complete |
| We Miss You! | It's been a while — here's what's new |

## Translations

Every message exists in every language its client ships: eleven for the website, the accessible site and the
server (`ar`, `de`, `en`, `es`, `fr`, `ga`, `it`, `ja`, `nl`, `pl`, `pt`), seven for the phone app. The voice
is the same in each: the reader's own everyday register, addressed the way that language's existing text
already addresses them. Never copy the English into another language to satisfy a key-parity check.

## Writing a new message — a short test

Read it aloud as if to a neighbour at the door. If you would not say it that way, rewrite it. Then check:
does it say what happened, in their words, and what to do next?
