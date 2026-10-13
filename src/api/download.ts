import { downloadFallbackForUrl } from "~/sites";

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
 * fallback url of the content's site adapter (see ~/sites). Only throws when
 * both attempts fail.
 */
export async function fetchContentWithFallback(contentUrl: string): Promise<Blob> {
  try {
    return await fetchContentBlob(contentUrl);
  } catch (ex) {
    const fallbackUrl = downloadFallbackForUrl(contentUrl)?.(contentUrl) ?? contentUrl;

    if (fallbackUrl == contentUrl) {
      throw ex;
    }

    console.log(`Fetching '${contentUrl}' failed, retrying once with fallback url '${fallbackUrl}'.`);
    return fetchContentBlob(fallbackUrl);
  }
}
