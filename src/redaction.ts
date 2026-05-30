import { createHash } from "node:crypto";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // PEM private keys
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  // Named API key assignments (e.g. MY_API_KEY=abc123)
  [/\b[A-Za-z0-9_]*API[_-]?KEY\s*=\s*['"]?[^'"\s]+/gi, "API_KEY=[REDACTED_SECRET]"],
  // Well-known vendor token prefixes: Stripe sk-, Slack xox*, GitHub gh*
  [/\b(?:sk|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]"],
  // Email addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]"],
  // Private / localhost URLs
  [/https?:\/\/(?:localhost|127\.0\.0\.1|[^\s/]*private[^\s/]*)[^\s)'"`]+/gi, "[REDACTED_PRIVATE_URL]"],
  // Standard base64 blobs: require at least one + or / so we do NOT flag git SHAs,
  // UUIDs, or plain alphanumeric identifiers (none of which contain + or /).
  [/\b(?=[A-Za-z0-9+/]*[+/])[A-Za-z0-9+/]{32,}={0,2}\b/g, "[REDACTED_TOKEN]"],
  // Secret/token in a labeled assignment context — catches URL-safe base64 tokens
  // that omit + and / (e.g. token="abc_xyz...", password: longvalue).
  [/\b(?:token|secret|password|passwd|credential|bearer|access[_-]key)\s*[=:]\s*['"]?[A-Za-z0-9_.\-]{16,}['"]?/gi, "[REDACTED_TOKEN]"],
  // Local filesystem paths
  [/(?:^|\s)(?:\/Users|\/home|\/private\/var)\/[^\s'"`]+/g, " [REDACTED_LOCAL_PATH]"]
];

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function hasSensitiveSignal(value: string): boolean {
  if (value.includes("[REDACTED_")) return true;
  return SECRET_PATTERNS.some(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function excerpt(value: string, maxLength = 220): string {
  const compact = redactText(value).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}...`;
}
