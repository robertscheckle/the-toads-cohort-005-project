import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Knock } from "@knocklabs/node";
import type { NotificationData, NotificationType } from "~/lib/notifications";

// ─── Notifier ───
// The only server code that talks to Knock. Shaped like the mailer's
// MailTransport: one interface, a real implementation and fakes.
//
// Unlike sendEmail, a Notifier never throws. Wrap any implementation in
// neverThrow() (defaultNotifier() already is): failures are logged with the
// type and recipients, then swallowed, so Notifications never block real work.
//
// Uses positional parameters (project convention).

/** A recipient or actor. `id` is the Cadence user id as a string. */
export type NotificationPerson = { id: string; name: string };

/** Per-type on/off for one person. A type that is missing is on. */
export type NotificationPreferences = Partial<
  Record<NotificationType, boolean>
>;

export interface Notifier {
  /** Triggers the type's Knock workflow for each recipient. */
  notify(
    type: NotificationType,
    recipients: NotificationPerson[],
    actor: NotificationPerson,
    data: NotificationData
  ): Promise<void>;
  /**
   * Marks read every unread Notification of `type` for the given recipients
   * whose trigger data matches `filter` (every key equal).
   */
  markReadWhere(
    type: NotificationType,
    recipientIds: string[],
    filter: NotificationData
  ): Promise<void>;
  /** Reads one person's type preferences. Never written for Mandatory types. */
  getPreferences(userId: string): Promise<NotificationPreferences>;
  /** Turns one type on (`true`) or off (muted) for one person. */
  setPreference(
    userId: string,
    type: NotificationType,
    enabled: boolean
  ): Promise<void>;
}

// ─── Knock ───

export function knockNotifier(
  secretKey: string,
  feedChannelId?: string
): Notifier {
  const knock = new Knock({ apiKey: secretKey });

  return {
    async notify(type, recipients, actor, data) {
      if (recipients.length === 0) return;
      await knock.workflows.trigger(type, { recipients, actor, data });
    },

    async markReadWhere(type, recipientIds, filter) {
      const messageIds: string[] = [];
      for (const recipientId of recipientIds) {
        for await (const message of knock.users.listMessages(recipientId, {
          source: type,
          trigger_data: JSON.stringify(filter),
          engagement_status: ["unread"],
          ...(feedChannelId ? { channel_id: feedChannelId } : {}),
        })) {
          messageIds.push(message.id);
        }
      }
      if (messageIds.length > 0) {
        await knock.messages.batch.markAsRead({ message_ids: messageIds });
      }
    },

    async getPreferences(userId) {
      const set = await knock.users.getPreferences(userId, "default");
      const preferences: NotificationPreferences = {};
      for (const [key, value] of Object.entries(set.workflows ?? {})) {
        if (typeof value === "boolean") {
          preferences[key as NotificationType] = value;
        }
      }
      return preferences;
    },

    async setPreference(userId, type, enabled) {
      await knock.users.setPreferences(userId, "default", {
        __persistence_strategy__: "merge",
        workflows: { [type]: enabled },
      });
    },
  };
}

// ─── File fake (local dev without Knock keys) ───

/** Writes each call as JSON into `directory`. Reads return defaults. */
export function outboxNotifier(directory: string): Notifier {
  let sequence = 0;
  function write(operation: string, body: object) {
    mkdirSync(directory, { recursive: true });
    sequence += 1;
    const file = join(directory, `${Date.now()}-${sequence}-${operation}.json`);
    writeFileSync(file, JSON.stringify({ operation, ...body }, null, 2));
  }

  return {
    async notify(type, recipients, actor, data) {
      write("notify", { type, recipients, actor, data });
    },
    async markReadWhere(type, recipientIds, filter) {
      write("mark-read", { type, recipientIds, filter });
    },
    async getPreferences() {
      return {};
    },
    async setPreference(userId, type, enabled) {
      write("set-preference", { userId, type, enabled });
    },
  };
}

// ─── In-memory recording fake (tests) ───

export type NotifierCall =
  | {
      operation: "notify";
      type: NotificationType;
      recipients: NotificationPerson[];
      actor: NotificationPerson;
      data: NotificationData;
    }
  | {
      operation: "markReadWhere";
      type: NotificationType;
      recipientIds: string[];
      filter: NotificationData;
    }
  | {
      operation: "setPreference";
      userId: string;
      type: NotificationType;
      enabled: boolean;
    };

/**
 * Records every call in `calls`. `preferences` seeds what getPreferences
 * returns (and is updated by setPreference).
 */
export function recordingNotifier(
  preferences: Record<string, NotificationPreferences> = {}
): Notifier & { calls: NotifierCall[] } {
  const calls: NotifierCall[] = [];
  return {
    calls,
    async notify(type, recipients, actor, data) {
      calls.push({ operation: "notify", type, recipients, actor, data });
    },
    async markReadWhere(type, recipientIds, filter) {
      calls.push({ operation: "markReadWhere", type, recipientIds, filter });
    },
    async getPreferences(userId) {
      return { ...preferences[userId] };
    },
    async setPreference(userId, type, enabled) {
      calls.push({ operation: "setPreference", userId, type, enabled });
      preferences[userId] = { ...preferences[userId], [type]: enabled };
    },
  };
}

// ─── Never throws ───

/**
 * Wraps a Notifier so no call throws. Failures are logged with the type and
 * recipients and swallowed; getPreferences falls back to all types on.
 */
export function neverThrow(notifier: Notifier): Notifier {
  async function attempt<T>(
    describe: string,
    fallback: T,
    run: () => Promise<T>
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      console.error(`[notifier] ${describe} failed:`, error);
      return fallback;
    }
  }

  return {
    notify: (type, recipients, actor, data) =>
      attempt(
        `notify ${type} to [${recipients.map((r) => r.id).join(", ")}]`,
        undefined,
        () => notifier.notify(type, recipients, actor, data)
      ),
    markReadWhere: (type, recipientIds, filter) =>
      attempt(
        `markReadWhere ${type} for [${recipientIds.join(", ")}] ${JSON.stringify(filter)}`,
        undefined,
        () => notifier.markReadWhere(type, recipientIds, filter)
      ),
    getPreferences: (userId) =>
      attempt(`getPreferences for [${userId}]`, {}, () =>
        notifier.getPreferences(userId)
      ),
    setPreference: (userId, type, enabled) =>
      attempt(
        `setPreference ${type}=${enabled} for [${userId}]`,
        undefined,
        () => notifier.setPreference(userId, type, enabled)
      ),
  };
}

/** Knock when KNOCK_SECRET_KEY is set, else the outbox file fake. Never throws. */
export function defaultNotifier(): Notifier {
  const secretKey = process.env.KNOCK_SECRET_KEY;
  return neverThrow(
    secretKey
      ? knockNotifier(secretKey, process.env.KNOCK_FEED_CHANNEL_ID)
      : outboxNotifier(join(".outbox", "notifications"))
  );
}
