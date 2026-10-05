export type DirectoryView =
  | "discover"
  | "publish"
  | "escrow-discover"
  | "escrow-publish"
  | "profile"
  | "settings";

export const DASHBOARD_ROUTES: Record<DirectoryView, string> = {
  discover: "/agents",
  publish: "/agents/publishing",
  "escrow-discover": "/escrows",
  "escrow-publish": "/escrows/publishing",
  profile: "/profile",
  settings: "/settings",
};

export const DIRECTORY_NAV: { value: DirectoryView; label: string }[] = [
  { value: "discover", label: "Agents" },
  { value: "publish", label: "Publishing" },
  { value: "escrow-discover", label: "Escrows" },
  { value: "escrow-publish", label: "Publishing" },
  { value: "settings", label: "Settings" },
];
