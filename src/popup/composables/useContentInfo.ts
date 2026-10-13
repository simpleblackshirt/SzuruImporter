import type { ScrapedPostDetails } from "~/models";

export async function updatePostWithRemoteInfo(post: ScrapedPostDetails, contentUrl: string) {
  // We are missing cookies/etc which means that the request might fail.
  // If you want access to the cookies/session/etc then you need to execute this code inside the content script.
  try {
    // This request follows redirects.
    const res = await fetch(contentUrl, { method: "HEAD" });
    const size = res.headers.get("Content-Length");
    const type = res.headers.get("Content-Type");

    if (type) {
      if (type.indexOf("text/html") != -1) {
        // If we get a HTML page back it usually means that the request failed.
        // Not all sites (e.g. e-hentai) reply with a 403.
        throw new Error(
          "Received a text/html content type. This probably means that we don't have permission to access the resource.",
        );
      }

      const [_main, sub] = type.split("/");
      if (sub) post.contentSubType = sub.toUpperCase();
    }

    // This should be after the type check, because the type check also checks whether the response we get is valid/unsable.
    if (size) post.contentSize = parseInt(size);

    // Update url if it changes. The url can change when:
    // a. the extraContentUrl was successfully loaded
    // b. because of redirects
    if (res.url != post.contentUrl) {
      // The developer needs to make sure that the remote server can load this URL if `post.uploadMode == 'url'`!
      console.log(`Updating post.contentUrl to '${res.url}'`);
      post.contentUrl = res.url;
    }

    return true;
  } catch (ex) {
    console.error(ex);
    return false;
  }
}

/** Probes remote content metadata (size/type/final url) for all grabbed posts. */
export function useContentInfo(posts: ScrapedPostDetails[]) {
  async function fetchPostsInfo() {
    for (const post of posts) {
      if (!post.contentSize || post.extraContentUrl) {
        let ok = false;
        if (post.extraContentUrl) {
          // Prioritize info from extraContentUrl.
          ok = await updatePostWithRemoteInfo(post, post.extraContentUrl);
        }
        if (!ok) {
          // Fall back to normal contentUrl if we can't get the data from the extraContentUrl.
          await updatePostWithRemoteInfo(post, post.contentUrl);
        }
      }
    }
  }

  return { fetchPostsInfo };
}
