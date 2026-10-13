/**
 * Weibo's sinaimg CDN serves image renditions via the first path segment
 * (e.g. /large/, /mw2000/) using the same pic id and file extension.
 */

/**
 * Returns the /mw2000/ fallback url for a /large/ sinaimg url.
 * Returns the input url unchanged if it is not a /large/ sinaimg url.
 */
export function getSinaimgFallbackUrl(contentUrl: string): string {
  if (!/^https?:\/\/[^/]*\.sinaimg\.cn\/large\//.test(contentUrl)) {
    return contentUrl;
  }

  return contentUrl.replace("/large/", "/mw2000/");
}

async function fetchContentBlob(url: string): Promise<Blob> {
  const response = await fetch(url);

  // A non-2xx response would otherwise resolve with an (invalid) error page blob.
  if (!response.ok) {
    throw new Error(`Fetching '${url}' failed with status ${response.status}.`);
  }

  return response.blob();
}

/**
 * Fetches the content as blob. If that fails, silently retries once with the
 * sinaimg fallback url (see getSinaimgFallbackUrl). Only throws when both
 * attempts fail.
 */
export async function fetchContentWithFallback(contentUrl: string): Promise<Blob> {
  try {
    return await fetchContentBlob(contentUrl);
  } catch (ex) {
    const fallbackUrl = getSinaimgFallbackUrl(contentUrl);

    if (fallbackUrl == contentUrl) {
      throw ex;
    }

    console.log(`Fetching '${contentUrl}' failed, retrying once with fallback url '${fallbackUrl}'.`);
    return fetchContentBlob(fallbackUrl);
  }
}
