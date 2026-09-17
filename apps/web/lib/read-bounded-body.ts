type BoundedBody =
  { ok: true; text: string } | { ok: false; reason: "too_large" | "malformed_encoding" };

export async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" }; // no stream = no body

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  try {
    // Reject invalid bytes instead of collapsing distinct client input to replacement characters.
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    };
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }
}
