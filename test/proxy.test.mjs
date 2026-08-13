import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyDestination } from "../src/proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxyDestination", () => {
  it("streams the destination response without exposing origin-only headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<h1>Artifact</h1>", {
        status: 200,
        headers: {
          "content-location": "https://r2.example/signed-object",
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "origin=value",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyDestination("https://r2.example/signed-object?signature=secret");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://r2.example/signed-object?signature=secret",
      { redirect: "follow" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    await expect(response.text()).resolves.toBe("<h1>Artifact</h1>");
  });

  it("returns 502 when the destination cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await proxyDestination("https://r2.example/unavailable");

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe("Could not load the destination");
  });
});
