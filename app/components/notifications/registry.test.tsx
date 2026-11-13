import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedItem } from "@knocklabs/client";
import type { NotificationType } from "~/lib/notifications";
import type { NotificationItem } from "./notifications-provider";
import { rowDefinitionFor } from "./registry";

function notification(
  type: NotificationType,
  fields: Partial<NotificationItem>
): NotificationItem {
  return {
    id: "message-1",
    type,
    actors: ["Liam"],
    totalActors: 1,
    totalActivities: 1,
    data: {},
    insertedAt: "2026-11-13T09:00:00Z",
    read: false,
    archived: false,
    // Rows read only `activities` from Knock's own item.
    feedItem: { activities: [] } as unknown as FeedItem,
    ...fields,
  };
}

/** The row's sentence as plain text. */
function sentence(item: NotificationItem): string {
  const { Sentence } = rowDefinitionFor(item.type);
  return renderToStaticMarkup(<Sentence item={item} />).replace(/<[^>]+>/g, "");
}

describe("Comment Posted row", () => {
  it("opens the comment for a single event", () => {
    const item = notification("comment-posted", {
      data: { url: "/courses/intro-ts/lessons/5#comment-9" },
    });

    expect(rowDefinitionFor(item.type).href(item)).toBe(
      "/courses/intro-ts/lessons/5#comment-9"
    );
  });

  it("opens the Lesson's comments for a Grouped Notification", () => {
    const item = notification("comment-posted", {
      totalActivities: 3,
      data: { url: "/courses/intro-ts/lessons/5#comment-12" },
    });

    expect(rowDefinitionFor(item.type).href(item)).toBe(
      "/courses/intro-ts/lessons/5#comments"
    );
  });
});

describe("Grouped rows name the latest actor first", () => {
  const grouped = {
    actors: ["Ana", "Ben", "Cy"],
    totalActors: 3,
    totalActivities: 3,
  };

  it("Course Purchased", () => {
    const item = notification("course-purchased", {
      ...grouped,
      data: { buyer_name: "Cy", course_title: "TypeScript" },
    });

    expect(sentence(item)).toBe(
      "Cy, Ana and 1 other made 3 Purchases of TypeScript"
    );
  });

  it("Course Rated", () => {
    const item = notification("course-rated", {
      ...grouped,
      data: { student_name: "Ben", course_title: "TypeScript" },
    });

    expect(sentence(item)).toBe(
      "Ben, Ana and 1 other left 3 ratings on TypeScript"
    );
  });

  it("Team Seat Claimed", () => {
    const item = notification("team-seat-claimed", {
      ...grouped,
      data: {
        claimer_name: "Cy",
        course_title: "TypeScript",
        claimed_seats: 3,
        total_seats: 5,
      },
    });

    expect(sentence(item)).toBe(
      "Cy, Ana and 1 other claimed Team Seats in TypeScript (3 of 5 claimed)"
    );
  });
});
