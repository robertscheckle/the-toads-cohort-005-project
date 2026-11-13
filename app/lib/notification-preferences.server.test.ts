import { describe, expect, it, vi } from "vitest";
import { UserRole } from "~/db/schema";
import type { NotificationType } from "./notifications";
import { recordingNotifier } from "./notifier.server";
import {
  getNotificationSettings,
  setNotificationTypeEnabled,
} from "./notification-preferences.server";

describe("getNotificationSettings", () => {
  it("offers a Student Comment Replied and Team Seat Claimed, both on by default", async () => {
    const notifier = recordingNotifier();

    const settings = await getNotificationSettings(
      "8",
      UserRole.Student,
      notifier
    );

    expect(settings).toEqual([
      { type: "comment-replied", label: "Comment Replied", enabled: true },
      { type: "team-seat-claimed", label: "Team Seat Claimed", enabled: true },
    ]);
  });

  it("offers an Instructor the four Course types too, with a muted one off", async () => {
    const notifier = recordingNotifier({ "3": { "course-rated": false } });

    const settings = await getNotificationSettings(
      "3",
      UserRole.Instructor,
      notifier
    );

    expect(settings).toEqual([
      { type: "comment-replied", label: "Comment Replied", enabled: true },
      { type: "team-seat-claimed", label: "Team Seat Claimed", enabled: true },
      { type: "comment-posted", label: "Comment Posted", enabled: true },
      { type: "course-purchased", label: "Course Purchased", enabled: true },
      { type: "purchase-refunded", label: "Purchase Refunded", enabled: true },
      { type: "course-rated", label: "Course Rated", enabled: false },
    ]);
  });

  it("offers an Admin only the types everyone gets, never a Refund type", async () => {
    const notifier = recordingNotifier();

    const settings = await getNotificationSettings(
      "1",
      UserRole.Admin,
      notifier
    );

    expect(settings.map((setting) => setting.type)).toEqual([
      "comment-replied",
      "team-seat-claimed",
    ]);
  });

  it("shows every type on when preferences can't be read", async () => {
    const failing = recordingNotifier();
    failing.getPreferences = async () => {
      throw new Error("Knock is down");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const settings = await getNotificationSettings(
      "8",
      UserRole.Student,
      failing
    );

    expect(settings.map((setting) => setting.enabled)).toEqual([true, true]);
  });
});

describe("setNotificationTypeEnabled", () => {
  it("mutes a type for the person", async () => {
    const notifier = recordingNotifier();

    const result = await setNotificationTypeEnabled(
      "8",
      "comment-replied",
      false,
      notifier
    );

    expect(result).toEqual({ ok: true });
    expect(notifier.calls).toEqual([
      {
        operation: "setPreference",
        userId: "8",
        type: "comment-replied",
        enabled: false,
      },
    ]);
  });

  it.each([
    "refund-requested",
    "refund-approved",
    "refund-declined",
    "refunded",
  ])("never writes a preference for the Mandatory type %s", async (type) => {
    const notifier = recordingNotifier();

    const result = await setNotificationTypeEnabled(
      "8",
      type as NotificationType,
      false,
      notifier
    );

    expect(result).toEqual({
      ok: false,
      message: "Refund Notifications can't be muted",
    });
    expect(notifier.calls).toEqual([]);
  });
});
