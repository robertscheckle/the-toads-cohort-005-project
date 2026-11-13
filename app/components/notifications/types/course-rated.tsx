import { Star } from "lucide-react";
import {
  Bold,
  actorsPhrase,
  dataText,
  withLatestActorFirst,
} from "../row-definition";
import type { NotificationRowDefinition } from "../row-definition";

// One rating: "Liam rated Course 4 stars". Grouped (several ratings in the
// window): a count only, never an average, e.g. "Liam and 2 others left 3
// ratings on Course".
export const courseRatedRow: NotificationRowDefinition = {
  icon: Star,
  tone: "text-yellow-500",
  Sentence: ({ item }) => {
    const actors = actorsPhrase(withLatestActorFirst(item, "student_name"));
    const course = <Bold>{dataText(item, "course_title")}</Bold>;
    if (item.totalActivities > 1) {
      return (
        <>
          <Bold>{actors}</Bold> left {item.totalActivities} ratings on {course}
        </>
      );
    }
    const stars = Number(item.data.rating);
    return (
      <>
        <Bold>{actors}</Bold> rated {course} {stars}{" "}
        {stars === 1 ? "star" : "stars"}
      </>
    );
  },
  href: (item) => `/instructor/${dataText(item, "course_id")}`,
};
