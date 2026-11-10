import SzurubooruApi from "~/api";
import { TagDetails } from "~/models";
import { dedupeStaged, toStagedInfos, topoSortStaged, type StagedTagInfo } from "~/utils/staged-tags";
import { encodeTagName } from "~/utils";

/**
 * Accurate tag bookkeeping for a save, plus the materialization of staged
 * tags (creation-card confirmations).
 *
 * Confirming the creation card only stages the choice client-side (name ->
 * intended category + implications); eager creation was abandoned because a
 * tag created before the save becomes a zero-usage orphan that needs
 * tag-deletion permission to clean up. Creation rides the save instead:
 * every staged tag still present in the tag list is created here, in
 * topological order (an implication target must exist before the tag
 * implying it, or the backend loses the relation or auto-creates the target
 * in the default category), immediately before the post create/update - so
 * tags are born with a usage count and with the user's category/implications.
 *
 * Race + permission handling per tag:
 * - The shared pre-save existence check (fetchExistingTagNames) decides
 *   adoption: a staged tag that is already on the instance is settled
 *   instead of created.
 * - TagAlreadyExistsError stays as the safety net for the seconds-wide race
 *   window the pre-check leaves open.
 * - Without tag-creation permission the staged entry degrades: the staged
 *   marker and category are cleared so the plain name stays in the post
 *   payload and the backend creates it in the default category - graceful
 *   degradation to stock behavior. Clearing the category also keeps
 *   applyTagFixup from later attempting a category edit the user cannot
 *   perform, which would fail the whole upload after a successful save.
 */

export interface StagedTagCreationResult {
  /** Number of tags actually created through the API. */
  created: number;
  /** Number of staged entries that degraded to stock behavior. */
  degraded: number;
  /** Human-readable warning when entries degraded, undefined otherwise. */
  warning?: string;
}

function isSzuruError(ex: any, name: string): boolean {
  return ex?.name == name;
}

/**
 * Looks up which of `names` already exist on the instance: every name of a
 * matched tag counts (aliases resolve to the same tag, so an aliased post
 * tag is never mistaken for a new one). One batched exact-name query per 100
 * names - the cheapest search shape szurubooru offers (indexed name lookup,
 * no substring scan, no usages sort), the same one loadTagCounts uses on
 * every grab.
 */
export async function fetchExistingTagNames(szuru: SzurubooruApi, names: string[]): Promise<Set<string>> {
  const BATCH_SIZE = 100;
  const unique = [...new Set(names)].filter((x) => x.length > 0);
  const existing = new Set<string>();

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const query = unique.slice(i, i + BATCH_SIZE).map(encodeTagName).join(",");
    const res = await szuru.getTags(query, 0, BATCH_SIZE, ["names"]);
    for (const tag of res.results) {
      for (const name of tag.names) {
        existing.add(name);
      }
    }
  }

  return existing;
}

/** How many of `names` do not exist on the instance yet (deduped). */
export function countNewTagNames(names: string[], existingNames: Set<string>): number {
  return [...new Set(names)].filter((x) => x.length > 0 && !existingNames.has(x)).length;
}

/**
 * Creates the staged tags from `tags` that are still present in it, in
 * topological order. `existingNames` is the shared pre-save existence check
 * result (see fetchExistingTagNames) and decides adoption. Mutates degraded
 * and settled `TagDetails` entries in place. Network failures degrade the
 * entry too: the upload proceeds with stock behavior rather than failing
 * because an optional enrichment could not be applied.
 */
export async function createStagedTags(
  szuru: SzurubooruApi,
  tags: TagDetails[],
  existingNames: Set<string>,
): Promise<StagedTagCreationResult> {
  // Dedupe by name: with "keep tags between posts", the same staged entry can
  // be carried onto several posts sharing this upload run.
  const staged: StagedTagInfo[] = dedupeStaged(toStagedInfos(tags));
  if (staged.length == 0) {
    return { created: 0, degraded: 0 };
  }

  let degraded = 0;
  let created = 0;
  const degradedNames = new Set<string>();
  const degrade = (info: StagedTagInfo, reason: string) => {
    degraded++;
    degradedNames.add(info.name);
    console.warn(`Staged tag '${info.name}' degraded to default category: ${reason}`);
    const tagDetails = tags.find((x) => x.names[0] == info.name && x.staged);
    if (tagDetails) {
      delete tagDetails.staged;
      delete tagDetails.category;
    }
  };

  const settle = (info: StagedTagInfo) => {
    // The tag exists on the instance (created here or by someone else):
    // clear the staged marker so the entry reads as a regular known tag.
    const tagDetails = tags.find((x) => x.names[0] == info.name && x.staged);
    if (tagDetails) {
      delete tagDetails.staged;
      delete tagDetails.category;
    }
  };

  const ordered = topoSortStaged(staged);
  for (const info of ordered) {
    const tagDetails = tags.find((x) => x.names[0] == info.name);
    if (!tagDetails?.staged) {
      // Degrading an implication target above already stripped the marker via
      // the shared TagDetails object; skip it.
      continue;
    }

    // Race handling: the shared pre-save existence check decides adoption.
    if (existingNames.has(info.name)) {
      settle(info);
      continue;
    }

    // Implication targets that degraded were never created; dropping their
    // edges explicitly instead of relying on the backend's silent drop of
    // unknown implication names.
    const implications = info.implications.filter((x) => {
      if (!degradedNames.has(x)) return true;
      console.warn(`Dropping implication '${info.name}' -> '${x}': the target degraded to default category.`);
      return false;
    });

    try {
      await szuru.createTag([info.name], {
        names: [info.name],
        category: info.category,
        implications,
      });
      created++;
      settle(info);
    } catch (ex: any) {
      if (isSzuruError(ex, "TagAlreadyExistsError")) {
        settle(info);
        continue;
      }
      const reason = isSzuruError(ex, "InsufficientPrivilegeError")
        ? "missing tag-creation permission"
        : ex?.description ?? ex?.message ?? "creation request failed";
      degrade(info, reason);
    }
  }

  const degradedList = ordered.filter((x) => degradedNames.has(x.name));
  return {
    created,
    degraded,
    warning:
      degraded > 0
        ? `Could not create ${degraded} staged tag${degraded > 1 ? "s" : ""} (${degradedList
            .map((x) => x.name)
            .join(", ")}) with the chosen category (missing permission or request failure) - added as regular tags instead.`
        : undefined,
  };
}
