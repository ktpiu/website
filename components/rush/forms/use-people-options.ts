"use client";

import { useEffect, useState } from "react";
import type { PersonOption } from "@/components/ui/people-selector";
import { rushFetch } from "@/lib/rush/client";
import type { PeopleSource } from "@/lib/rush/types";

const cache = new Map<string, Promise<PersonOption[]>>();

/**
 * Loads people for the selector. `publicMode` is for the PNM application:
 * only active names are available there, via an unauthenticated endpoint.
 */
export function usePeopleOptions(source: PeopleSource, cycleId?: string | null, publicMode = false) {
  const url = publicMode
    ? "/api/rush/public/actives"
    : `/api/rush/people?source=${source}${cycleId ? `&cycleId=${cycleId}` : ""}`;
  const [state, setState] = useState<{ url: string; people: PersonOption[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let promise = cache.get(url);
    if (!promise) {
      promise = rushFetch<{ people: Array<PersonOption & { kind: string }> }>(url).then((r) => r.people);
      cache.set(url, promise);
      // Don't cache failures, and refresh after a minute so changes show up.
      promise.catch(() => cache.delete(url));
      setTimeout(() => cache.delete(url), 60_000);
    }
    promise.then((people) => !cancelled && setState({ url, people })).catch(() => !cancelled && setState({ url, people: [] }));
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { people: state?.url === url ? state.people : [], loading: state?.url !== url };
}
