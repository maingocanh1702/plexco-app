import { connect, createServer, type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";

/**
 * Second defence behind the gate's POSITIVE bind evidence (gate.ts loopbackBindEvidence: Next
 * reports the server bound to exactly 127.0.0.1 on its real port). This probe MEASURES the same
 * fact on every request: it connects to this server's port on each of the machine's own
 * non-loopback addresses. Nothing is cached; a laptop that joins a network is re-checked.
 *
 * Per address, fail closed:
 *  - CONNECT                 => the server is reachable there: EXPOSED.
 *  - ECONNREFUSED            => nothing listens on that address/port: fine.
 *  - timeout or other error  => re-tested against a REFERENCE listener bound to every interface
 *    (accept-and-close, open only for the duration of this check). If the reference IS reachable
 *    at that address, the address is measurable and the server gave no clean refusal there:
 *    EXPOSED. If the reference is not reachable either, the address cannot carry a connection from
 *    this machine to any local listener, and the 127.0.0.1 bind evidence (a hard precondition,
 *    checked first) decides.
 * Measured on this repo's dev machine (macOS, 2026-10-15): every IPv4, global/ULA IPv6 and the
 * en0/ap1/llw0 link-local addresses answer ECONNREFUSED in about 1 ms for a 127.0.0.1-bound server
 * and CONNECT for an all-interfaces one; the awdl0 and utun0-3 link-local addresses time out for
 * BOTH. "Timeout = exposed" alone would refuse `next dev -H 127.0.0.1` on every such Mac.
 *
 * Event-loop stalls: a timer that fires after a stall runs before the poll phase that delivers an
 * already-completed connect. The timeout decision is therefore deferred with setImmediate (check
 * phase, after poll), so the connect outcome wins.
 *
 * Zero non-loopback addresses (offline): nothing can reach the server from another machine at that
 * moment, and the bind evidence already proved a 127.0.0.1-only bind, so the probe passes.
 *
 * IPv6 link-local addresses are scoped by INTERFACE NAME (fe80::…%en0): a numeric scope id
 * (fe80::…%14) never connects (measured), which would read as an unmeasurable address.
 */

const PROBE_TIMEOUT_MS = 300;

export type ProbeOutcome = "refused" | "accepted" | "unknown";

/** One TCP connect attempt: "refused" only for ECONNREFUSED, "accepted" on connect. */
export function probeAddress(
  address: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false;
    const socket = connect({ host: address, port });
    const done = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => setImmediate(() => done("unknown")), timeoutMs);
    socket.once("connect", () => done("accepted"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ECONNREFUSED" ? "refused" : "unknown"),
    );
  });
}

export interface ReferenceListener {
  port: number;
  close: () => Promise<void>;
}

/** An accept-and-close listener on every interface (IPv6 dual-stack, else IPv4). */
export function openReferenceListener(): Promise<ReferenceListener> {
  const attempt = (host: string) =>
    new Promise<ReferenceListener>((resolve, reject) => {
      const server = createServer((socket) => socket.destroy());
      server.once("error", reject);
      server.listen(0, host, () =>
        resolve({
          port: (server.address() as AddressInfo).port,
          close: () => new Promise<void>((done) => server.close(() => done())),
        }),
      );
    });
  return attempt("::").catch(() => attempt("0.0.0.0"));
}

const LINK_LOCAL_V6 = /^fe[89ab][0-9a-f]:/i;

/** The machine's own non-internal addresses; IPv6 link-local ones carry `%<interface name>`. */
export function nonLoopbackAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  return Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => !entry.internal)
      .map((entry) =>
        entry.family === "IPv6" && LINK_LOCAL_V6.test(entry.address)
          ? `${entry.address.split("%")[0]}%${name}`
          : entry.address,
      ),
  );
}

export interface ExposureProbeDeps {
  port: string | undefined;
  addresses: () => string[];
  probe: (address: string, port: number) => Promise<ProbeOutcome>;
  reference: () => Promise<ReferenceListener>;
}

/** true = not reachable on any measurable non-loopback address (see the header for the rules). */
export async function probeLoopbackOnly(deps: ExposureProbeDeps): Promise<boolean> {
  const raw = deps.port;
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
    return false;
  }
  const port = Number(raw);
  const addresses = deps.addresses();
  const outcomes = await Promise.all(addresses.map((address) => deps.probe(address, port)));
  if (outcomes.includes("accepted")) return false;
  const unclear = addresses.filter((_, index) => outcomes[index] === "unknown");
  if (unclear.length === 0) return true;

  let reference: ReferenceListener;
  try {
    reference = await deps.reference();
  } catch {
    return false; // cannot classify: fail closed
  }
  try {
    const control = await Promise.all(
      unclear.map((address) => deps.probe(address, reference.port)),
    );
    // Reachable for the reference, yet no clean refusal for the server: fail closed.
    return !control.includes("accepted");
  } finally {
    await reference.close();
  }
}

/** Re-measured on every call; never cached. */
export function devServerLoopbackOnly(): Promise<boolean> {
  return probeLoopbackOnly({
    port: process.env.PORT,
    addresses: () => nonLoopbackAddresses(),
    probe: (address, port) => probeAddress(address, port),
    reference: openReferenceListener,
  });
}
