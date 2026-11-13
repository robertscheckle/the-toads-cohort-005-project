import { useCallback, useEffect, useState } from "react";
import type { Feed, FeedItem } from "@knocklabs/client";

/**
 * Ids of Notifications that arrived over Knock's socket while the calling
 * component is mounted. Only the Notifications page uses it, so nothing is
 * held anywhere else (and the sidebar count, Knock's own, always includes
 * them). `showHeld` releases them into the list.
 */
export function useHeldArrivals(feedClient: Feed | null) {
  const [heldIds, setHeldIds] = useState<string[]>([]);

  useEffect(() => {
    setHeldIds([]);
    if (!feedClient) return;
    // Knock's socket announces new messages; the client fetches them and
    // emits this event with the new items.
    const onArrival = ({ items }: { items: FeedItem[] }) =>
      setHeldIds((ids) => [...ids, ...items.map((item) => item.id)]);
    feedClient.on("items.received.realtime", onArrival as never);
    return () => feedClient.off("items.received.realtime", onArrival as never);
  }, [feedClient]);

  const showHeld = useCallback(() => setHeldIds([]), []);
  return { heldIds, showHeld };
}
