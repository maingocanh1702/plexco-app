import { describe, expect, it } from "vitest";
import {
  devLoginNotFound,
  evaluateDevLoginGate,
  forwardingHeadersDisqualify,
  gateClosedRemedy,
  loopbackBindEvidence,
  parseLoopbackHost,
  readDevLoginEnv,
} from "./gate";

const OPEN_ENV = {
  NODE_ENV: "development",
  PLEXCO_DEV_LOGIN: "1",
  TRUSTED_INGRESS_PROVIDER: "direct",
  DATABASE_URL: "postgres://app:plexco_dev_app@localhost:5432/plexco",
  // What next dev -H 127.0.0.1 -p 3311 stores (measured).
  __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3311",
  PORT: "3311",
};

/** Exactly what next@15.5.25 hands a handler for a direct curl to 127.0.0.1:3311 (measured). */
function directHeaders(host = "127.0.0.1:3311", extra: Record<string, string> = {}): Headers {
  const port = host.includes("]:") ? host.split("]:")[1]! : (host.split(":")[1] ?? "80");
  return new Headers({
    host,
    accept: "*/*",
    "user-agent": "curl/8.6.0",
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-host": host,
    "x-forwarded-port": port,
    "x-forwarded-proto": "http",
    ...extra,
  });
}

describe("parseLoopbackHost — strict raw Host parsing", () => {
  it.each([
    ["localhost", null],
    ["localhost:3000", "3000"],
    ["127.0.0.1", null],
    ["127.0.0.1:3311", "3311"],
    ["[::1]", null],
    ["[::1]:3000", "3000"],
    ["localhost:65535", "65535"],
  ])("accepts %s", (host, port) => {
    expect(parseLoopbackHost(host)).toEqual({ port });
  });

  it.each([
    null,
    "",
    "localhost.evil.test",
    "localhost.evil.test:3000",
    "127.0.0.1.nip.io",
    "127.0.0.1.nip.io:3000",
    "evil.test",
    "user@localhost",
    "user:pass@localhost:3000",
    "localhost.",
    "localhost:",
    "localhost:0",
    "localhost:03000",
    "localhost:65536",
    "localhost:3000:3000",
    "LOCALHOST",
    "Localhost:3000",
    "::1",
    "[::1",
    "[0:0:0:0:0:0:0:1]:3000",
    "127.1",
    "127.0.0.2:3000",
    "0.0.0.0:3000",
    "2130706433",
    " localhost",
    "localhost:3000/evil",
    "localhost%2e",
  ])("refuses %j", (host) => {
    expect(parseLoopbackHost(host)).toBeNull();
  });
});

describe("forwarding headers: Next's own injection passes, anything else closes", () => {
  it("passes exactly what next dev injects for a direct loopback request (IPv4, IPv6, mapped)", () => {
    expect(forwardingHeadersDisqualify(directHeaders(), "127.0.0.1:3311", "3311")).toBe(false);
    const v6 = directHeaders("[::1]:3000", { "x-forwarded-for": "::1" });
    expect(forwardingHeadersDisqualify(v6, "[::1]:3000", "3000")).toBe(false);
    const mapped = directHeaders("localhost:3000", { "x-forwarded-for": "::ffff:127.0.0.1" });
    expect(forwardingHeadersDisqualify(mapped, "localhost:3000", "3000")).toBe(false);
  });

  it("passes when no forwarding header is present at all", () => {
    expect(forwardingHeadersDisqualify(new Headers({ host: "localhost" }), "localhost", null)).toBe(
      false,
    );
  });

  it.each([
    ["x-forwarded-for", "203.0.113.9"],
    ["x-forwarded-for", "127.0.0.1, 203.0.113.9"],
    ["x-forwarded-for", "10.0.0.5"],
    ["x-forwarded-host", "abc.ngrok-free.app"],
    ["x-forwarded-host", "localhost:3311"],
    ["x-forwarded-port", "443"],
    ["x-forwarded-proto", "https"],
  ])("closes on a tampered injected header %s: %s", (name, value) => {
    expect(
      forwardingHeadersDisqualify(
        directHeaders("127.0.0.1:3311", { [name]: value }),
        "127.0.0.1:3311",
        "3311",
      ),
    ).toBe(true);
  });

  it.each([
    ["forwarded", "for=203.0.113.9;host=abc.ngrok.io"],
    ["via", "1.1 proxy"],
    ["x-real-ip", "203.0.113.9"],
    ["x-forwarded-server", "proxy"],
    ["x-forwarded-ssl", "on"],
    ["x-original-host", "evil.test"],
    ["x-host", "evil.test"],
    ["cf-connecting-ip", "203.0.113.9"],
    ["cf-ray", "abc"],
    ["true-client-ip", "203.0.113.9"],
    ["x-client-ip", "203.0.113.9"],
    ["fly-client-ip", "203.0.113.9"],
    ["do-connecting-ip", "203.0.113.9"],
    ["tailscale-user-login", "someone@example.com"],
  ])("closes on any proxy/tunnel header %s", (name, value) => {
    expect(
      forwardingHeadersDisqualify(
        directHeaders("127.0.0.1:3311", { [name]: value }),
        "127.0.0.1:3311",
        "3311",
      ),
    ).toBe(true);
  });

  it("does not mistake ordinary browser headers for forwarding headers", () => {
    const browser = directHeaders("localhost:3000", {
      "x-forwarded-for": "::1",
      origin: "http://localhost:3000",
      referer: "http://localhost:3000/dev-login",
      cookie: "plx_dev_login_csrf=abc",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-ch-ua": '"Chromium";v="141"',
      "accept-language": "vi,en",
      "content-type": "application/x-www-form-urlencoded",
      "upgrade-insecure-requests": "1",
      rsc: "1",
      "next-router-state-tree": "%5B%5D",
    });
    expect(forwardingHeadersDisqualify(browser, "localhost:3000", "3000")).toBe(false);
  });
});

describe("evaluateDevLoginGate — the matrix: each condition false on its own closes the gate", () => {
  it("opens with every condition true", () => {
    expect(evaluateDevLoginGate(OPEN_ENV, directHeaders())).toEqual({ open: true });
  });

  it.each([
    ["node_env", { NODE_ENV: "production" }],
    ["flag", { PLEXCO_DEV_LOGIN: undefined }],
    ["flag", { PLEXCO_DEV_LOGIN: "0" }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: "fly" }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: undefined }],
    ["database_url", { DATABASE_URL: "postgres://app:x@db.internal:5432/plexco" }],
  ])("environment: closes with %s", (reason, override) => {
    expect(evaluateDevLoginGate({ ...OPEN_ENV, ...override }, directHeaders())).toEqual({
      open: false,
      reason,
    });
  });

  it.each([
    ["no -H / -H 0.0.0.0 (binds *)", { __NEXT_PRIVATE_ORIGIN: "http://localhost:3311" }],
    [
      "-H :: (binds *) and -H ::1 report the same origin",
      { __NEXT_PRIVATE_ORIGIN: "http://[::1]:3311" },
    ],
    ["-H 192.168.1.20", { __NEXT_PRIVATE_ORIGIN: "http://192.168.1.20:3311" }],
    ["origin not written yet", { __NEXT_PRIVATE_ORIGIN: undefined }],
    ["origin port differs from the real port", { PORT: "3312" }],
    ["no PORT", { PORT: undefined }],
    ["https origin", { __NEXT_PRIVATE_ORIGIN: "https://127.0.0.1:3311" }],
  ])("bind: closes without exact 127.0.0.1 bind evidence (%s)", (_, override) => {
    expect(evaluateDevLoginGate({ ...OPEN_ENV, ...override }, directHeaders())).toEqual({
      open: false,
      reason: "bind",
    });
  });

  it.each(["localhost.evil.test:3311", "192.168.1.20:3311", "", "plexco.app"])(
    "host: closes for Host %j even with matching injected headers",
    (host) => {
      expect(evaluateDevLoginGate(OPEN_ENV, directHeaders(host))).toEqual({
        open: false,
        reason: "host",
      });
    },
  );

  it("host: closes when the Host header is absent (HTTP/1.0), never falling back to x-forwarded-host", () => {
    const headers = new Headers({
      "x-forwarded-host": "127.0.0.1",
      "x-forwarded-for": "127.0.0.1",
    });
    expect(evaluateDevLoginGate(OPEN_ENV, headers)).toEqual({ open: false, reason: "host" });
  });

  it.each([
    ["localhost", "127.0.0.1"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "::1"],
  ])(
    "host: a port-less Host %s stays closed and is labelled host, not forwarded (N2)",
    (host, socket) => {
      // curl -H 'Host: localhost' http://127.0.0.1:3311/...: Next injects x-forwarded-port 3311.
      const portless = directHeaders(host, {
        "x-forwarded-port": "3311",
        "x-forwarded-for": socket,
      });
      // The decision input is unchanged: the forwarding check itself still refuses it...
      expect(forwardingHeadersDisqualify(portless, host, null)).toBe(true);
      // ...so the decision stays closed; only the label says what is actually wrong.
      expect(evaluateDevLoginGate(OPEN_ENV, portless)).toEqual({ open: false, reason: "host" });
    },
  );

  it("forwarded: a port-less Host keeps the forwarded label when something else disqualifies it", () => {
    const viaProxy = directHeaders("localhost", { "x-forwarded-port": "3311", via: "1.1 proxy" });
    expect(evaluateDevLoginGate(OPEN_ENV, viaProxy)).toEqual({ open: false, reason: "forwarded" });
    const clientSetPort = directHeaders("localhost", { "x-forwarded-port": "8080" });
    expect(evaluateDevLoginGate(OPEN_ENV, clientSetPort)).toEqual({
      open: false,
      reason: "forwarded",
    });
    // A Host naming another port is a port-forward (ssh -L 8080:localhost:3311), not a missing port.
    const portForward = directHeaders("localhost:8080", { "x-forwarded-port": "3311" });
    expect(evaluateDevLoginGate(OPEN_ENV, portForward)).toEqual({
      open: false,
      reason: "forwarded",
    });
  });

  it("forwarded: a tunnel that rewrites Host to localhost still closes (ngrok --host-header=rewrite)", () => {
    const tunnel = new Headers({
      host: "localhost:3000",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-host": "abc.ngrok-free.app",
      "x-forwarded-proto": "https",
      "x-forwarded-port": "3000",
    });
    expect(evaluateDevLoginGate(OPEN_ENV, tunnel)).toEqual({ open: false, reason: "forwarded" });
  });

  it("forwarded: a LAN client that does not forge X-Forwarded-For is closed by Next's own injected value", () => {
    // Next fills x-forwarded-for with the socket address when the client sends none.
    const lan = directHeaders("localhost:3000", { "x-forwarded-for": "192.168.1.50" });
    expect(evaluateDevLoginGate(OPEN_ENV, lan)).toEqual({ open: false, reason: "forwarded" });
  });
});

describe("helpers", () => {
  it("readDevLoginEnv reads exactly the gate's variables", () => {
    expect(Object.keys(readDevLoginEnv()).sort()).toEqual(
      [
        "DATABASE_URL",
        "NODE_ENV",
        "PLEXCO_DEV_LOGIN",
        "PORT",
        "TRUSTED_INGRESS_PROVIDER",
        "__NEXT_PRIVATE_ORIGIN",
      ].sort(),
    );
  });

  it("loopbackBindEvidence accepts exactly http://127.0.0.1:<PORT>", () => {
    expect(loopbackBindEvidence(OPEN_ENV)).toBe(true);
    expect(loopbackBindEvidence({ ...OPEN_ENV, PORT: "03311" })).toBe(false);
    expect(
      loopbackBindEvidence({
        ...OPEN_ENV,
        PORT: "70000",
        __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:70000",
      }),
    ).toBe(false);
    expect(
      loopbackBindEvidence({ ...OPEN_ENV, __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3311/" }),
    ).toBe(false);
  });

  it("the host remedy names the port, since a port-less Host is reported as host", () => {
    expect(gateClosedRemedy("host")).toMatch(/http:\/\/localhost:<port>\/dev-login/);
    expect(gateClosedRemedy("host")).toMatch(/carry the dev server's port/);
    expect(gateClosedRemedy("forwarded")).toMatch(/proxy or tunnel/);
  });

  it("the second-layer refusal is a bare 404 that never caches", async () => {
    const response = devLoginNotFound();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
