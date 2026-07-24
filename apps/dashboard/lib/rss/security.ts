import {
  isBlockedIpAddress,
  OutboundUrlError,
  type OutboundLookup,
  validateOutboundUrl,
} from "../outbound/security";

import { RssCollectorError } from "./errors";

export { isBlockedIpAddress, type OutboundLookup };

export async function validateOutboundFeedUrl(
  rawUrl: string,
  lookup?: OutboundLookup,
): Promise<URL> {
  try {
    return await validateOutboundUrl(rawUrl, lookup);
  } catch (error) {
    if (!(error instanceof OutboundUrlError)) {
      throw error;
    }

    if (error.code === "invalid_url") {
      throw new RssCollectorError(
        "invalid_feed_url",
        "The configured feed URL must be a valid HTTP or HTTPS URL without credentials.",
        422,
      );
    }

    if (error.code === "resolution_failed") {
      throw new RssCollectorError(
        "upstream_request_failed",
        "The feed hostname could not be resolved.",
        502,
        true,
      );
    }

    throw new RssCollectorError(
      "blocked_destination",
      "The configured feed destination is not permitted.",
      422,
    );
  }
}
