import type { APIRequestContext } from "@playwright/test";
import { isIP } from "node:net";

/**
 * The guard of the OPT-IN staging golden path (staging-golden-path.spec.ts). A pure function of the
 * environment: staging-golden-path.config.ts calls it at module load, before any browser starts, and
 * the spec calls it again. It returns the staging origin, or throws a refusal that names its reason.
 *
 * The rule (a reviewed code change; the staging host name is the owner's choice): the opt-in is
 * STAGING_GOLDEN_PATH=1 exactly; STAGING_BASE_URL must be set, parse, use https and carry no user
 * name or password; its host must be a subdomain of plexco.app whose first label starts with
 * "staging" (for example staging.plexco.app); plexco.app and www.plexco.app are refused by name,
 * loopback hosts and IP literals too; a PRODUCTION_BASE_URL that is set must parse, and its origin
 * must differ. Host checks compare the parsed hostname and its labels as plain strings.
 * The second export, signedInPersonId, is the spec's sign-in poll; it lives here so the default suite
 * can force its failure (the spec cannot be imported: its module load runs the guard).
 */
export const REFUSED = {
  optIn: "set STAGING_GOLDEN_PATH=1 to run the staging golden path",
  baseMissing: "STAGING_BASE_URL is not set",
  baseUnparsable: "STAGING_BASE_URL does not parse as a URL",
  productionUnparsable: "PRODUCTION_BASE_URL is set but does not parse as a URL",
  notHttps: "STAGING_BASE_URL must use https",
  userInfo: "STAGING_BASE_URL must not carry a user name or password",
  productionHost: "plexco.app and www.plexco.app are production",
  loopbackOrIp: "a loopback host or an IP literal is not staging",
  notStaging: 'the host must be a subdomain of plexco.app whose first label starts with "staging"',
  productionOrigin: "STAGING_BASE_URL has the origin of PRODUCTION_BASE_URL",
} as const;

function refuse(reason: string): never {
  throw new Error(`staging golden path refused: ${reason}`);
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function stagingGoldenPathOrigin(env: Readonly<Record<string, string | undefined>>): string {
  if (env.STAGING_GOLDEN_PATH !== "1") refuse(REFUSED.optIn);
  const raw = env.STAGING_BASE_URL;
  if (!raw) refuse(REFUSED.baseMissing);
  const url = parse(raw);
  if (!url) refuse(REFUSED.baseUnparsable);
  // "set" means present in the environment, even empty: a value that cannot be proven safe refuses
  const productionRaw = env.PRODUCTION_BASE_URL;
  const production = productionRaw === undefined ? null : parse(productionRaw);
  if (productionRaw !== undefined && !production) refuse(REFUSED.productionUnparsable);
  if (url.protocol !== "https:") refuse(REFUSED.notHttps);
  if (url.username !== "" || url.password !== "") refuse(REFUSED.userInfo);
  const host = url.hostname; // lower-cased by the URL parser; IPv4 in dotted form, IPv6 in brackets
  const labels = host.split(".");
  if (host === "plexco.app" || host === "www.plexco.app") {
    refuse(`${REFUSED.productionHost} (host ${host})`);
  }
  if (host.startsWith("[") || isIP(host) !== 0 || labels[labels.length - 1] === "localhost") {
    refuse(`${REFUSED.loopbackOrIp} (host ${host})`);
  }
  const staging =
    labels.length >= 3 &&
    labels.every((label) => label !== "") &&
    (labels[0] ?? "").startsWith("staging") &&
    labels[labels.length - 2] === "plexco" &&
    labels[labels.length - 1] === "app";
  if (!staging) refuse(`${REFUSED.notStaging} (host ${host})`);
  if (production && production.origin === url.origin) refuse(REFUSED.productionOrigin);
  return url.origin;
}

export const SESSION_POLL_NO_RESPONSE =
  "owner sign-in poll: GET /api/auth/session got no response (Playwright's error is withheld: its call log lists the request headers)";

/** The signed-in person's id (GET /api/auth/session answers 200 with data.personId), else null. */
export async function signedInPersonId(request: APIRequestContext): Promise<string | null> {
  // Playwright's error is never passed on: its call log lists every request header, the session
  // cookie included, and the list reporter prints it
  const res = await request.get("/api/auth/session").catch(() => null);
  if (res === null) throw new Error(SESSION_POLL_NO_RESPONSE);
  if (res.status() !== 200) return null;
  const personId: unknown = (await res.json().catch(() => null))?.data?.personId;
  return typeof personId === "string" && personId !== "" ? personId : null;
}
