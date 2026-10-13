import { OfflineView } from "../../components/pwa/offline-view";

// Fallback for a direct visit (the service worker injects the real value for failed navigations).
// Runs while the document parses, before Next rewrites the URL to /offline. Same-origin path only:
// the value is re-validated client-side (must start with a single "/") before it is navigated to.
const CAPTURE_REQUESTED_URL =
  "(function(){if(window.__plxReturnTo)return;var p=location.pathname,u=p+location.search+location.hash;" +
  'window.__plxReturnTo=(p==="/offline"||u.charAt(0)!=="/"||u.charAt(1)==="/")?"/":u})()';

/** Service-worker fallback for failed navigations. Static: no session, no data (HR2). */
export default function OfflinePage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CAPTURE_REQUESTED_URL }} />
      <OfflineView />
    </>
  );
}
