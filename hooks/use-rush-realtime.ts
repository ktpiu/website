"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type RealtimeTopic = {
  /** Channel / topic name. */
  name: string;
  /** Broadcast topics published by the database with private = false. */
  broadcast?: boolean;
  /** Attach listeners; call `refresh` (or patch state) from them. */
  setup: (channel: RealtimeChannel, refresh: () => void) => RealtimeChannel;
};

type Options = {
  /** Stable identity for the topic set; changing it resubscribes. Null disables. */
  key: string | null;
  topics: RealtimeTopic[];
  /** Background refetch (e.g. queryClient.invalidateQueries). Never a page reload. */
  onRefresh: () => void;
  /** Safety-net polling in case the socket silently drops. */
  pollMs?: number;
};

/**
 * Supabase Realtime (WebSocket) subscriptions used as a freshness signal.
 * Also refreshes after a reconnect, when the tab becomes visible again and on
 * a slow poll, so screens recover from dropped connections without reloading.
 */
export function useRushRealtime({ key, topics, onRefresh, pollMs = 30_000 }: Options) {
  const refreshRef = useRef(onRefresh);
  const topicsRef = useRef(topics);
  refreshRef.current = onRefresh;
  topicsRef.current = topics;

  useEffect(() => {
    if (!key) return;
    const refresh = () => refreshRef.current();

    const channels = topicsRef.current.map((topic) => {
      let wasDisconnected = false;
      const channel = supabase.channel(
        topic.name,
        topic.broadcast ? { config: { private: false } } : undefined,
      );
      return topic.setup(channel, refresh).subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (wasDisconnected) refresh();
          wasDisconnected = false;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          wasDisconnected = true;
        }
      });
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      for (const channel of channels) supabase.removeChannel(channel);
    };
  }, [key, pollMs]);
}

/**
 * Listens for the content-free "slots_changed" broadcast the database sends
 * whenever a timeslot or signup changes, for each of the given events.
 */
export function useSlotBroadcasts(eventIds: string[], onRefresh: () => void) {
  const sorted = [...eventIds].sort();
  useRushRealtime({
    key: sorted.length ? `slots:${sorted.join(",")}` : null,
    onRefresh,
    topics: sorted.map((id) => ({
      name: `rush-event:${id}`,
      broadcast: true,
      setup: (channel, refresh) => channel.on("broadcast", { event: "slots_changed" }, refresh),
    })),
  });
}
