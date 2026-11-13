import { MessageSquareReply } from "lucide-react";
import {
  Bold,
  actorsPhrase,
  dataText,
  withLatestActorFirst,
} from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

export const commentRepliedRow: NotificationRowDefinition = {
  icon: MessageSquareReply,
  tone: "text-sky-600",
  Sentence: ({ item }) => (
    <>
      <Bold>{actorsPhrase(withLatestActorFirst(item, "replier_name"))}</Bold>{" "}
      replied to your comment on <Bold>{dataText(item, "lesson_title")}</Bold>
    </>
  ),
  // Opens the Lesson scrolled to the top-level comment (`#comment-<id>`).
  href: (item) => dataText(item, "url") || "/notifications",
};
