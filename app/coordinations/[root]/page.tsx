import { notFound } from "next/navigation";
import { CoordinationViewer } from "../../../components/coordination-viewer";
import { parseRootId } from "../../../lib/coordinations";
export default async function CoordinationPage({
  params,
}: {
  params: Promise<{ root: string }>;
}) {
  const id = parseRootId((await params).root);
  if (!id) notFound();
  return <CoordinationViewer rootId={id} />;
}
