import { OfflineView } from "../../components/pwa/offline-view";

/** Service-worker fallback for failed navigations. Static: no session, no data (HR2). */
export default function OfflinePage() {
  return <OfflineView />;
}
