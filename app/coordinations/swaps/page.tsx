import { redirect } from "next/navigation";
import {
  coordinationProfileHref,
  SWAP_PROFILE,
} from "../../../lib/coordinations";
export default function SwapsPage() {
  redirect(coordinationProfileHref(SWAP_PROFILE));
}
