---
name: knock-workflows
description: Knock workflows as code — write `knock/workflows/<key>/` files and push them with the Knock CLI. Use when adding or changing a Notification type, or editing anything under `knock/`.
---

# Knock workflows

Workflows live in the repo and are the source of truth; Knock's Development environment is a copy pushed from them. `knock.json` (`{ "knockDir": "knock" }`) points the CLI at `knock/workflows/`.

The **workflow key** is the Notification type: the directory name, the `NOTIFICATION_TYPES` entry in `app/lib/notifications.ts`, and the key the events module triggers are one string.

## Steps

1. **Write the files** — copy the nearest existing workflow:
   - ungrouped: `knock/workflows/refund-requested/`
   - grouped: `knock/workflows/course-rated/` (a `batch` step before the feed step)

   Each workflow is `workflow.json` plus the feed template `in_app_feed_1/markdown_body.md`, referenced by `"markdown_body@"`. Keep these fixed in every feed step: `"channel_type": "in_app_feed"`, `"channel_key": "cadence-in-app"`, `"action_url": "{{ data.url }}"`.

2. **Set the type's rules** from the spec's catalog:
   - **Mandatory** (can't be muted) → `"settings": { "override_preferences": true, "is_commercial": false }`. Mutable types have no `settings` block.
   - **Grouped** → batch `settings`: `batch_window_type: "sliding"`, `batch_key` = the grouping field (`data.<field>`), `batch_window` = the window, `batch_window_extension_limit` = the cap, `batch_execution_mode: "flush_leading"`. Leave `batch_items_max_limit` out — no activity cap.
   - Template fields read flat `data.*` keys the events module actually sends; grouped templates branch on `total_activities` / `total_actors`.

3. **Validate, then push to Development** from the repo root. The CLI reads `KNOCK_SERVICE_TOKEN` from the environment; load `.env` in a subshell so no secret is printed:

   ```bash
   ( set -a; . ./.env; set +a; npx -y @knocklabs/cli workflow validate --all --environment=development )
   ( set -a; . ./.env; set +a; npx -y @knocklabs/cli workflow push <key> --environment=development --commit -m "<message>" )
   ```

   Push to `development` only. Promoting to Production is the user's call.

4. **Pull it back** — `workflow pull <key> --environment=development --force` in the same subshell. Knock normalises the files on save and adds a `__readonly` block; commit the pulled files as they come back.

Done when `validate --all` passes, the push reports the workflow committed, and `git diff knock/` after the pull shows only Knock's normalisation.

## Other commands

`workflow list`, `workflow pull --all --force`, `workflow run <key> --recipients=<id> --data='{...}'` (a live test trigger) — each via the same `npx -y @knocklabs/cli` subshell. `--help` on any command lists its flags.
