import { createServer, type AddressInfo, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { acceptsConnection, nonLoopbackAddresses, probeLoopbackOnly } from "./network-exposure";

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

describe("probeLoopbackOnly (pure decision, injected I/O)", () => {
  const never = async () => false;

  it("is loopback-only when no non-loopback address accepts", async () => {
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["192.168.1.5", "fe80::1%4"],
        accepts: never,
      }),
    ).toBe(true);
  });

  it("is exposed as soon as one address accepts", async () => {
    const accepts = async (address: string) => address === "192.168.1.5";
    expect(
      await probeLoopbackOnly({
        port: "3000",
        addresses: () => ["10.0.0.2", "192.168.1.5"],
        accepts,
      }),
    ).toBe(false);
  });

  it.each([undefined, "", "0", "65536", "abc", "3000.5"])(
    "fails closed (exposed) for an unknown port %j",
    async (port) => {
      expect(await probeLoopbackOnly({ port, addresses: () => [], accepts: never })).toBe(false);
    },
  );

  it("is loopback-only on a machine with no non-loopback interface", async () => {
    expect(await probeLoopbackOnly({ port: "3000", addresses: () => [], accepts: never })).toBe(
      true,
    );
  });
});

describe("acceptsConnection / the real probe against real sockets", () => {
  it("sees a listener and a refused port", async () => {
    const port = await listen("127.0.0.1");
    expect(await acceptsConnection("127.0.0.1", port)).toBe(true);
    const closed = await listen("127.0.0.1");
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    expect(await acceptsConnection("127.0.0.1", closed)).toBe(false);
  });

  it("a loopback-bound server is NOT reachable on this machine's other addresses; an all-interfaces one is", async () => {
    const addresses = nonLoopbackAddresses();
    const ipv4 = addresses.filter((address) => !address.includes(":"));
    if (ipv4.length === 0) return; // a machine with no non-loopback IPv4 cannot be exposed over it
    const loopbackPort = await listen("127.0.0.1");
    expect(
      await probeLoopbackOnly({
        port: String(loopbackPort),
        addresses: () => ipv4,
        accepts: acceptsConnection,
      }),
    ).toBe(true);
    const exposedPort = await listen("0.0.0.0");
    expect(
      await probeLoopbackOnly({
        port: String(exposedPort),
        addresses: () => ipv4,
        accepts: acceptsConnection,
      }),
    ).toBe(false);
  });
});
