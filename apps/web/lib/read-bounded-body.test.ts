import { describe, expect, it, vi } from "vitest";
import { readBoundedBody } from "./read-bounded-body";

function nativeRequest(source: UnderlyingDefaultSource<Uint8Array>, declared?: string) {
  return new Request("https://plexco.app/", {
    method: "POST",
    headers: declared === undefined ? {} : { "content-length": declared },
    body: new ReadableStream(source, { highWaterMark: 0 }),
    duplex: "half",
  } as RequestInit);
}

function streamed(chunks: Uint8Array[], declared?: string) {
  let index = 0;
  let ended = false;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else {
      ended = true;
      controller.close();
    }
  });
  const request = nativeRequest({ pull, cancel }, declared);
  return { request, pull, cancel, ended: () => ended };
}

describe.each([1024, 4096, 65536])("readBoundedBody at %i bytes", (cap) => {
  it.each([undefined, "1", "invalid", "-1", "Infinity", "exact"])(
    "counts actual bytes with Content-Length=%s at and below the cap",
    async (declared) => {
      for (const length of [cap - 1, cap]) {
        const text = "x".repeat(length);
        const header = declared === "exact" ? String(cap) : declared;
        const { request } = streamed([new TextEncoder().encode(text)], header);
        expect(await readBoundedBody(request, cap)).toEqual({ ok: true, text });
      }
    },
  );

  it.each([undefined, "1", "exact"])(
    "cancels cumulative overflow before EOF (%s)",
    async (header) => {
      const source = streamed(
        [new Uint8Array(cap / 2), new Uint8Array(cap / 2), new Uint8Array(1)],
        header === "exact" ? String(cap) : header,
      );
      expect(await readBoundedBody(source.request, cap)).toEqual({
        ok: false,
        reason: "too_large",
      });
      expect(source.pull).toHaveBeenCalledTimes(3);
      expect(source.cancel).toHaveBeenCalledOnce();
      expect(source.ended()).toBe(false);
    },
  );

  it("refuses an oversized declared length before acquiring or pulling the stream", async () => {
    const source = streamed([new Uint8Array(1)], String(cap + 1));
    expect(await readBoundedBody(source.request, cap)).toEqual({ ok: false, reason: "too_large" });
    expect(source.pull).not.toHaveBeenCalled();
    expect(source.cancel).not.toHaveBeenCalled();
    expect(source.request.bodyUsed).toBe(false);
    expect(source.request.body?.locked).toBe(false);
  });

  it("preserves split UTF-8 at the exact byte ceiling", async () => {
    const exact = new TextEncoder().encode("x".repeat(cap - 11) + "Đà✓🏸");
    expect(exact.byteLength).toBe(cap);
    const { request } = streamed([
      exact.subarray(0, cap - 11),
      ...Array.from(exact.subarray(cap - 11), (byte) => Uint8Array.of(byte)),
    ]);
    expect(await readBoundedBody(request, cap)).toEqual({
      ok: true,
      text: "x".repeat(cap - 11) + "Đà✓🏸",
    });
  });

  it.each([[0x80], [0x81], [0xe2, 0x82]])("rejects malformed raw UTF-8 %j", async (...bytes) => {
    const { request } = streamed([Uint8Array.from(bytes)]);
    expect(await readBoundedBody(request, cap)).toEqual({
      ok: false,
      reason: "malformed_encoding",
    });
  });
});

describe("readBoundedBody native failures", () => {
  it("returns empty text for an absent or empty body", async () => {
    for (const request of [
      new Request("https://plexco.app/", { method: "POST" }),
      streamed([]).request,
    ]) {
      expect(await readBoundedBody(request, 1024)).toEqual({ ok: true, text: "" });
    }
  });

  it.each(["read", "cancel"])("propagates the original %s rejection", async (kind) => {
    const failure = new Error(`${kind} failed`);
    const request = nativeRequest({
      pull(controller) {
        if (kind === "read") throw failure;
        controller.enqueue(new Uint8Array(1025));
      },
      cancel() {
        throw failure;
      },
    });
    await expect(readBoundedBody(request, 1024)).rejects.toBe(failure);
  });

  it("propagates a native getReader fault for a locked request body", async () => {
    const { request } = streamed([]);
    const lock = request.body!.getReader();
    try {
      await expect(readBoundedBody(request, 1024)).rejects.toBeInstanceOf(TypeError);
    } finally {
      lock.releaseLock();
    }
  });

  it("awaits cancellation settlement without reading more bytes", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
      controller.enqueue(new Uint8Array(1025)),
    );
    const request = nativeRequest({
      pull,
      cancel() {
        entered();
        return cancelled;
      },
    });
    let settled = false;
    const pending = readBoundedBody(request, 1024).then((value) => {
      settled = true;
      return value;
    });
    try {
      await started;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(pull).toHaveBeenCalledOnce();
    } finally {
      release();
      await pending;
    }
    expect(await pending).toEqual({ ok: false, reason: "too_large" });
  });
});
