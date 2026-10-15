import { createServer, type AddressInfo, type Server } from "node:net";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  nonLoopbackAddresses,
  openReferenceListener,
  probeAddress,
  probeLoopbackOnly,
  type ProbeOutcome,
} from "./network-exposure";

const servers: Server[] = [];

function listen(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    server.once("error", reject);
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** probe(address, port): the server answers on port 3000, the reference on port 9. */
function fakeProbe(
  server: Record<string, ProbeOutcome>,
  reference: Record<string, ProbeOutcome> = {},
) {
  return async (address: string, port: number): Promise<ProbeOutcome> =>
    (port === 9 ? reference[address] : server[address]) ?? "unknown";
}
const fakeReference = async () => ({ port: 9, close: async () => {} });

describe("probeLoopbackOnly fails closed", () => {
  it("passes when every address refuses", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["192.168.1.5", "fe80::1%en0"],
        probe: fakeProbe({ "192.168.1.5": "refused", "fe80::1%en0": "refused" }),
        reference: fakeReference,
      }),
    ).toBe(true);
  });

  it("an accepted connection is exposed", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["192.168.1.5", "10.0.0.2"],
        probe: fakeProbe({ "192.168.1.5": "refused", "10.0.0.2": "accepted" }),
        reference: fakeReference,
      }),
    ).toBe(false);
  });

  it("a timeout on an address the reference CAN reach is exposed (no clean refusal there)", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["192.168.1.5"],
        probe: fakeProbe({ "192.168.1.5": "unknown" }, { "192.168.1.5": "accepted" }),
        reference: fakeReference,
      }),
    ).toBe(false);
  });

  it("a timeout on an address the reference cannot reach either is unmeasurable: bind evidence decides", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["192.168.1.5", "fe80::aa%utun0"],
        probe: fakeProbe({ "192.168.1.5": "refused", "fe80::aa%utun0": "unknown" }),
        reference: fakeReference,
      }),
    ).toBe(true);
  });

  it("cannot open the reference listener => exposed", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["fe80::aa%utun0"],
        probe: fakeProbe({}),
        reference: async () => {
          throw new Error("EADDRNOTAVAIL");
        },
      }),
    ).toBe(false);
  });

  it.each([undefined, "", "0", "65536", "abc", "3000.5", "03000"])(
    "treats an unknown port %j as exposed",
    async (port) => {
      expect(
        await probeLoopbackOnly({
          port,
          addresses: () => [],
          probe: fakeProbe({}),
          reference: fakeReference,
        }),
      ).toBe(false);
    },
  );

  it("passes with no non-loopback address (offline; the bind evidence is the precondition)", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => [],
        probe: fakeProbe({}),
        reference: fakeReference,
      }),
    ).toBe(true);
  });
});

describe("nonLoopbackAddresses", () => {
  it("skips internal interfaces and scopes IPv6 link-local by INTERFACE NAME", () => {
    const entry = (over: Partial<NetworkInterfaceInfo>) =>
      ({ netmask: "", mac: "", cidr: null, internal: false, ...over }) as NetworkInterfaceInfo;
    const addresses = nonLoopbackAddresses({
      lo0: [entry({ address: "127.0.0.1", family: "IPv4", internal: true })],
      en0: [
        entry({ address: "192.168.1.5", family: "IPv4" }),
        entry({ address: "fe80::1c2:3", family: "IPv6", scopeid: 14 }),
        entry({ address: "2405:4802::5", family: "IPv6", scopeid: 0 }),
      ],
      utun3: [entry({ address: "fe80::aa%utun3", family: "IPv6", scopeid: 22 })],
    });
    expect(addresses).toEqual(["192.168.1.5", "fe80::1c2:3%en0", "2405:4802::5", "fe80::aa%utun3"]);
  });
});

describe("real sockets", () => {
  it("probeAddress reports accepted / refused", async () => {
    const port = await listen("127.0.0.1");
    expect(await probeAddress("127.0.0.1", port)).toBe("accepted");
    const closed = await listen("127.0.0.1");
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    expect(await probeAddress("127.0.0.1", closed)).toBe("refused");
  });

  it("an event-loop stall longer than the timeout cannot flip a completed connect into 'unknown'", async () => {
    const port = await listen("127.0.0.1");
    const pending = probeAddress("127.0.0.1", port, 100);
    await new Promise<void>((resolve) => process.nextTick(resolve)); // the connect is issued
    const until = Date.now() + 600; // the reviewer measured 420-1500 ms stalls
    while (Date.now() < until) {
      // block the event loop: the connect completes in the kernel meanwhile
    }
    expect(await pending).toBe("accepted");
  });

  it("the real probe: a 127.0.0.1-bound server passes, an all-interfaces one does not", async () => {
    const real = (port: number) => ({
      port: String(port),
      addresses: () => nonLoopbackAddresses(),
      probe: (address: string, p: number) => probeAddress(address, p),
      reference: openReferenceListener,
    });
    expect(await probeLoopbackOnly(real(await listen("127.0.0.1")))).toBe(true);
    if (nonLoopbackAddresses().length === 0) return; // offline: nothing can be exposed
    expect(await probeLoopbackOnly(real(await listen("::")))).toBe(false);
    expect(await probeLoopbackOnly(real(await listen("0.0.0.0")))).toBe(false);
  });
});
