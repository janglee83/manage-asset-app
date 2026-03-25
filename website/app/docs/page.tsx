/**
 * /docs root — redirects to the first doc in the nav tree.
 *
 * Using a server-side redirect (not client) so crawlers and link-sharing
 * both resolve to the canonical first page without a flash of blank content.
 */

import { redirect } from "next/navigation";
import { firstDocSlug } from "@/lib/nav";

export default function DocsRootPage() {
  redirect(`/docs/${firstDocSlug()}`);
}
