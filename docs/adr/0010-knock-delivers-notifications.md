# Deliver Notifications through Knock

Cadence's in-app Notifications are delivered by Knock, on its Free plan. We expect fewer than 10,000 messages a month, which Free covers, so cost did not decide between Knock and Novu. Knock has the fullest feed (seen, read and archived states, per-workflow preferences), unlimited workflows on every plan, and a server-side feed read if a loader ever needs one. It is also the provider this project is learning to use.

## Considered Options

- **Novu.** Cheaper past the free tier ($30/month against Knock's $250/month), MIT-licensed, and can run offline with Docker. Rejected for now, but it stays the fallback.

## Consequences

- Cadence calls Knock only through its own interface, so tests use a fake, and swapping providers stays cheap.
- If volume goes past 10,000 messages a month, we choose the provider again before paying for Knock Starter.
- Knock has no workflow that cannot be turned off. Cadence's muting settings page leaves out the Mandatory Notification types and never writes a preference for them.
- Knock keeps the feed forever, and we accept that. No setting for a shorter feed retention was found, and Cadence runs no clean-up job.
- Enhanced security mode is on in every environment, Development included, so the browser's feed needs a user token signed by Cadence.
- The Free plan shows Knock branding, which we accept.
