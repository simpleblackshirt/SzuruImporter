import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContentWithFallback, getSinaimgFallbackUrl } from "~/api/download";
import SzurubooruApi from "~/api";

// The api posts the blob to szurubooru via axios; mock it to keep tests offline.
vi.mock("axios", () => ({
  default: Object.assign(vi.fn().mockResolvedValue({ data: {} })),
  CancelToken: {},
}));

function stubFetchWith(responses: Array<Promise<Partial<Response>> | Error>) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    if (response instanceof Error) {
      fetchMock.mockRejectedValueOnce(response);
    } else {
      fetchMock.mockImplementationOnce(() => response);
    }
  }

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function blobResponse(status = 200): Promise<Partial<Response>> {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, blob: () => Promise.resolve(new Blob(["x"])) });
}

// jsdom's Blob has no .text() method, so assert on the size instead.
async function expectBlobContent(blob: Blob) {
  expect(blob.size).toBe(1);
}

describe("getSinaimgFallbackUrl", () => {
  it("should swap the large rendition segment for mw2000 keeping pic id and extension", () => {
    expect(getSinaimgFallbackUrl("https://wx4.sinaimg.cn/large/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg")).toBe(
      "https://wx4.sinaimg.cn/mw2000/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg",
    );
  });

  it("should leave non-large sinaimg urls unchanged so no pointless retry happens", () => {
    const url = "https://wx4.sinaimg.cn/mw2000/bbcf6a50gy1ihzrvv25vuj20rl0lndil.jpg";
    expect(getSinaimgFallbackUrl(url)).toBe(url);
  });

  it("should leave non-sinaimg urls unchanged", () => {
    const url = "https://cdn.example.com/large/pic.jpg";
    expect(getSinaimgFallbackUrl(url)).toBe(url);
  });
});

describe("fetchContentWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch the original url first", async () => {
    const fetchMock = stubFetchWith([blobResponse()]);

    await fetchContentWithFallback("https://wx4.sinaimg.cn/large/pic1.jpg");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://wx4.sinaimg.cn/large/pic1.jpg");
  });

  it("should silently retry once with the mw2000 url when the first fetch fails", async () => {
    // Failure mode: network-level fetch errors would abort the whole upload without the retry.
    const fetchMock = stubFetchWith([new Error("network error"), blobResponse()]);

    const blob = await fetchContentWithFallback("https://wx4.sinaimg.cn/large/pic2.jpg");

    await expectBlobContent(blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://wx4.sinaimg.cn/large/pic2.jpg");
    expect(fetchMock.mock.calls[1][0]).toBe("https://wx4.sinaimg.cn/mw2000/pic2.jpg");
  });

  it("should retry when the server answers 403 instead of uploading the error page as blob", async () => {
    // Failure mode: a 403 response resolves successfully and would upload an invalid HTML blob.
    const fetchMock = stubFetchWith([blobResponse(403), blobResponse()]);

    const blob = await fetchContentWithFallback("https://wx4.sinaimg.cn/large/pic3.jpg");

    await expectBlobContent(blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://wx4.sinaimg.cn/mw2000/pic3.jpg");
  });

  it("should throw when both attempts fail", async () => {
    // Failure mode: swallowing errors would end up uploading an empty/invalid file.
    stubFetchWith([new Error("network error"), new Error("network error again")]);

    await expect(fetchContentWithFallback("https://wx4.sinaimg.cn/large/pic4.jpg")).rejects.toThrow(
      "network error again",
    );
  });

  it("should not retry when the url has no fallback variant", async () => {
    const fetchMock = stubFetchWith([blobResponse(403)]);

    await expect(fetchContentWithFallback("https://cdn.example.com/large/pic5.jpg")).rejects.toThrow(
      "status 403",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should be used by uploadTempFileFromContent with the original url first", async () => {
    const fetchMock = stubFetchWith([blobResponse()]);
    const api = new SzurubooruApi("https://szuru.example.org", "user", "token");

    await api.uploadTempFileFromContent("https://wx4.sinaimg.cn/large/pic6.jpg");

    expect(fetchMock.mock.calls[0][0]).toBe("https://wx4.sinaimg.cn/large/pic6.jpg");
  });
});
