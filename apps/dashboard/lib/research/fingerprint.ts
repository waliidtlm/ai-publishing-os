import { createHash } from "node:crypto";

import { normalizeResearchText } from "./sanitize";

export function createResearchContentFingerprint(
  stableSourceIdentity: string,
  extractedText: string,
): string {
  const fingerprintText = normalizeResearchText(extractedText).replace(
    /\s+/gu,
    " ",
  );

  return createHash("sha256")
    .update(stableSourceIdentity, "utf8")
    .update("\0", "utf8")
    .update(fingerprintText, "utf8")
    .digest("hex");
}

export function createResearchRequestKey(input: {
  contentFingerprint: string;
  model: string;
  provider: string;
  researchJobSourceId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.researchJobSourceId,
        input.contentFingerprint,
        input.provider,
        input.model,
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
}
