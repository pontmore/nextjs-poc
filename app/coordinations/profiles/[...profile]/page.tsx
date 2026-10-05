import { notFound, redirect } from "next/navigation";
import { CoordinationViewer } from "../../../../components/coordination-viewer";
import {
  coordinationProfileHref,
  isCoordinationProfile,
  isCoordinationProfileSlug,
  normalizeCoordinationProfile,
  parseCoordinationProfilePath,
} from "../../../../lib/coordinations";
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profile: string[] }>;
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  const parts = (await params).profile;
  const original = parseCoordinationProfilePath(parts);
  if (original) redirect(coordinationProfileHref(original));
  let slug: string;
  try {
    slug = parts.map((part) => decodeURIComponent(part)).join("/");
  } catch {
    notFound();
  }
  if (!isCoordinationProfileSlug(slug)) notFound();
  const exact = (await searchParams).profile;
  if (
    exact !== undefined &&
    (!isCoordinationProfile(exact) ||
      normalizeCoordinationProfile(exact) !== slug)
  )
    notFound();
  return (
    <CoordinationViewer
      profileSlug={slug}
      profileFilter={exact as string | undefined}
    />
  );
}
