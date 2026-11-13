import { MessageSquare } from "lucide-react";
import {
  Bold,
  actorsPhrase,
  dataText,
  withLatestActorFirst,
} from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const commentPostedRow: NotificationRowDefinition = {
  icon: MessageSquare,
  tone: "text-sky-600",
  Sentence: ({ item }) => (
    <>
      <Bold>{actorsPhrase(withLatestActorFirst(item, "commenter_name"))}</Bold>{" "}
      {item.totalActivities > 1 ? "commented" : "posted a comment"} on{" "}
      <Bold>{dataText(item, "lesson_title")}</Bold>
    </>
  ),
  // Opens the Lesson scrolled to the (latest) comment (`#comment-<id>`).
  href: (item) => dataText(item, "url") || "/notifications",
};
