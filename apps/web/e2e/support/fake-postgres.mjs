// Minimal Postgres wire-protocol stub for the browser E2E (no real database, deterministic).
//
// WHY: /c/[tenantId]/* layouts call currentSession() on the SERVER, which runs ONE query
// (auth_resolve_web_session). The specs mock every /api call in the browser with page.route, but
// they cannot mock that server-side lookup, so this process answers it and nothing else:
//   - the session query returns a fixed account ONLY for the token the specs set as their cookie;
//     any other token resolves to zero rows (signed out);
//   - EVERY other statement is an ErrorResponse, so a code path that starts touching the database
//     (for example a signed-out page) fails loudly instead of silently passing.
// Not a general Postgres: extended protocol (Parse/Bind/Describe/Execute/Sync) and nothing else.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import net from "node:net";
import process from "node:process";

const PORT = Number(process.env.E2E_PG_PORT ?? 3218);
export const E2E_SESSION_TOKEN = "e2e-session-token";
const TOKEN_HASH = createHash("sha256").update(E2E_SESSION_TOKEN).digest("hex");

const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const msg = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from(type), i32(body.length + 4), body]);
};

const COLUMNS = [
  ["session_id", 2950],
  ["account_id", 2950],
  ["person_id", 2950],
  ["csrf_secret", 25],
  ["expires_at", 1184],
];
const ROW = [
  "00000000-0000-4000-8000-0000000000e1",
  "00000000-0000-4000-8000-0000000000e2",
  "00000000-0000-4000-8000-0000000000e3",
  "e2e-csrf-secret",
  "2099-01-01 00:00:00+00",
];

const rowDescription = () =>
  msg(
    "T",
    i16(COLUMNS.length),
    ...COLUMNS.map(([name, oid]) =>
      Buffer.concat([cstr(name), i32(0), i16(0), i32(oid), i16(-1), i32(-1), i16(0)]),
    ),
  );
const dataRow = () =>
  msg(
    "D",
    i16(ROW.length),
    ...ROW.map((v) => Buffer.concat([i32(Buffer.byteLength(v)), Buffer.from(v)])),
  );
const errorResponse = (text) =>
  msg("E", Buffer.from("SERROR\0"), Buffer.from("C0A000\0"), cstr(`M${text}`), Buffer.from([0]));
const ready = () => msg("Z", Buffer.from("I"));

function readCString(buf, offset) {
  const end = buf.indexOf(0, offset);
  return [buf.toString("utf8", offset, end), end + 1];
}

function handle(socket) {
  let buffer = Buffer.alloc(0);
  let started = false;
  let ops = [];
  let query = "";
  let param0 = null;

  const flush = () => {
    const out = [];
    const supported = /auth_resolve_web_session/.test(query);
    const matches = supported && param0 === TOKEN_HASH;
    for (const op of ops) {
      if (!supported) {
        out.push(errorResponse(`e2e fake postgres: unsupported statement: ${query.slice(0, 60)}`));
        break;
      }
      if (op === "P") out.push(msg("1"));
      else if (op === "B") out.push(msg("2"));
      else if (op === "DS") out.push(msg("t", i16(0)), rowDescription());
      else if (op === "DP") out.push(rowDescription());
      else if (op === "E") {
        if (matches) out.push(dataRow());
        out.push(msg("C", cstr(`SELECT ${matches ? 1 : 0}`)));
      }
    }
    ops = [];
    out.push(ready());
    socket.write(Buffer.concat(out));
  };

  const drain = () => {
    for (;;) {
      if (!started) {
        if (buffer.length < 8) return;
        const len = buffer.readInt32BE(0);
        if (buffer.length < len) return;
        const code = buffer.readInt32BE(4);
        buffer = buffer.subarray(len);
        if (code === 80877103) {
          socket.write("N"); // no SSL
          continue;
        }
        started = true;
        socket.write(
          Buffer.concat([
            msg("R", i32(0)),
            msg("S", cstr("server_version"), cstr("16.0")),
            msg("S", cstr("client_encoding"), cstr("UTF8")),
            msg("K", i32(1), i32(1)),
            ready(),
          ]),
        );
        continue;
      }
      if (buffer.length < 5) return;
      const type = String.fromCharCode(buffer[0]);
      const len = buffer.readInt32BE(1);
      if (buffer.length < len + 1) return;
      const body = buffer.subarray(5, len + 1);
      buffer = buffer.subarray(len + 1);
      if (type === "P") {
        const [, next] = readCString(body, 0);
        [query] = readCString(body, next);
        ops.push("P");
      } else if (type === "B") {
        let [, o] = readCString(body, 0); // portal
        [, o] = readCString(body, o); // statement
        const nFormats = body.readInt16BE(o);
        o += 2 + nFormats * 2;
        const nParams = body.readInt16BE(o);
        o += 2;
        param0 = null;
        if (nParams > 0) {
          const plen = body.readInt32BE(o);
          param0 = plen < 0 ? null : body.toString("utf8", o + 4, o + 4 + plen);
        }
        ops.push("B");
      } else if (type === "D") {
        ops.push(String.fromCharCode(body[0]) === "S" ? "DS" : "DP");
      } else if (type === "E") {
        ops.push("E");
      } else if (type === "S") {
        flush();
      } else if (type === "Q") {
        socket.write(
          Buffer.concat([errorResponse("e2e fake postgres: simple query unsupported"), ready()]),
        );
      } else if (type === "X") {
        socket.end();
        return;
      }
    }
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
  socket.on("error", () => socket.destroy());
}

net.createServer(handle).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`fake postgres for e2e listening on 127.0.0.1:${PORT}\n`);
});
