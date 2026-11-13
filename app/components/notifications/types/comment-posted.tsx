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
  // One comment: the Lesson scrolled to it (`#comment-<id>`). Grouped: the
  // Lesson's comments section (`#comments`), since it holds several.
  href: (item) => {
    const url = dataText(item, "url");
    if (!url) return "/notifications";
    if (item.totalActivities <= 1) return url;
    return `${url.split("#")[0]}#comments`;
  },
};
