import { TagDetails } from "~/models";

/**
 * Plain-data snapshot of a staged tag (a tag the user confirmed for creation
 * but that does not exist on the instance yet). The authority for what gets
 * created lives on `TagDetails.staged` / `.category`; this shape is what the
 * validation, sorting, and autocomplete helpers operate on - and what crosses
 * the messaging boundary to the background, where `TagDetails` arrives with
 * its prototype (and thus its `name` getter) stripped.
 */
export interface StagedTagInfo {
  name: string;
  category: string;
  implications: string[];
}

/** Extracts the staged tags from a TagDetails list, in list order. */
export function toStagedInfos(tags: TagDetails[]): StagedTagInfo[] {
  const staged: StagedTagInfo[] = [];
  for (const tag of tags) {
    if (tag.staged) {
      // `names[0]`, not the `name` getter: in the background these objects
      // arrive via runtime messaging, which strips prototype members.
      staged.push({ name: tag.names[0], category: tag.category ?? "default", implications: tag.staged.implications });
    }
  }
  return staged;
}

/** Deduplicates staged entries by name, keeping the first occurrence. */
export function dedupeStaged(infos: StagedTagInfo[]): StagedTagInfo[] {
  const seen = new Set<string>();
  return infos.filter((info) => (seen.has(info.name) ? false : (seen.add(info.name), true)));
}

/**
 * Validates a staging decision. Returns an error message, or undefined when
 * the staging is acceptable. `knownNames` holds names that exist on the
 * instance (as of the caller's server check); anything else must be another
 * staged tag.
 *
 * - Self-implication is refused outright.
 * - Implication targets must be known or staged - the backend silently drops
 *   unknown implication names instead of erroring, so this is checked here.
 * - Cycles among staged tags are refused: a one-shot save cannot materialize
 *   a cycle (neither side exists to carry the first edge). Edges into known
 *   tags cannot close a cycle - the server-side graph is acyclic, and an
 *   existing tag can never imply a tag that does not exist yet.
 */
export function validateStaging(
  name: string,
  implications: string[],
  stagedInfos: StagedTagInfo[],
  knownNames: Iterable<string>,
): string | undefined {
  const unique = [...new Set(implications)];

  if (unique.some((x) => x == name)) {
    return `'${name}' cannot imply itself.`;
  }

  const known = knownNames instanceof Set ? knownNames : new Set(knownNames);
  const stagedNames = new Set(stagedInfos.map((x) => x.name));
  const unknown = unique.filter((x) => !known.has(x) && !stagedNames.has(x));
  if (unknown.length > 0) {
    return `Implication target '${unknown[0]}' does not exist on the instance and is not staged.`;
  }

  // Cycle check over the staged graph, with the prospective entry included.
  // Every non-staged (known) target terminates the walk, so any cycle must
  // run through staged entries only.
  const graph = new Map<string, string[]>();
  for (const info of stagedInfos) {
    graph.set(info.name, info.implications.filter((x) => stagedNames.has(x) && x != info.name));
  }
  graph.set(name, unique.filter((x) => stagedNames.has(x) && x != name));

  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): boolean => {
    if (done.has(node)) return false;
    if (visiting.has(node)) return true;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };

  if (visit(name)) {
    return `'${name}' would create an implication cycle.`;
  }

  return undefined;
}

/**
 * Orders staged tags so implied tags come before the tags implying them
 * (creation order - the implication target must exist when the implying tag
 * is created, or the backend loses the relation / auto-creates the target in
 * the default category). Stable otherwise. Tolerates cycles (which staging
 * validation already refuses) by emitting the remaining tags in input order.
 */
export function topoSortStaged(staged: StagedTagInfo[]): StagedTagInfo[] {
  const byName = new Map(staged.map((x) => [x.name, x]));
  const emitted = new Set<string>();
  const result: StagedTagInfo[] = [];

  const emit = (info: StagedTagInfo, seen: Set<string>) => {
    if (emitted.has(info.name) || seen.has(info.name)) return;
    seen.add(info.name);
    for (const implication of info.implications) {
      const target = byName.get(implication);
      if (target) emit(target, seen);
    }
    emitted.add(info.name);
    result.push(info);
  };

  for (const info of staged) {
    emit(info, new Set());
  }
  return result;
}

/**
 * Removes `removedName` from every staged tag's implication list, in place.
 * Called when a tag is removed from the draft: without this, a save could
 * resurrect it via the backend's auto-create of unknown implication names.
 */
export function stripStagedImplications(tags: TagDetails[], removedName: string): void {
  for (const tag of tags) {
    if (tag.staged) {
      tag.staged.implications = tag.staged.implications.filter((x) => x != removedName);
    }
  }
}

/** Clears the staged marker on every tag in the list, in place. */
export function clearStagedState(tags: TagDetails[]): void {
  for (const tag of tags) {
    delete tag.staged;
  }
}

/**
 * Staged tags matching the autocomplete input, as TagDetails with the staged
 * marker set (drives the "new" badge and the staged category color in the
 * dropdown). Mirrors buildNamePattern's server-side matching semantics:
 * short inputs match as a prefix, longer ones as a substring, a typed "*"
 * passes through verbatim.
 */
export function stagedSuggestions(staged: StagedTagInfo[], input: string): TagDetails[] {
  const name = input.trim().replace(/\s+/g, "_");
  if (name.replace(/\*/g, "").length == 0) return [];

  const matches = (candidate: string): boolean => {
    if (name.includes("*")) {
      const parts = name.toLowerCase().split("*").filter((x) => x.length > 0);
      const haystack = candidate.toLowerCase();
      return parts.every((part) => haystack.includes(part));
    }
    const haystack = candidate.toLowerCase();
    return name.length >= 3 ? haystack.includes(name.toLowerCase()) : haystack.startsWith(name.toLowerCase());
  };

  return staged
    .filter((x) => matches(x.name))
    .map((x) => {
      const tag = new TagDetails([x.name], x.category);
      tag.staged = { implications: [...x.implications] };
      return tag;
    });
}
