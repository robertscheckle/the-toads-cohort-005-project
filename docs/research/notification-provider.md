# Research: third-party provider for in-app Notifications

## Question

Which third-party service should deliver Cadence's in-app Notifications? A Notification is a message shown inside Cadence to one Student, Instructor or Admin, triggered by events in the app.

Constraints:

- Cadence runs React Router 8.3 framework mode with SSR on Node, React 19, SQLite/Drizzle, and shadcn/ui + lucide-react + sonner.
- Transactional email stays on Postmark. The provider should be in-app only.
- Push and SMS are out of scope, but we note whether each provider could add them later.
- Scale is a few thousand users and low tens of thousands of Notifications a month.

## Date researched

2026-11-12. Every page cited below was read on that date. npm versions come from `npm view` and unpkg on the same date.

## TL;DR recommendation

Shortlist:

1. **Knock** is the primary pick.
   - It has the most complete in-app feed. Notifications carry `seen`, `read`, `archived` and `interacted` states, there are bulk mark-all actions, and preferences can be set per workflow, per category or per channel.
   - Its React package ships with a `"use client"` banner. Its Node SDK can read a user's feed on the server (`users.feeds.listItems`), so a React Router `loader` could pre-render the unread count or the first page.
   - Batch (digest) is included on the **Free** plan. It also has idempotency keys, cancellation keys, and outbound webhooks for every engagement change.
   - The pricing page lists feed retention as **unlimited on all plans**.
   - Costs: Free covers 10,000 messages a month. Past that, Starter costs **$250/month**, which is steep for Cadence's volume.
   - It has no self-hosting and no offline mode. Local dev and CI need a Knock development environment, or a mock behind a Cadence-owned interface.
2. **Novu** is the runner-up.
   - Choose it if cost or self-hosting matters more than polish. Its core is MIT-licensed and self-hostable with Docker Compose, which also gives a fully offline local and CI target.
   - Pro starts at **$30/month for 30,000 workflow runs**.
   - It can permanently delete individual Notifications, and it has mark-all-read, archive-all and snooze.
   - Trade-offs:
     - Inbox retention is 30 days on Free and 90 days on Pro and Team.
     - The Free plan allows only 5 workflows and caps digest windows at 1 day.
     - Outbound webhooks require Team ($250/month and up).

The others were not shortlisted:

- **Courier** puts digest and batching on its Enterprise plan only.
- **SuprSend** gates batching, digest and user preferences behind its $250 Business plan.
- **MagicBell** documents no digest feature and gives no retention figures.
- **Liveblocks Notifications** is surprisingly strong on data control: delete, in-place batching, server-side fetch, and email via webhook that could go to Postmark. However, its React hooks **poll for new Notifications every 1 minute** rather than pushing them.
- **Stream Activity Feeds** and **OneSignal** were excluded. See the "Excluded" section.

## Comparison table

|                          | Knock                                                                                 | Novu                                                                                                      | Courier                                              | MagicBell                                                   | SuprSend                                                    | Liveblocks                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Hosted feed              | Yes                                                                                   | Yes (Inbox)                                                                                               | Yes (Inbox)                                          | Yes (Inbox)                                                 | Yes (Inbox)                                                 | Yes (Inbox Notifications)                                   |
| States                   | seen, read, archived, interacted                                                      | read, seen (one-way), archived, snoozed                                                                   | read, opened, archived                               | read, seen, archived                                        | seen, read, archived, clicked, pinned, expiry               | read (`readAt`)                                             |
| Mark all read            | `markAllAsRead`, `markAllAsSeen`, `markAllAsArchived`; server bulk by channel         | `readAll`, `archiveAll`, `archiveAllRead`, `seenAll`; REST `POST /v2/subscribers/{id}/notifications/read` | `readAllMessages()`                                  | "mark all read", "mark all seen", "archive all"             | `markAllAsRead` not on the page read (unverified)           | `useMarkAllInboxNotificationsAsRead`                        |
| Per-type prefs           | workflows, categories, channels, channel types                                        | global + per workflow; tags and groups                                                                    | Preference topics                                    | by channel and category                                     | Preferences (Business plan)                                 | per kind and channel (beta)                                 |
| Live updates             | WebSocket (Phoenix channels); `new-message` event may be throttled and has no content | WebSocket (PartySocket on cloud, socket.io on self-hosted)                                                | WebSocket after `listenForUpdates()`                 | Persistent connection (`reconnecting-websocket` dependency) | socket.io                                                   | **Polling every 1 min**                                     |
| React                    | `@knocklabs/react` 0.15.1 (components + hooks), `@knocklabs/react-core` 0.17.1        | `@novu/react` 3.19.2 (components + hooks)                                                                 | `@trycourier/courier-react` 9.3.5                    | `@magicbell/react` 1.14.0                                   | `@suprsend/react` 1.5.0 (drop-in + headless)                | `@liveblocks/react` + `@liveblocks/react-ui` 3.25.0         |
| SSR                      | Package ships `"use client"`; feed readable server-side via Node SDK                  | "Inbox component is client-side only"; server REST v1 feed deprecated, v2 list unverified                 | "render client-side only"                            | Not documented                                              | Not documented                                              | `ClientSideSuspense`; server `getInboxNotifications`        |
| Client auth              | Public key + RS256 JWT (`signUserToken`)                                              | `applicationIdentifier` + HMAC-SHA256 `subscriberHash`                                                    | JWT from `POST /auth/issue-token` (scoped)           | HS256 user JWT                                              | Public key + ES256 JWT                                      | `authEndpoint` access/ID token                              |
| Server SDK               | `@knocklabs/node` 1.41.1                                                              | `@novu/api` 3.19.1                                                                                        | `@trycourier/courier` 10.0.0                         | `magicbell-js` 1.8.0                                        | `@suprsend/node-sdk` 1.15.1                                 | `@liveblocks/node` 3.25.0                                   |
| Idempotency              | `Idempotency-Key`, 24 h, trigger only                                                 | `Idempotency-Key`, 24 h, POST/PATCH                                                                       | `Idempotency-Key`, 25 h default, up to 1 yr          | `Idempotency-Key`, 24 h, some endpoints                     | `idempotency_key`, 24 h                                     | Not found                                                   |
| Digest/batch             | Batch step, all plans                                                                 | Digest step, all plans (max 1 d Free, 7 d Pro, 30 d Team)                                                 | **Enterprise only**                                  | No native feature found                                     | **Business plan only**                                      | `subjectId` batching, up to 50 activities, updates in place |
| Cancellation             | `cancellation_key` (paused runs only)                                                 | Cancel by `transactionId`                                                                                 | Cancel message "still in the delivery pipeline"      | Not found                                                   | Cancel by filters incl. `idempotency_key`                   | n/a                                                         |
| Retention                | Feed **unlimited**, configurable                                                      | Inbox 30 d Free, 90 d Pro/Team                                                                            | Until archived or `expiresAt`; plan figure not found | Not stated                                                  | Not stated for inbox (log 30/90 d)                          | Not stated                                                  |
| Update/delete after send | Content immutable; archive; bulk `delete` action in SDK types                         | **Delete** single/all; no content update                                                                  | `expiresAt`; archive (effect on Inbox unverified)    | Archive; UI "delete"                                        | Archive; expiry auto-deletes; no delete endpoint            | **Delete**; batching updates in place                       |
| Webhooks                 | Yes, incl. `message.read/seen/archived`                                               | Team and Enterprise only                                                                                  | Delivery webhook                                     | Not found                                                   | Outbound webhook (page exists, not read)                    | Yes, incl. notification event                               |
| Self-host                | No                                                                                    | Yes, MIT core (Docker)                                                                                    | No                                                   | No                                                          | Enterprise licence only                                     | No                                                          |
| Free tier                | 10k messages/mo                                                                       | 10k runs/mo, 5 workflows                                                                                  | 10k sends/mo                                         | 1k deliveries/mo                                            | 10k notifications/mo (branded feed)                         | 200 custom notification events/mo                           |
| Small-scale price        | Starter $250/mo incl. 50k, then $0.005                                                | Pro from $30/mo, 30k runs, $1.20/1k over                                                                  | $0.005/send from the first send (20k = $100)         | Startup $249/mo incl. 50k                                   | Essentials $100/mo (50k, no digest/prefs); Business $250/mo | Pro $30/mo + $0.005/custom notification                     |
| Email omittable          | Yes (channel steps)                                                                   | Yes (steps)                                                                                               | Yes (`channels: ["inbox"]`)                          | Yes                                                         | Yes                                                         | In-app native; email only via webhook                       |
| Push/SMS later           | Yes                                                                                   | Yes                                                                                                       | Yes                                                  | Yes                                                         | Yes                                                         | Web Push channel via webhook; no SMS                        |

## Knock

**In-app feed**

- Feeds are per-user lists of in-app messages, returned in reverse chronological order with unread, read and seen counts. Messages can be "marked as unread, read, seen, or archived", and the client can record interactions. https://docs.knock.app/in-app-ui/feeds/overview
- Content cannot be edited after Knock generates it: "its content and other metadata can't be changed once Knock generates it." To change it, archive the message and retrigger. https://docs.knock.app/in-app-ui/feeds/overview
- The JS feed client has `markAllAsRead`, `markAllAsSeen` and `markAllAsArchived`. Each "is deferred and may take some time to process all items". https://docs.knock.app/in-app-ui/javascript/sdk/feed-client
- Server-side bulk status updates by channel go through `client.channels.bulk.updateMessageStatus(channelId, action, filters)`.
  - Actions: `seen`, `unseen`, `read`, `unread`, `archived`, `unarchived`, `interacted`, `archive`, `unarchive`, `delete`.
  - Filters: `recipient_ids`, `workflows`, `trigger_data`, `older_than`, and others.
  - Source: `@knocklabs/node@1.41.1` typings at https://unpkg.com/@knocklabs/node@1.41.1/resources/channels/bulk.d.ts
  - The `delete` action appears in the SDK types. We did not find it in prose docs.
  - The Messages API documents no single-message delete or content update. https://docs.knock.app/api-reference/messages
- Preferences use four keys: `categories`, `channels`, `channel_types` and `workflows`. Unset preferences default to `true`. Knock offers a hosted preference page, or you can build a custom one on the API. https://docs.knock.app/preferences/overview

**Live updates**

- Clients "receive notifications over a websocket". https://docs.knock.app/in-app-ui/feeds/overview
- The `new-message` event "Might be throttled" and "Will not contain the full message contents, but will include metadata about the updated badge counts". https://docs.knock.app/in-app-ui/api-overview
- The client uses the `phoenix` 1.8.9 socket library (`npm view @knocklabs/client dependencies`).

**React**

- `@knocklabs/react` 0.15.1 (MIT) provides `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`. It can also be used "in a headless way". https://docs.knock.app/in-app-ui/react/overview
- Headless hooks include `useKnockClient`, `useNotifications` and `useNotificationStore`. https://docs.knock.app/in-app-ui/react/headless/feed
- Setup uses `KnockProvider` (`apiKey`, `user`, `userToken`) and `KnockFeedProvider` (`feedId`), plus a CSS import from `@knocklabs/react/dist/index.css`. "By default the feed will mark all items as seen when the feed popover opens." https://docs.knock.app/in-app-ui/react/feed
- SSR:
  - The docs do not discuss SSR.
  - The ESM build begins with `"use client";` (https://unpkg.com/@knocklabs/react@0.15.1/dist/esm/index.mjs), so treat the components as client-only.
  - The feed can be read on the server with `client.users.feeds.listItems(userId, channelId)`. The endpoint notes say: "When making this call from a client-side environment, use your publishable key along with a user token" (https://unpkg.com/@knocklabs/node@1.41.1/resources/users/feeds.d.ts and https://docs.knock.app/api-reference/users/feeds/list_items).
  - The response includes `meta.unread_count` and `meta.unseen_count`, which suits a loader.

**Auth**

- Use a public key plus a signed user token in "enhanced security mode". The token is a JWT "signed against your private signing key using an RS256 algorithm", made with `signUserToken(user.id, { expiresInSeconds })` from `@knocklabs/node`. https://docs.knock.app/in-app-ui/security-and-authentication
- Without enhanced security, "a request with your public key can act as any user".

**Triggering**

- `@knocklabs/node` 1.41.1 (Apache-2.0) provides `workflows.trigger(key, { cancellation_key, ... })` and `workflows.cancel(key, ...)`. https://unpkg.com/@knocklabs/node@1.41.1/resources/workflows.d.ts
- Idempotency uses the `Idempotency-Key` header, up to 255 chars, valid 24 hours. "Only `POST /workflows/:key/trigger`" honours it. https://docs.knock.app/api-reference/overview/idempotent-requests
- Batch:
  - Window types: fixed, dynamic, relative or sliding. A batch key splits batches further.
  - Template variables: `total_activities`, `total_actors`, and the first or last 10 `activities`.
  - Limits: maximum window 90 days; activity limit 2–1000.
  - Feed items are generated when the batch closes. https://docs.knock.app/designing-workflows/batch-function
  - Batch is included on Free, Starter and Enterprise. https://knock.app/pricing
- Cancellation only works on "workflows with a step that can pause the run" (batch, delay, wait-for-event, fetch). It "will stop the workflow from sending new messages", but already-delivered in-app messages must be archived instead. https://docs.knock.app/send-notifications/canceling-workflows

**Data ownership**

- Feed retention is "Unlimited on all plans, and configurable". Logs are kept 30 days on Free and Starter, and 90 days on Enterprise. https://knock.app/pricing
- Outbound webhook events include `message.sent`, `message.delivered`, `message.seen`, `message.unseen`, `message.read`, `message.unread`, `message.archived`, `message.unarchived` and `message.interacted`. These let Cadence mirror read state. https://docs.knock.app/developer-tools/outbound-webhooks/event-types
- The plan availability of outbound webhooks is not stated on the pricing page.

**Pricing**

| Plan    | Price   | Messages                          |
| ------- | ------- | --------------------------------- |
| Free    | $0      | 10,000 messages/mo                |
| Starter | $250/mo | 50,000 included, then $0.005 each |

- A message is "one delivery to one user on one channel". Profiles are unlimited.
- Free shows Knock branding.
- Environments and workflows are unlimited on every plan.
- Source: https://knock.app/pricing

**Local dev and testing**

- Knock uses separate environments: development and production, plus custom ones, each with its own keys. https://docs.knock.app/concepts/environments
- The workflow test runner and `sandbox_mode` "generates and previews the messages without delivering them". You can set it via API `settings.sandbox_mode`, and the CLI has a `workflow run` command. https://docs.knock.app/send-notifications/testing-workflows
- No offline mode or official mock is documented. Tests without network would need Cadence to wrap Knock behind its own interface.

**Other**

- Knock is not open source and cannot be self-hosted.
- Push, SMS and chat channels exist (https://docs.knock.app/designing-workflows/channel-step). Email is just one optional channel step.

## Novu

**In-app feed**

- `@novu/js` notification actions:
  - Read state: `read` and `unread`.
  - Seen state: `seen` is one-way, with no "unseen". Bulk: `seenAll`.
  - Archive: `archive`, `unarchive`, `archiveAll` and `archiveAllRead`.
  - Bulk read: `readAll`.
  - Snooze: `snooze` and `unsnooze`.
  - Deletion: `delete` and `deleteAll`.
  - Retrieval: `list` and `count`.
  - Source: https://docs.novu.co/platform/sdks/javascript
- Server REST endpoints:
  - Mark all read: `POST /v2/subscribers/{subscriberId}/notifications/read`, with tag and data filters. https://docs.novu.co/api-reference/subscribers/mark-all-notifications-as-read.md
  - Delete one Notification permanently: `DELETE /v2/subscribers/{subscriberId}/notifications/{notificationId}`. https://docs.novu.co/api-reference/subscribers/delete-a-notification.md
  - No content-update endpoint was found.
- Preferences are global plus per workflow. Critical workflows cannot be turned off. `preferenceGroups` and tags let you group workflows into categories. https://docs.novu.co/platform/inbox/configuration/preferences

**Live updates**

- `socketType: 'cloud'` uses PartySocket over WebSocket, and `'self-hosted'` uses socket.io-client.
- Events include `notifications.notification_received` and `notifications.unread_count_changed`.
- Source: https://docs.novu.co/platform/sdks/javascript

**React**

- `@novu/react` 3.19.2 provides the `Inbox`, `Bell`, `Notifications`, `InboxContent` and `Subscription` components, plus headless hooks. It needs React 18 or later. https://docs.novu.co/platform/sdks/react, https://docs.novu.co/platform/inbox/overview
- "The Inbox component is client-side only." https://docs.novu.co/.mintlify/skills/inbox-integration/references/nextjs-inbox-examples.md
- The v1 server feed `GET /v1/subscribers/{id}/notifications/feed` is deprecated: "use v2 API instead". https://docs.novu.co/api-reference/subscribers/retrieve-subscriber-notifications.md
- We could not confirm the exact v2 list endpoint.
- Keyless mode (`<Inbox />` with no props) is for testing only: "data is temporary (expires in 24h)". https://docs.novu.co/platform/inbox/setup-inbox

**Auth**

- Use `applicationIdentifier` plus `subscriberHash = HMAC-SHA256(secretKey, subscriberId)` in hex. "If HMAC is enabled and `subscriberHash` is missing, the Inbox will not load." https://docs.novu.co/platform/inbox/prepare-for-production

**Triggering**

- Use `@novu/api` 3.19.1. The legacy `@novu/node` is at 2.6.6.
- Idempotency uses the `Idempotency-Key` header on POST and PATCH. Responses are cached 24 h, and in-progress requests are held for 5 min. https://docs.novu.co/api-reference/idempotency.md
- Cancel by `transactionId` cancels "any active or pending workflows … useful to cancel active digests, delays". https://docs.novu.co/api-reference/events/cancel-triggered-event.md
- Digest:
  - Types are regular (look-back) or timed (cron). Group by a key such as `payload.projectId`.
  - Template variables: `steps.<id>.events` and `steps.<id>.eventCount`. https://docs.novu.co/.mintlify/skills/dashboard-workflows/references/digest-step.md
  - Maximum digest window: 1 day on Free, 7 days on Pro, 30 days on Team. https://docs.novu.co/platform/developer/limits

**Data ownership**

- Inbox feed retention: 30 days on Free, 90 days on Pro and Team, custom on Enterprise. Activity feed retention: 1, 7 and 90 days. https://docs.novu.co/platform/developer/limits
- The pricing page says the Free activity feed keeps 24 hours. https://novu.co/pricing
- "Outbound webhooks feature is only available in the Team and Enterprise plans." https://docs.novu.co/platform/developer/webhooks.md

**Pricing**

| Plan | Price        | Runs/mo  | Workflows | Activity feed |
| ---- | ------------ | -------- | --------- | ------------- |
| Free | $0           | 10,000   | 5         | 24 h          |
| Pro  | from $30/mo  | 30,000+  | 20        | 7 d           |
| Team | from $250/mo | 250,000+ | 100       | 90 d          |

- Overage is $1.20 per 1,000 runs.
- The workflow counts for Pro and Team come from a flattened table and may be misaligned.
- The metered unit is the "workflow run". Exactly how digest and channel steps count was not captured.
- Source: https://novu.co/pricing

**Self-hosting and licence**

- The repo has a `LICENSE-MIT` file. The README says the core is "licensed under MIT license" and the `enterprise` folder is under a commercial licence. https://github.com/novuhq/novu (README "License" section; files `LICENSE-MIT`, `LICENSE-ENTERPRISE`)
- Docker Compose runs the API, Worker, Dashboard, WebSocket, MongoDB and Redis. It supports `npx novu dev` against localhost. https://docs.novu.co/community/self-hosting-novu/deploy-with-docker
- The Community edition lacks Snooze, branding removal, more than two environments and SSO. It is limited to 1 team member. https://docs.novu.co/community/self-hosted-and-novu-cloud
- Cloud "Self-hosted" deployment on the pricing page refers to the Enterprise on-prem edition.

**Local dev**

- `npx novu dev` runs Studio on `localhost:2022` plus a tunnel "so Novu Cloud can reach your machine". https://docs.novu.co/.mintlify/skills/framework-integration/references/studio-and-cli.md
- Offline testing is possible against a local Docker install.

**Push/SMS later:** Yes. All channels are on every plan. https://novu.co/pricing

## Courier

**In-app feed**

- "Every state change (read, opened, archived) syncs instantly across a user's signed-in devices." https://www.courier.com/docs/platform/inbox/inbox-overview
- Web actions: `readAllMessages()`, `archiveMessage` and `unarchiveMessage`, `totalUnreadCount`, `openMessage` and `clickMessage`. https://www.courier.com/docs/in-app/build-a-custom-inbox.md
- Feeds and tabs filter on `tags`, `archived`, `status` and `from`. https://www.courier.com/docs/sdk-libraries/courier-react-web.md
- "A message stays in the feed until it is archived or expires", and `expiresAt` drops it from the feed. https://www.courier.com/docs/in-app/how-the-inbox-behaves.md
- Preferences use topics, with a `<CourierPreferences />` component. https://www.courier.com/docs/sdk-libraries/courier-react-web.md

**Live updates**

- You must call `inbox.listenForUpdates()`, which opens a WebSocket. Without it, the inbox "loads once and doesn't update". https://www.courier.com/docs/sdk-libraries/courier-react-web.md

**React and SSR**

- `@trycourier/courier-react` 9.3.5 (MIT) provides `CourierInbox`, `CourierInboxPopupMenu`, `CourierToast` and the `useCourier()` hook.
- "Courier Inbox and Toast support Next.js but render client-side only." https://www.courier.com/docs/sdk-libraries/courier-react-web.md
- No server-side Inbox fetch is documented. https://www.courier.com/docs/in-app/build-a-custom-inbox.md

**Auth**

- The backend calls `POST /auth/issue-token` with scopes such as `user_id:<id> inbox:read:messages inbox:write:events`. "Omitting [expires_in] mints a token that never expires." https://www.courier.com/docs/in-app/authenticate-users.md

**Triggering**

- Use `@trycourier/courier` 10.0.0 (Apache-2.0).
- For in-app only, route with `routing: { method: "single", channels: ["inbox"] }`. https://www.courier.com/docs/in-app/send-to-the-inbox.md
- Idempotency uses the `Idempotency-Key` header, POST only. Responses replay for 25 h by default, extendable to 1 year with `x-idempotency-expiration`. https://www.courier.com/docs/reference/api-overview.md
- Cancel cancels a message "still in the delivery pipeline". https://www.courier.com/docs/api-reference/messages/cancel-message.md
- Digest and batching: topic digests, an "Add to digest" node and a Batch node exist. https://www.courier.com/docs/guides/send-a-daily-digest.md
- However, "Digest & batching" appears **only in the Enterprise plan's feature list**. https://www.courier.com/pricing

**Pricing**

- Developer is free for 10,000 sends a month.
- Business costs $0.005 per send, applied to every send including the first 10,000. One send is one template to one recipient, regardless of channels.
- Test environments count as usage.
- Source: https://www.courier.com/pricing

**Testing**

- Keys are per environment: "a Test key only reads and writes Test data." https://www.courier.com/docs/reference/api-overview.md

**Other**

- Courier is not self-hostable.
- Push and SMS are available.
- Archiving through the Messages API "remove[s] … from the message list without deleting them". Its effect on a recipient's Inbox is not stated. https://www.courier.com/docs/api-reference/messages/archive-message.md

## MagicBell

**In-app feed**

- The Inbox "supports read/unread states, pagination, and real-time updates". Users can "view, mark as read, archive, and delete notifications". Preferences can be set "by channel … and by notification category". https://www.magicbell.com/docs/channels/in_app
- Notifications have `sent_at`, `read_at` and `seen_at` timestamps. https://www.magicbell.com/docs/primitive/notification

**React**

- `@magicbell/react` 1.14.0 provides a Provider, `Inbox`, `FloatingInbox`, `UserPreferences` and `ToastContainer`. It takes a `token` prop holding a User JWT. https://www.magicbell.com/docs/libraries/magicbell-react
- Its dependencies include `reconnecting-websocket` (from `npm view`).
- SSR is not documented.
- The older `@magicbell/magicbell-react` 11.5.1 carries the licence string "SEE LICENSE IN LICENSE".

**Auth**

- "User JWTs must be signed with your project's Secret Key using the HS256 algorithm", with claims `api_key` plus `user_external_id` or `user_email`. https://www.magicbell.com/docs/api/authentication/user

**API**

- The v2 base URL is `https://api.magicbell.com/v2`. The rate limit is 500 requests/min per IP.
- `Idempotency-Key` caches responses for 24 h on "some endpoints".
- Source: https://www.magicbell.com/docs/api
- A broadcast is created with `POST /broadcasts`. https://www.magicbell.com/docs/api/reference

**Gaps**

- No native digest feature was found in the docs. Search found only a blog pattern.
- No retention figure was found. https://www.magicbell.com/docs/channels/in_app

**Pricing**

| Plan    | Price   | Deliveries/mo | Overage                    |
| ------- | ------- | ------------- | -------------------------- |
| Builder | $0      | 1,000         | —                          |
| Startup | $249/mo | 50,000        | $0.0025 per extra delivery |

- Deliveries are counted per channel. https://www.magicbell.com/pricing

**Other**

- MagicBell is not self-hostable.
- Web push, mobile push and SMS channels exist. https://www.magicbell.com/docs/api

## SuprSend

**In-app feed and React**

- `@suprsend/react` 1.5.0 (MIT) is current. `@suprsend/react-inbox` has reached end of support. It offers drop-in or headless use. https://docs.suprsend.com/docs/react-inbox-integration.md
- Headless use goes through `SuprSendProvider` → `SuprSendFeedProvider`, with the `useFeedClient` and `useFeedData` hooks and `stores` (tabs).
- Archived Notifications are hidden unless the store query sets `archived: true`. Notifications can carry expiry. https://docs.suprsend.com/docs/react-sdk-headless-feed.md
- "Expiry auto-deletes the notification once the set period elapses". Pinned Notifications stay at the top. https://docs.suprsend.com/docs/in-app-inbox-template
- The bulk `PATCH /v1/bulk/message/` sets `seen`, `clicked`, `read`, `unread`, `archived` and `unarchived`. There is **no delete**. https://docs.suprsend.com/reference/bulk-update-messages.md
- The transport is `socket.io-client` (from `npm view @suprsend/web-sdk dependencies`).
- SSR is not documented.

**Auth**

- Use a public key plus a JWT signed with **ES256**, with claims `entity_type: "subscriber"`, `entity_id`, `exp`, `iat` and `scope`. Expiry can be handled with a `refreshUserToken` callback. https://docs.suprsend.com/docs/client-authentication

**Triggering**

- `@suprsend/node-sdk` 1.15.1 (MIT).
- `idempotency_key` causes repeat requests to be skipped "for next 24 hours". https://docs.suprsend.com/reference/idempotent-requests.md
- You can cancel by `execution_id`, `recipients`, `idempotency_key` or `workflow`. https://docs.suprsend.com/reference/cancel-workflow.md
- Batch and Digest nodes expose `$batched_events` and `$batched_events_count`. Digest runs on a fixed schedule. https://docs.suprsend.com/docs/digest.md

**Pricing**

| Plan       | Price   | Included/mo | Overage | Notes                                      |
| ---------- | ------- | ----------- | ------- | ------------------------------------------ |
| Free       | $0      | 10,000      | —       | Feed is SuprSend-branded                   |
| Essentials | $100/mo | 50,000      | $0.002  |                                            |
| Business   | $250/mo | 50,000      | $0.005  | Adds batching and digest, user preferences |

- **Batching, digest and user preferences start at Business.**
- Notifications are counted per channel, and a batched group counts as one.
- Log retention: 30 days on Free, 90 days on Essentials and Business.
- Source: https://www.suprsend.com/pricing

**Self-hosting**

- "Self-hosted deployment is supported under the Enterprise plan and is enabled via an enterprise license." It needs Kubernetes, Postgres, ClickHouse, Redis, NATS and optionally OpenSearch. https://docs.suprsend.com/docs/self-hosted/introduction.md
- SuprSend is not open source.

## Liveblocks Notifications

- Custom Notifications are sent with `triggerInboxNotification({ userId, kind: "$…", subjectId, activityData, roomId? })`. https://liveblocks.io/docs/api-reference/liveblocks-node#post-inbox-notifications-trigger
- With batching enabled, a trigger with the same `subjectId` appends to the existing Notification's activities, which suits "5 new replies". "An inbox notification can have up to 50 activities". https://liveblocks.io/docs/ready-made-features/notifications/concepts
- Server API (same Node reference):
  - `getInboxNotifications` (with `query: { unread: true }`)
  - `markInboxNotificationAsRead`
  - `deleteInboxNotification` and `deleteAllInboxNotifications`
  - Notification settings (beta)
- React hooks in `@liveblocks/react` 3.25.0 typings:
  - `useInboxNotifications`
  - `useUnreadInboxNotificationsCount`
  - `useMarkInboxNotificationAsRead`
  - `useMarkAllInboxNotificationsAsRead`
  - `useDeleteInboxNotification`
  - `useDeleteAllInboxNotifications`
  - `useNotificationSettings`
  - `useUpdateNotificationSettings`
  - Source: https://unpkg.com/@liveblocks/react@3.25.0/dist/index.d.ts
- **Live updates poll.** The React client fetches Notification deltas "during the periodic polling" with `NOTIFICATIONS_POLL_INTERVAL: 1 * MINUTES`. https://unpkg.com/@liveblocks/core@3.25.0/dist/index.d.ts (line ~2829), https://unpkg.com/@liveblocks/react@3.25.0/dist/chunk-5J7W4WJM.js (line 219)
- Email is sent through a webhook event listing unread Notifications, which Cadence could route to Postmark. https://liveblocks.io/docs/ready-made-features/notifications/concepts
- SSR: `ClientSideSuspense` "always render[s] the `fallback` on the server". https://liveblocks.io/docs/api-reference/liveblocks-react
- Pricing:
  - Free includes 200 custom notification events a month.
  - Pro costs $30/mo plus $0.005 per custom notification event.
  - Collaboration Notifications (mentions, replies) are unlimited.
  - Retention for Notifications is not listed.
  - Source: https://liveblocks.io/pricing
- Packages are Apache-2.0. The server is not self-hostable (not verified further).

## Excluded

- **Stream Activity Feeds:**
  - Its notification feeds exist on all plans, but Build (free) has only 5,000 activities a month and does not allow overage.
  - The next plan is Start at $499/mo billed annually or $599 monthly. https://getstream.io/activity-feeds/pricing/
  - It costs more than everything above, and it is a social feed product rather than a Notification workflow engine.
- **OneSignal in-app messages:** These are session-triggered modals and banners that are "pulled at app start … displayed based on trigger logic". The page describes no persistent feed. https://documentation.onesignal.com/docs/en/in-app-messages-setup
- **Engagespot:**
  - `engagespot.co/pricing` and `engagespot.co/` returned HTTP 404 on 2026-11-12.
  - The npm packages were last modified in 2025 (`@engagespot/react-component` 3.0.1) and 2024 (`@engagespot/node` 1.7.0).
  - We could not verify that the product is active.

## Facts later decisions depend on

**Where feed and read state live**

- With every provider, the provider stores Notifications and their read state.
- Ways for Cadence to keep a copy:
  - Knock: outbound webhooks for `message.read`, `message.seen`, `message.archived` and other events.
  - Novu: webhooks on Team and above only.
  - Liveblocks: a webhook on each notification.
  - Any provider: write a Cadence-side record at trigger time.

**Live-update mechanism**

- Knock, Novu, Courier, SuprSend and MagicBell use WebSockets.
  - Knock's `new-message` event may be throttled and has no content, so the client re-fetches.
  - Courier requires an explicit `listenForUpdates()`.
- Liveblocks polls every 60 s.

**SSR fit**

- Every vendor's UI is client-only.
- Server-side feed reads for a loader are documented for Knock (`users.feeds.listItems`) and Liveblocks (`getInboxNotifications`).
- Novu's v1 feed endpoint is deprecated, and its v2 list was not confirmed.
- Courier, SuprSend and MagicBell document none.

**Local dev and testing**

- Only Novu can run fully offline (Docker self-host).
- Knock and Courier offer separate dev/test environments, and Knock has sandbox mode, but both need network access.
- For unit tests, Cadence should put the provider behind its own interface and fake it.

**Pricing at about 20k Notifications a month**

| Provider            | Approximate monthly cost                              |
| ------------------- | ----------------------------------------------------- |
| Novu Pro            | ~$30                                                  |
| Liveblocks          | ~$130 (Pro $30 + 20k × $0.005, minus included credit) |
| Courier             | ~$100                                                 |
| SuprSend Essentials | $100 (no digest or prefs)                             |
| SuprSend Business   | $250                                                  |
| MagicBell           | $249                                                  |
| Knock Starter       | $250                                                  |

- All of these assume one in-app channel per Notification.

**Grouping (digest/batch)**

- Knock batch is on every plan, and the Notification appears when the window closes. Its `flush_leading` mode is mentioned in the mAPI schema search result, not verified.
- Novu digest is on every plan, but capped at 1 day on Free.
- Courier puts it on Enterprise only, and SuprSend on Business only.
- Liveblocks updates the Notification in place, which is the only "grows live" model we found.
- MagicBell has none documented.

**Retention**

| Provider                        | Retention                                          |
| ------------------------------- | -------------------------------------------------- |
| Knock                           | Feed unlimited                                     |
| Novu                            | 30 d Free / 90 d paid                              |
| Courier                         | Until archived or `expiresAt` (no plan cap stated) |
| SuprSend, MagicBell, Liveblocks | Not stated                                         |

**Update or delete after send** (for example, when the underlying lesson or comment is deleted)

- Novu and Liveblocks have documented hard delete.
- Knock content is immutable. You archive instead, and filtering by `trigger_data` or `workflows` makes bulk archive or delete possible.
- SuprSend uses archive or expiry.
- Courier uses `expiresAt`.
- None documents editing content in place, except Liveblocks appending activities through batching.

## Open questions / unverified

- Whether Knock's bulk `delete` action (present in the SDK types) is supported and documented. Also whether Knock in-app feed items update during an open batch, and whether Knock outbound webhooks are on every plan.
- Novu:
  - The exact v2 server-side list endpoint.
  - How "workflow runs" count for digests.
  - Pro and Team workflow counts, since the pricing table was garbled.
  - The comparison page is old: search metadata dates it about 1,046 days.
- Courier: Inbox retention per plan, whether Messages-API archive removes the Notification from the Inbox, and server-side Inbox fetch.
- MagicBell: real-time transport details, retention, digest, the exact notification endpoint paths, and package licence terms.
- SuprSend: inbox retention (a blog says 30 days by default, but that is not a primary doc), `markAllAsRead` in the React SDK, and SSR.
- Liveblocks: Notification retention and idempotency for `triggerInboxNotification`.
- No provider documents compatibility with React Router 8.3 specifically. All of them document Next.js `'use client'` patterns, which map to client-only rendering in React Router.

## Sources

All accessed 2026-11-12.

- Knock:
  - https://knock.app/pricing
  - https://docs.knock.app/in-app-ui/feeds/overview
  - https://docs.knock.app/in-app-ui/security-and-authentication
  - https://docs.knock.app/in-app-ui/react/overview
  - https://docs.knock.app/in-app-ui/react/feed
  - https://docs.knock.app/in-app-ui/react/headless/feed
  - https://docs.knock.app/in-app-ui/javascript/sdk/feed-client
  - https://docs.knock.app/in-app-ui/api-overview
  - https://docs.knock.app/api-reference/users/feeds/list_items
  - https://docs.knock.app/api-reference/messages
  - https://docs.knock.app/api-reference/overview/idempotent-requests
  - https://docs.knock.app/send-notifications/canceling-workflows
  - https://docs.knock.app/designing-workflows/batch-function
  - https://docs.knock.app/designing-workflows/channel-step
  - https://docs.knock.app/preferences/overview
  - https://docs.knock.app/developer-tools/outbound-webhooks/event-types
  - https://docs.knock.app/concepts/environments
  - https://docs.knock.app/send-notifications/testing-workflows
  - https://unpkg.com/@knocklabs/node@1.41.1/resources/channels/bulk.d.ts
  - https://unpkg.com/@knocklabs/node@1.41.1/resources/users/feeds.d.ts
  - https://unpkg.com/@knocklabs/node@1.41.1/resources/workflows.d.ts
  - https://unpkg.com/@knocklabs/react@0.15.1/dist/esm/index.mjs
- Novu:
  - https://novu.co/pricing
  - https://docs.novu.co/platform/developer/limits
  - https://docs.novu.co/platform/inbox/overview
  - https://docs.novu.co/platform/inbox/setup-inbox
  - https://docs.novu.co/platform/inbox/prepare-for-production
  - https://docs.novu.co/platform/inbox/configuration/preferences
  - https://docs.novu.co/platform/sdks/react
  - https://docs.novu.co/platform/sdks/javascript
  - https://docs.novu.co/.mintlify/skills/inbox-integration/references/nextjs-inbox-examples.md
  - https://docs.novu.co/.mintlify/skills/dashboard-workflows/references/digest-step.md
  - https://docs.novu.co/.mintlify/skills/framework-integration/references/studio-and-cli.md
  - https://docs.novu.co/api-reference/idempotency.md
  - https://docs.novu.co/api-reference/events/cancel-triggered-event.md
  - https://docs.novu.co/api-reference/subscribers/delete-a-notification.md
  - https://docs.novu.co/api-reference/subscribers/mark-all-notifications-as-read.md
  - https://docs.novu.co/api-reference/subscribers/retrieve-subscriber-notifications.md
  - https://docs.novu.co/platform/developer/webhooks.md
  - https://docs.novu.co/community/self-hosting-novu/overview
  - https://docs.novu.co/community/self-hosting-novu/deploy-with-docker
  - https://docs.novu.co/community/self-hosted-and-novu-cloud
  - https://github.com/novuhq/novu (`LICENSE-MIT`, `LICENSE-ENTERPRISE`, README)
- Courier:
  - https://www.courier.com/pricing
  - https://www.courier.com/docs/platform/inbox/inbox-overview
  - https://www.courier.com/docs/sdk-libraries/courier-react-web.md
  - https://www.courier.com/docs/in-app/authenticate-users.md
  - https://www.courier.com/docs/in-app/send-to-the-inbox.md
  - https://www.courier.com/docs/in-app/how-the-inbox-behaves.md
  - https://www.courier.com/docs/in-app/build-a-custom-inbox.md
  - https://www.courier.com/docs/guides/send-a-daily-digest.md
  - https://www.courier.com/docs/reference/api-overview.md
  - https://www.courier.com/docs/api-reference/messages/cancel-message.md
  - https://www.courier.com/docs/api-reference/messages/archive-message.md
- MagicBell:
  - https://www.magicbell.com/pricing
  - https://www.magicbell.com/docs/libraries/magicbell-react
  - https://www.magicbell.com/docs/channels/in_app
  - https://www.magicbell.com/docs/api/authentication/user
  - https://www.magicbell.com/docs/api
  - https://www.magicbell.com/docs/api/reference
  - https://www.magicbell.com/docs/primitive/notification
- SuprSend:
  - https://www.suprsend.com/pricing
  - https://docs.suprsend.com/docs/client-authentication
  - https://docs.suprsend.com/docs/react-inbox-integration.md
  - https://docs.suprsend.com/docs/react-sdk-headless-feed.md
  - https://docs.suprsend.com/docs/in-app-inbox-template
  - https://docs.suprsend.com/docs/digest.md
  - https://docs.suprsend.com/reference/idempotent-requests.md
  - https://docs.suprsend.com/reference/cancel-workflow.md
  - https://docs.suprsend.com/reference/bulk-update-messages.md
  - https://docs.suprsend.com/docs/self-hosted/introduction.md
- Liveblocks:
  - https://liveblocks.io/pricing
  - https://liveblocks.io/docs/ready-made-features/notifications
  - https://liveblocks.io/docs/ready-made-features/notifications/concepts
  - https://liveblocks.io/docs/api-reference/liveblocks-node
  - https://liveblocks.io/docs/api-reference/liveblocks-react
  - https://unpkg.com/@liveblocks/react@3.25.0/dist/index.d.ts
  - https://unpkg.com/@liveblocks/react@3.25.0/dist/chunk-5J7W4WJM.js
  - https://unpkg.com/@liveblocks/core@3.25.0/dist/index.d.ts
- Excluded:
  - https://getstream.io/activity-feeds/pricing/
  - https://documentation.onesignal.com/docs/en/in-app-messages-setup
  - https://engagespot.co/ (404)
- npm registry (`npm view <pkg> version license dependencies`) for every package version listed above.
