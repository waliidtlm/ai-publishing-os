import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

type LookupAddress = {
  address: string;
  family: number;
};

export type OutboundLookup = (
  hostname: string,
) => Promise<readonly LookupAddress[]>;

export type OutboundUrlErrorCode =
  "blocked_destination" | "invalid_url" | "resolution_failed";

export class OutboundUrlError extends Error {
  constructor(readonly code: OutboundUrlErrorCode) {
    super(code);
    this.name = "OutboundUrlError";
  }
}

function parseIpv4(address: string): number[] | null {
  const octets = address.split(".").map(Number);

  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets;
}

export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? address;
  const ipv4 = parseIpv4(normalized);

  if (ipv4) {
    const [first = 0, second = 0] = ipv4;

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  if (isIP(normalized) !== 6) {
    return true;
  }

  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/u);

  if (mappedIpv4?.[1]) {
    return isBlockedIpAddress(mappedIpv4[1]);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");

  return (
    normalized === "localhost" ||
    normalized === "metadata.google.internal" ||
    normalized === "instance-data" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".lan")
  );
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, {
    all: true,
    verbatim: true,
  });
}

export async function validateOutboundUrl(
  rawUrl: string,
  lookup: OutboundLookup = defaultLookup,
): Promise<URL> {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundUrlError("invalid_url");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new OutboundUrlError("invalid_url");
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, "");

  if (isBlockedHostname(hostname)) {
    throw new OutboundUrlError("blocked_destination");
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new OutboundUrlError("blocked_destination");
    }

    return url;
  }

  let addresses: readonly LookupAddress[];

  try {
    addresses = await lookup(hostname);
  } catch {
    throw new OutboundUrlError("resolution_failed");
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIpAddress(address))
  ) {
    throw new OutboundUrlError("blocked_destination");
  }

  return url;
}
