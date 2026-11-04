import type { UpdatePostRequest } from "~/api/models";
import type { SzuruSiteConfig } from "./config";
import type { ScrapedPostDetails, TagDetails } from "./post";
import type { ScrapeResults } from "neo-scraper";

export type PostUploadState = "uploading" | "uploaded" | "error";

export class PostUploadInfo {
  state: PostUploadState = "uploading";
  error?: string;
  instancePostId?: number;
  /** Set only when the tag fixup made at least one real change (applyTagFixup). */
  updateTagsState?: {
    totalChanged: number;
  };
}

export type BrowserCommandName =
  | "grab_post"
  | "grab_post_element"
  | "upload_post"
  | "set_post_upload_info"
  | "set_exact_post_id"
  | "update_post"
  | "set_post_update_info"
  | "fetch";

export class BrowserCommand<T = any> {
  name: BrowserCommandName;
  data?: T;

  constructor(name: BrowserCommandName, data?: T) {
    this.name = name;
    this.data = data;
  }
}

/** Payload of the grab_post_element command (Firefox element resolution). */
export class GrabPostElementCommandData {
  constructor(
    public readonly targetElementId?: number,
    /**
     * Media url of the right-clicked image (menus.OnClickData.srcUrl). Sites
     * re-render media nodes around their own context menus (x.com swaps the
     * image node when its media menu opens), which can leave both Firefox's
     * getTargetElement result and the stored right-click element
     * disconnected - the content script revives the target from this url
     * when node identity fails (see resolveGrabTarget).
     */
    public readonly srcUrl?: string,
  ) {}
}

export type GrabElementStatus = "ok" | "no-container" | "no-element" | "unsupported-site";

/**
 * Response of the content script to a grab_post_element command. Crossing the
 * message boundary JSON-serializes it (and the ScrapeResults) down to plain
 * objects - the background stash and the popup pickup rely on that shape.
 */
export class GrabElementResult {
  status: GrabElementStatus;
  scrapeResults?: ScrapeResults;

  constructor(status: GrabElementStatus, scrapeResults?: ScrapeResults) {
    this.status = status;
    this.scrapeResults = scrapeResults;
  }
}

export class PostUploadCommandData {
  constructor(
    public readonly post: ScrapedPostDetails,
    public readonly selectedSite: SzuruSiteConfig,
    public readonly sendNotifications: boolean,
  ) {}
}

export class SetPostUploadInfoData {
  constructor(
    public instanceId: string,
    public postId: string,
    public info: PostUploadInfo,
  ) {}
}

export class SetExactPostId {
  constructor(
    public readonly instanceId: string,
    public readonly postId: string,
    public readonly exactPostId: number,
  ) {}
}

export class PostUpdateCommandData {
  constructor(
    public readonly postId: number,
    public readonly updateRequest: UpdatePostRequest,
    public readonly selectedSite: SzuruSiteConfig,
    /**
     * Scraped tags the merge adds to the post, so the background can sync
     * their categories and profile urls after the update (see applyTagFixup).
     */
    public readonly scrapedTags: TagDetails[] = [],
  ) {}
}

export class FetchCommandData {
  constructor(
    public readonly url: string,
    public readonly options: RequestInit | undefined = undefined,
  ) {}
}
