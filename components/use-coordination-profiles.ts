"use client";
import { useEffect, useState } from "react";
import { isCoordinationProfile } from "../lib/coordinations";
const EVENT = "pontmore-coordination-profiles-updated";
const CACHE = "pontmore-coordination-profiles";
const pending = new Map<string, Promise<string[]>>();
function relayKey(): string {
  try {
    return (localStorage.getItem("pontmore-pip00-poc-relays") || "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .sort()
      .join("\n");
  } catch {
    return "";
  }
}
function readCache(key: string): { profiles: string[]; readAt: number } {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE) || "null");
    if (cached?.key === key && Array.isArray(cached.profiles))
      return {
        profiles: cached.profiles.filter(isCoordinationProfile),
        readAt: Number(cached.readAt) || 0,
      };
  } catch {
    /* unavailable */
  }
  return { profiles: [], readAt: 0 };
}
function writeCache(key: string, profiles: string[], readAt: number) {
  try {
    sessionStorage.setItem(CACHE, JSON.stringify({ key, profiles, readAt }));
  } catch {
    /* unavailable */
  }
}
export function announceCoordinationProfiles(profiles: string[]) {
  const key = relayKey(),
    cached = readCache(key);
  const merged = [
    ...new Set([...cached.profiles, ...profiles.filter(isCoordinationProfile)]),
  ].sort();
  writeCache(key, merged, cached.readAt);
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { key, profiles: merged } }),
  );
}
export function useCoordinationProfiles(): string[] {
  const [profiles, setProfiles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const key = relayKey(),
      cached = readCache(key);
    setProfiles(cached.profiles);
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.key === key && Array.isArray(detail.profiles))
        setProfiles(detail.profiles.filter(isCoordinationProfile));
    };
    window.addEventListener(EVENT, update);
    if (Date.now() - cached.readAt >= 60_000) {
      let request = pending.get(key);
      if (!request) {
        const params = new URLSearchParams();
        key
          .split("\n")
          .filter(Boolean)
          .forEach((relay) => params.append("relay", relay));
        try {
          const known = JSON.parse(
            localStorage.getItem("pontmore-known-coordination-roots") || "[]",
          );
          if (Array.isArray(known))
            known
              .filter((id) => typeof id === "string")
              .slice(0, 50)
              .forEach((id) => params.append("root", id));
        } catch {
          /* unavailable */
        }
        request = fetch(`/api/coordinations/profiles?${params}`)
          .then(async (response) => {
            if (!response.ok) throw new Error("Profile discovery failed.");
            const data = await response.json();
            const discovered = Array.isArray(data.profiles)
              ? (data.profiles.filter(isCoordinationProfile) as string[])
              : [];
            const merged = [
              ...new Set([...readCache(key).profiles, ...discovered]),
            ].sort();
            writeCache(key, merged, Date.now());
            return merged;
          })
          .finally(() => pending.delete(key));
        pending.set(key, request);
      }
      request
        .then((data) => {
          if (!cancelled) setProfiles(data);
        })
        .catch(() => {
          /* Preserve previously discovered profiles on failed reads. */
        });
    }
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return profiles;
}
