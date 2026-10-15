import { connect } from "node:net";
import { networkInterfaces } from "node:os";

/**
 * Defence in depth beyond the header gate (not one of the brief's four conditions): is THIS dev
 * server reachable on a non-loopback interface?
 *
 * Why it is needed. The gate's host evidence is the raw Host header, which any client can forge, and
 * Next keeps a client-supplied X-Forwarded-For as sent (it only fills it with `??=`). A plain
 * `next dev` listens on every interface, so a machine on the same network can send
 * `Host: localhost:3000` + `X-Forwarded-For: 127.0.0.1` and pass every header check. Neither the
 * middleware nor a route handler can see the socket, and Next's own `__NEXT_PRIVATE_ORIGIN` reports
 * `localhost` for both an all-interfaces and a loopback bind, so the bind cannot be read. It can be
 * MEASURED: connect to this server's port on each of the machine's own non-loopback addresses. A
 * loopback-only server (`next dev -H 127.0.0.1`) refuses those connections; an exposed one accepts.
 *
 * The answer is computed once per process (the bind cannot change while it runs). Fail closed: an
 * unknown port, or any accepted connection, is "exposed". What it cannot see: an address that is not
 * connectable from the machine itself (some VPN set-ups), and a local forwarder such as an SSH tunnel
 * (the forwarding-header rules cover the common tunnels; a raw TCP relay with a forged Host remains
 * a stated residual).
 */

const PROBE_TIMEOUT_MS = 400;

/** Resolves true when a TCP connection to address:port is accepted within the timeout. */
export function acceptsConnection(address: string, port: number, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: address, port });
    const done = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** The machine's own non-internal interface addresses (IPv4 and IPv6, link-local included). */
export function nonLoopbackAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) =>
      entry.family === "IPv6" && entry.scopeid
        ? `${entry.address}%${entry.scopeid}`
        : entry.address,
    );
}

export interface ExposureProbeDeps {
  port: string | undefined;
  addresses: () => string[];
  accepts: (address: string, port: number) => Promise<boolean>;
}

/** true = the server is reachable only over loopback. */
export async function probeLoopbackOnly(deps: ExposureProbeDeps): Promise<boolean> {
  const port = Number(deps.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const results = await Promise.all(deps.addresses().map((address) => deps.accepts(address, port)));
  return !results.includes(true);
}

let cached: Promise<boolean> | null = null;

/**
 * Process-wide verdict. `next dev` stores the port it actually bound in process.env.PORT
 * (next/dist/server/lib/start-server.js) before serving the first request.
 */
export function devServerLoopbackOnly(): Promise<boolean> {
  cached ??= probeLoopbackOnly({
    port: process.env.PORT,
    addresses: nonLoopbackAddresses,
    accepts: (address, port) => acceptsConnection(address, port),
  });
  return cached;
}

/** Test-only: forget the cached verdict. */
export function resetExposureProbeForTests(): void {
  cached = null;
}
