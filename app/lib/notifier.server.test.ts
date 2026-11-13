import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outboxNotifier } from "./notifier.server";

describe("outboxNotifier", () => {
  it("writes the Notification as JSON to the notifications folder when there are no Knock keys", async () => {
    const directory = join(
      mkdtempSync(join(tmpdir(), "outbox-")),
      "notifications"
    );

    await outboxNotifier(directory).notify(
      "refund-requested",
      [{ id: "1", name: "Ada" }],
      { id: "3", name: "Liam" },
      { refund_request_id: 7, course_title: "Introduction to TypeScript" }
    );

    const files = readdirSync(directory);
    expect(files).toHaveLength(1);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toMatchObject({
      type: "refund-requested",
      recipients: [{ id: "1", name: "Ada" }],
      actor: { id: "3", name: "Liam" },
      data: {
        refund_request_id: 7,
        course_title: "Introduction to TypeScript",
      },
    });
  });
});
