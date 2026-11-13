import { describe, expect, it } from "vitest";
import {
  archiveNotification,
  holdArrivals,
  newNotificationsLabel,
  notificationsForTab,
} from "./notification-feed";

const unread = { id: "unread", read: false, archived: false };
const read = { id: "read", read: true, archived: false };
const archived = { id: "archived", read: true, archived: true };
const feed = [unread, read, archived];

describe("notificationsForTab", () => {
  it("shows everything not archived on All", () => {
    expect(notificationsForTab(feed, "all")).toEqual([unread, read]);
  });

  it("shows only unread, not archived on Unread", () => {
    expect(notificationsForTab(feed, "unread")).toEqual([unread]);
  });

  it("shows only archived on Archived", () => {
    expect(notificationsForTab(feed, "archived")).toEqual([archived]);
  });
});

describe("holdArrivals", () => {
  const older = { id: "older", read: true, archived: false };
  const arrived = { id: "arrived", read: false, archived: false };

  it("hides Notifications that arrived while the page was open", () => {
    expect(holdArrivals([arrived, older], ["arrived"])).toEqual({
      shown: [older],
      heldCount: 1,
    });
  });

  it("holds nothing when nothing has arrived", () => {
    expect(holdArrivals([arrived, older], [])).toEqual({
      shown: [arrived, older],
      heldCount: 0,
    });
  });

  it("only counts held Notifications that are still in the feed", () => {
    expect(holdArrivals([older], ["arrived", "gone"])).toEqual({
      shown: [older],
      heldCount: 0,
    });
  });
});

describe("newNotificationsLabel", () => {
  it("says Notification for one", () => {
    expect(newNotificationsLabel(1)).toBe("1 new Notification");
  });

  it("says Notifications for more than one", () => {
    expect(newNotificationsLabel(3)).toBe("3 new Notifications");
  });
});

describe("archiveNotification", () => {
  function recordingFeed() {
    const calls: string[] = [];
    return {
      calls,
      markAsArchived: async (item: string) => {
        calls.push(`archive ${item}`);
      },
      markAsRead: async (item: string) => {
        calls.push(`read ${item}`);
      },
    };
  }

  it("archives an unread Notification, then marks it read", async () => {
    const feed = recordingFeed();
    await archiveNotification(feed, { read: false, feedItem: "n1" });
    expect(feed.calls).toEqual(["archive n1", "read n1"]);
  });

  it("only archives a Notification that is already read", async () => {
    const feed = recordingFeed();
    await archiveNotification(feed, { read: true, feedItem: "n1" });
    expect(feed.calls).toEqual(["archive n1"]);
  });
});
