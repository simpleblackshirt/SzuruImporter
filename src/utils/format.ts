import byteSize from "byte-size";
import { MicroUser, Post } from "../api/models";
import { ScrapedPostDetails, TagDetails } from "../models";

export function getErrorMessage(ex: any) {
  return ex.description ?? ex.message ?? ex;
}

export function emptyMicroUser(): MicroUser {
  return {
    name: "",
    avatarUrl: "",
  };
}

export function emptyPost(): Post {
  return {
    id: 0,
    version: 0,
    creationTime: new Date(),
    lastEditTime: new Date(),
    safety: "safe",
    source: "",
    type: "",
    mimeType: "",
    checksum: "",
    fileSize: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    contentUrl: "",
    thumbnailUrl: "",
    flags: [],
    tags: [],
    relations: [],
    user: emptyMicroUser(),
    score: 0,
    ownScore: 0,
    ownFavorite: false,
    tagCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    noteCount: 0,
    relationCount: 0,
    featureCount: 0,
    lastFeatureTime: new Date(),
    favoritedBy: [],
    hasCustomThumbnail: false,
    notes: [],
    comments: [],
  };
}

export function getTagClasses(tag: TagDetails): string[] {
  const classes: string[] = [];

  if (tag.category && tag.category != "default") {
    classes.push("tag-" + tag.category);
  } else {
    classes.push("tag-general");
  }

  return classes;
}

export function breakTagName(tagName: string) {
  // Based on https://stackoverflow.com/a/6316913
  return tagName.replace(/_/g, "_<wbr>");
}

// Szurubooru tag/pool names can't contain whitespace, so a typed "long hair"
// would fail at upload time. Trim the ends and turn internal whitespace runs
// into a single underscore, which is how those names are spelled in szurubooru.
export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, "_");
}

// Builds the search pattern for tag/pool autocomplete. Substring patterns
// ("*abc*", with a leading wildcard) are the expensive kind: the backend
// can't use an index for them and, with a usages sort, has to compute a
// usage count for every tag that matches. So short inputs search as a
// prefix ("ab*") instead, matching what the szurubooru client does.
// A user-typed "*" is always passed through verbatim, so "*hair*" still
// performs an explicit substring search. Returns null when the input
// contains nothing but wildcards, which would match every tag.
export function buildNamePattern(input: string) {
  const name = normalizeName(input);
  if (name.replace(/\*/g, "").length == 0) {
    return null;
  }
  if (name.includes("*")) {
    return name;
  }
  return name.length >= 3 ? `*${name}*` : `${name}*`;
}

export function resolutionToString(resolution: [number, number]) {
  if (resolution && resolution.length == 2) {
    return resolution[0] + "x" + resolution[1];
  }
  return "";
}

export function getPostInfoSummary(post: ScrapedPostDetails) {
  const parts = [];
  if (post.contentSize) {
    parts.push(byteSize(post.contentSize));
  }
  if (post.contentSubType) {
    parts.push(post.contentSubType);
  }
  if (post.resolution) {
    parts.push(resolutionToString(post.resolution));
  }
  return parts.join(" / ");
}
