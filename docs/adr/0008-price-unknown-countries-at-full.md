# Charge full price when the buyer's country is unknown, without a network lookup

Purchasing-power prices depend on the buyer's country. `resolveCountry` reads it from the `CF-IPCountry` header Cloudflare adds (or the DevUI override in development), and when neither is present it returns `null` and the buyer pays full price. The course list, the purchase page and every lesson page resolve the country, so a network lookup there would put a third-party call on the hot path of almost every page.

## Considered Options

- **Look the address up on ip-api.com.** Rejected: every page could wait on a plain-HTTP call to a free endpoint limited to 45 requests a minute.
- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.

## Consequences

A buyer who reaches Cadence without passing through Cloudflare is charged full price even if their country would earn a discount. Purchasing-power pricing only works as intended when the app runs behind Cloudflare.
