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

/** A recipient or actor. `id` is the Cadence user id as a string. */
export type NotificationPerson = { id: string; name: string };

/** Per-type on/off for one person. A type that is missing is on. */
export type NotificationPreferences = Partial<
  Record<NotificationType, boolean>
>;

/**
 * One unread Notification (a Knock message). `events` holds the trigger data
 * of each event in it, oldest first: one for a single event, several for a
 * Grouped Notification.
 */
export type UnreadNotification = {
  id: string;
  type: NotificationType;
  events: NotificationData[];
};

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
  /**
   * Lists one person's unread Notifications of `type` whose trigger data
   * matches `filter` (every key equal), each with the trigger data of every
   * event in it (more than one for a Grouped Notification). Like
   * markReadWhere, `filter` is matched against the Notification's own data,
   * which for a Grouped one is its latest event's: filter on the key it is
   * grouped by.
   */
  listUnread(
    type: NotificationType,
    recipientId: string,
    filter: NotificationData
  ): Promise<UnreadNotification[]>;
  /** Marks the given Notifications read, in one batch. */
  markRead(notificationIds: string[]): Promise<void>;
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

  /** Ids of one person's unread messages of `type` matching `filter`. */
  async function listUnreadIds(
    type: NotificationType,
    recipientId: string,
    filter: NotificationData
  ): Promise<string[]> {
    const messageIds: string[] = [];
    for await (const message of knock.users.listMessages(recipientId, {
      source: type,
      trigger_data: JSON.stringify(filter),
      engagement_status: ["unread"],
      ...(feedChannelId ? { channel_id: feedChannelId } : {}),
    })) {
      messageIds.push(message.id);
    }
    return messageIds;
  }

  return {
    async notify(type, recipients, actor, data) {
      if (recipients.length === 0) return;
      await knock.workflows.trigger(type, { recipients, actor, data });
    },

    async markReadWhere(type, recipientIds, filter) {
      const messageIds = (
        await Promise.all(
          recipientIds.map((recipientId) =>
            listUnreadIds(type, recipientId, filter)
          )
        )
      ).flat();
      if (messageIds.length > 0) {
        await knock.messages.batch.markAsRead({ message_ids: messageIds });
      }
    },

    async listUnread(type, recipientId, filter) {
      const messageIds = await listUnreadIds(type, recipientId, filter);
      // A Grouped message's own data is only its latest event's, so read
      // every event from its activities.
      return Promise.all(
        messageIds.map(async (id) => {
          const events: NotificationData[] = [];
          for await (const activity of knock.messages.listActivities(id)) {
            events.push((activity.data ?? {}) as NotificationData);
          }
          return { id, type, events };
        })
      );
    },

    async markRead(notificationIds) {
      if (notificationIds.length === 0) return;
      await knock.messages.batch.markAsRead({ message_ids: notificationIds });
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
    async listUnread() {
      return [];
    },
    async markRead(notificationIds) {
      write("mark-read-ids", { notificationIds });
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
      operation: "markRead";
      notificationIds: string[];
    }
  | {
      operation: "setPreference";
      userId: string;
      type: NotificationType;
      enabled: boolean;
    };

/** A Notification in the in-memory feed of recordingNotifier. */
export type RecordedNotification = UnreadNotification & {
  recipientId: string;
  read: boolean;
};

/**
 * Records every write in `calls` and keeps an in-memory feed in `messages`:
 * notify adds one unread Notification per recipient, the mark-read operations
 * mark them read. `preferences` seeds what getPreferences returns (and is
 * updated by setPreference). `eventReads` lists the id of each Notification
 * whose events listUnread read (with Knock, one activities request each).
 *
 * `groupBy` models a Knock batch per type: an event whose trigger data has
 * the same value for that key as an unread Notification
 * of the type joins it (a Grouped Notification) instead of adding one.
 */
export function recordingNotifier(
  preferences: Record<string, NotificationPreferences> = {},
  options: { groupBy?: Partial<Record<NotificationType, string>> } = {}
): Notifier & {
  calls: NotifierCall[];
  messages: RecordedNotification[];
  eventReads: string[];
} {
  const calls: NotifierCall[] = [];
  const messages: RecordedNotification[] = [];
  const eventReads: string[] = [];
  /** Like Knock, `filter` matches the message's data: its latest event's. */
  function isUnreadMatch(
    message: RecordedNotification,
    type: NotificationType,
    filter: NotificationData
  ) {
    const latest = message.events[message.events.length - 1];
    return (
      message.type === type &&
      !message.read &&
      Object.entries(filter).every(([key, value]) => latest[key] === value)
    );
  }
  return {
    calls,
    messages,
    eventReads,
    async notify(type, recipients, actor, data) {
      calls.push({ operation: "notify", type, recipients, actor, data });
      const groupKey = options.groupBy?.[type];
      for (const recipient of recipients) {
        const group = groupKey
          ? messages.find(
              (m) =>
                m.type === type &&
                m.recipientId === recipient.id &&
                !m.read &&
                m.events[0][groupKey] === data[groupKey]
            )
          : undefined;
        if (group) {
          group.events.push(data);
          continue;
        }
        messages.push({
          id: `message-${messages.length + 1}`,
          type,
          recipientId: recipient.id,
          events: [data],
          read: false,
        });
      }
    },
    async markReadWhere(type, recipientIds, filter) {
      calls.push({ operation: "markReadWhere", type, recipientIds, filter });
      for (const message of messages) {
        if (
          recipientIds.includes(message.recipientId) &&
          isUnreadMatch(message, type, filter)
        ) {
          message.read = true;
        }
      }
    },
    async listUnread(type, recipientId, filter) {
      return messages
        .filter(
          (m) => m.recipientId === recipientId && isUnreadMatch(m, type, filter)
        )
        .map(({ id, events }) => {
          eventReads.push(id);
          return { id, type, events: [...events] };
        });
    },
    async markRead(notificationIds) {
      calls.push({ operation: "markRead", notificationIds });
      for (const message of messages) {
        if (notificationIds.includes(message.id)) message.read = true;
      }
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
    listUnread: (type, recipientId, filter) =>
      attempt(
        `listUnread ${type} for [${recipientId}] ${JSON.stringify(filter)}`,
        [],
        () => notifier.listUnread(type, recipientId, filter)
      ),
    markRead: (notificationIds) =>
      attempt(`markRead [${notificationIds.join(", ")}]`, undefined, () =>
        notifier.markRead(notificationIds)
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
