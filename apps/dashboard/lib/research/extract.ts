import { Readability } from "@mozilla/readability";
import { DOMParser } from "linkedom";

import { researchLimits } from "@ai-publishing-os/schemas";

import { ResearchError } from "./errors";
import { normalizeResearchText, truncateResearchText } from "./sanitize";

export interface ExtractedResearchDocument {
  author: string | null;
  canonicalUrl: string | null;
  description: string | null;
  headings: string[];
  publishedAt: Date | null;
  publisher: string;
  text: string;
  title: string;
}

type ParsedHtmlDocument = ReturnType<DOMParser["parseFromString"]>;

function firstMetadataContent(
  document: ParsedHtmlDocument,
  selectors: readonly string[],
): string | null {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content");

    if (value?.trim()) {
      return normalizeResearchText(value);
    }
  }

  return null;
}

function parsePublishedAt(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeCanonicalUrl(
  document: ParsedHtmlDocument,
  baseUrl: string,
): string | null {
  const href = document
    .querySelector('link[rel~="canonical"]')
    ?.getAttribute("href");

  if (!href) return null;

  try {
    const url = new URL(href, baseUrl);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function removeUntrustedBoilerplate(document: ParsedHtmlDocument): void {
  document
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "nav",
        "form",
        "iframe",
        "object",
        "embed",
        "svg",
        "canvas",
        "video",
        "audio",
        "[hidden]",
        '[aria-hidden="true"]',
        '[style*="display:none"]',
        '[style*="display: none"]',
        '[style*="visibility:hidden"]',
        '[style*="visibility: hidden"]',
      ].join(","),
    )
    .forEach((element: Element) => element.remove());

  document.querySelectorAll("*").forEach((element: Element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

export function extractResearchDocument(input: {
  body: string;
  contentType: "html" | "plain";
  finalUrl: string;
  maximumTextLength: number;
  sourceTitle?: string | null;
}): ExtractedResearchDocument {
  const publisherFromDomain = new URL(input.finalUrl).hostname;

  if (input.contentType === "plain") {
    const text = truncateResearchText(
      normalizeResearchText(input.body),
      input.maximumTextLength,
    );

    if (text.length < 80) {
      throw new ResearchError(
        "no_usable_content",
        "The research source did not contain enough readable text.",
        422,
      );
    }

    const firstLine = text.split("\n")[0] ?? publisherFromDomain;

    return {
      author: null,
      canonicalUrl: null,
      description: null,
      headings: [],
      publishedAt: null,
      publisher: publisherFromDomain,
      text,
      title: truncateResearchText(
        normalizeResearchText(input.sourceTitle ?? firstLine),
        researchLimits.title,
      ),
    };
  }

  const document = new DOMParser().parseFromString(input.body, "text/html");

  if (!document) {
    throw new ResearchError(
      "no_usable_content",
      "The research source HTML could not be parsed.",
      422,
    );
  }

  const titleMetadata =
    firstMetadataContent(document, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) ??
    normalizeResearchText(document.querySelector("title")?.textContent ?? "");
  const description = firstMetadataContent(document, [
    'meta[name="description"]',
    'meta[property="og:description"]',
  ]);
  const author = firstMetadataContent(document, [
    'meta[name="author"]',
    'meta[property="article:author"]',
  ]);
  const publisher =
    firstMetadataContent(document, [
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ]) ?? publisherFromDomain;
  const publishedAt = parsePublishedAt(
    firstMetadataContent(document, [
      'meta[property="article:published_time"]',
      'meta[name="date"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]',
    ]) ??
      document.querySelector("time[datetime]")?.getAttribute("datetime") ??
      null,
  );
  const canonicalUrl = safeCanonicalUrl(document, input.finalUrl);

  removeUntrustedBoilerplate(document);

  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .map((element) =>
      truncateResearchText(
        normalizeResearchText(element.textContent ?? ""),
        researchLimits.heading,
      ),
    )
    .filter(Boolean)
    .slice(0, researchLimits.headings);
  const article = new Readability(document as unknown as Document, {
    charThreshold: 80,
    keepClasses: false,
  }).parse();
  const text = truncateResearchText(
    normalizeResearchText(article?.textContent ?? ""),
    input.maximumTextLength,
  );

  if (text.length < 80) {
    throw new ResearchError(
      "no_usable_content",
      "The research source did not contain enough readable article text.",
      422,
    );
  }

  const title = truncateResearchText(
    normalizeResearchText(
      article?.title ||
        titleMetadata ||
        input.sourceTitle ||
        publisherFromDomain,
    ),
    researchLimits.title,
  );

  return {
    author: author ? truncateResearchText(author, researchLimits.author) : null,
    canonicalUrl,
    description: description
      ? truncateResearchText(description, researchLimits.summary)
      : null,
    headings,
    publishedAt,
    publisher: truncateResearchText(publisher, researchLimits.publisher),
    text,
    title,
  };
}
