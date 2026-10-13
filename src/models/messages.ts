import type { UpdatePostRequest } from "~/api/models";
import type { SzuruSiteConfig } from "./config";
import type { ScrapedPostDetails } from "./post";

export type PostUploadState = "uploading" | "uploaded" | "error";

export class PostUploadInfo {
  state: PostUploadState = "uploading";
  error?: string;
  instancePostId?: number;
  updateTagsState?: {
    total: number;
    current?: number;
    totalChanged?: number;
  };
}

export type BrowserCommandName =
  | "grab_post"
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
  ) {}
}

export class FetchCommandData {
  constructor(
    public readonly url: string,
    public readonly options: RequestInit | undefined = undefined,
  ) {}
}
