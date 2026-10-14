/** Join truthy class names (CSS Modules); avoids a classnames dependency. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
