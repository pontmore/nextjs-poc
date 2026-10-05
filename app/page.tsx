import { redirect } from "next/navigation";
import { AgentDirectory } from "../components/agent-directory";
import { DASHBOARD_ROUTES, type DirectoryView } from "../lib/dashboard-routes";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const tab = typeof query.tab === "string" ? query.tab : "";
  if (Object.hasOwn(DASHBOARD_ROUTES, tab)) {
    const params = new URLSearchParams();
    for (const key of ["agent", "escrow"])
      if (typeof query[key] === "string") params.set(key, query[key]);
    const suffix = params.toString();
    redirect(
      `${DASHBOARD_ROUTES[tab as DirectoryView]}${suffix ? `?${suffix}` : ""}`,
    );
  }
  return <AgentDirectory />;
}
