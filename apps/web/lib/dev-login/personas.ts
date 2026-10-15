/**
 * Dev-login personas: the closed set the seed creates and the dev-login form offers. Obviously fake
 * data only. Every address uses the RFC 2606 reserved `.invalid` TLD, which can never be registered
 * or verified, so no real Google account can ever present one of these emails.
 *
 * `adminGrant` is the web admin row the seed gives the persona in the Dev Club tenant: `owner` comes
 * ONLY from tenant_provision (the onboarding club-create path), `co_admin` from the narrowest existing
 * entry point (see packages/db/scripts/dev-seed-club-members.ts), and `null` is a plain member.
 * (Named adminGrant, not role: no apps/web source decides on a role property — lib/role-read-guard.test.ts.)
 */
export type DevPersonaKey = "owner" | "co_admin" | "player";

export interface DevPersona {
  readonly key: DevPersonaKey;
  readonly email: string;
  readonly displayName: string;
  readonly adminGrant: "owner" | "co_admin" | null;
}

export const DEV_PERSONAS: readonly DevPersona[] = [
  {
    key: "owner",
    email: "dev-owner@dev.invalid",
    displayName: "DEV Owner (fake)",
    adminGrant: "owner",
  },
  {
    key: "co_admin",
    email: "dev-co-admin@dev.invalid",
    displayName: "DEV Co-admin (fake)",
    adminGrant: "co_admin",
  },
  {
    key: "player",
    email: "dev-player@dev.invalid",
    displayName: "DEV Player (fake)",
    adminGrant: null,
  },
];

/** The dev tenant the seed creates through the onboarding club-create path. */
export const DEV_CLUB = {
  slug: "dev-club",
  name: "Dev Club",
  timezone: "Asia/Ho_Chi_Minh",
  locale: "vi",
} as const;

/** Exact-match lookup on the closed set; anything else (case variants included) is null. */
export function devPersonaByKey(raw: string | null | undefined): DevPersona | null {
  return DEV_PERSONAS.find((persona) => persona.key === raw) ?? null;
}

/**
 * Keyed-subject namespace. The Google callback derives `plexco:web-auth:v1:google:<sub>`; dev
 * personas derive `plexco:web-auth:v1:dev-login:<key>`. Neither prefix is a prefix of the other, so no
 * HMAC input of one family can equal an input of the other: a dev subject hash can never collide
 * with a real Google subject hash (short of an HMAC-SHA256 collision).
 */
export const DEV_SUBJECT_NAMESPACE = "plexco:web-auth:v1:dev-login:";

export function devPersonaSubjectInput(persona: DevPersona): string {
  return `${DEV_SUBJECT_NAMESPACE}${persona.key}`;
}
