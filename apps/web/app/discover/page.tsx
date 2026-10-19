import { DiscoverList } from "../../components/discover/discover-list-view";

/**
 * /discover (S-1): the anonymous discovery list. The page reads no data; the client view fetches
 * /api/discover (P-17) and never mounts MeFrame's session gate (RC-6).
 */
export default function DiscoverPage() {
  return <DiscoverList />;
}
