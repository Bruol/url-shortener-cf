import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function envWithKv() {
  return {
    LINKS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    },
    HTML_ARTIFACTS: {
      get: vi.fn().mockResolvedValue(null),
    },
    R2_S3_HOST: "account.r2.cloudflarestorage.com",
    REQUEST_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    LINK_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  };
}

describe("rate limiting", () => {
  it("checks the trusted client IP before creating a link", async () => {
    const env = envWithKv();
    const response = await worker.fetch(new Request("https://short.example/api/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "192.0.2.1",
        "X-Forwarded-For": "192.0.2.2",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    }), env);

    expect(response.status).toBe(201);
    expect(env.REQUEST_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
    expect(env.LINK_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "192.0.2.1" });
  });

  it("rejects excess creation attempts before parsing the body or accessing storage", async () => {
    const env = envWithKv();
    env.LINK_RATE_LIMITER.limit.mockResolvedValue({ success: false });
    const request = new Request("https://short.example/api/links", {
      method: "POST", body: "invalid JSON",
    });
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).error).toContain("Too many requests");
    expect(request.bodyUsed).toBe(false);
    expect(env.LINKS.get).not.toHaveBeenCalled();
    expect(env.LINKS.put).not.toHaveBeenCalled();
  });

  it.each(["/", "/abc123", "/robots.txt", "/api/links"])(
    "applies the general limit to %s before doing work",
    async (path) => {
      const env = envWithKv();
      env.REQUEST_RATE_LIMITER.limit.mockResolvedValue({ success: false });
      const response = await worker.fetch(new Request(`https://short.example${path}`, {
        method: path === "/api/links" ? "POST" : "GET",
      }), env);

      expect(response.status).toBe(429);
      expect(env.LINK_RATE_LIMITER.limit).not.toHaveBeenCalled();
      expect(env.LINKS.get).not.toHaveBeenCalled();
      expect(env.HTML_ARTIFACTS.get).not.toHaveBeenCalled();
    },
  );

  it("does not consume the creation allowance for reads", async () => {
    const env = envWithKv();
    const response = await worker.fetch(new Request("https://short.example/"), env);

    expect(response.status).toBe(200);
    expect(env.REQUEST_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "unknown" });
    expect(env.LINK_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });
});

function create(body) {
  return worker.fetch(
    new Request("https://short.example/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    this,
  );
}

describe("link lifetimes", () => {
  it("expires links after seven days by default", async () => {
    const env = envWithKv();
    const response = await create.call(env, { url: "https://example.com/artifact" });

    expect(response.status).toBe(201);
    expect(env.LINKS.put).toHaveBeenCalledOnce();
    expect(env.LINKS.put.mock.calls[0][2]).toMatchObject({ expirationTtl: 604800 });
    expect((await response.json()).expiresAt).toEqual(expect.any(String));
  });

  it("supports a custom finite lifetime", async () => {
    const env = envWithKv();
    const response = await create.call(env, {
      url: "https://example.com/artifact",
      expiresIn: 86400,
    });

    expect(response.status).toBe(201);
    expect(env.LINKS.put.mock.calls[0][2]).toMatchObject({ expirationTtl: 86400 });
  });

  it("stores an R2 object key instead of the expiring presigned URL", async () => {
    const env = envWithKv();
    const response = await create.call(env, {
      url: "https://account.r2.cloudflarestorage.com/html-plans/folder/artifact.html?X-Amz-Signature=secret",
    });

    expect(response.status).toBe(201);
    expect(env.LINKS.put.mock.calls[0][1]).toBe(
      JSON.stringify({ kind: "r2", key: "folder/artifact.html" }),
    );
  });

  it("supports links that live forever", async () => {
    const env = envWithKv();
    const response = await create.call(env, {
      url: "https://example.com/artifact",
      expiresIn: null,
    });

    expect(response.status).toBe(201);
    expect(env.LINKS.put.mock.calls[0][2]).not.toHaveProperty("expirationTtl");
    expect((await response.json()).expiresAt).toBeNull();
  });

  it("rejects invalid finite lifetimes", async () => {
    const env = envWithKv();
    const response = await create.call(env, {
      url: "https://example.com/artifact",
      expiresIn: 59,
    });

    expect(response.status).toBe(400);
    expect(env.LINKS.put).not.toHaveBeenCalled();
  });
});

describe("R2 delivery", () => {
  it("serves stored R2 objects through the private bucket binding", async () => {
    const env = envWithKv();
    env.LINKS.get.mockResolvedValue(JSON.stringify({ kind: "r2", key: "artifact.html" }));
    env.HTML_ARTIFACTS.get.mockResolvedValue({
      body: "<h1>Permanent artifact</h1>",
      httpEtag: '"etag"',
      writeHttpMetadata(headers) {
        headers.set("content-type", "text/html; charset=utf-8");
      },
    });

    const response = await worker.fetch(new Request("https://short.example/abc123"), env);

    expect(env.HTML_ARTIFACTS.get).toHaveBeenCalledWith("artifact.html");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toBe("<h1>Permanent artifact</h1>");
  });

  it("keeps legacy links alive after their stored R2 signature expires", async () => {
    const env = envWithKv();
    env.LINKS.get.mockResolvedValue(
      "https://account.r2.cloudflarestorage.com/html-plans/legacy.html?X-Amz-Signature=expired",
    );
    env.HTML_ARTIFACTS.get.mockResolvedValue({
      body: "legacy",
      httpEtag: '"etag"',
      writeHttpMetadata() {},
    });

    const response = await worker.fetch(new Request("https://short.example/legacy"), env);

    expect(env.HTML_ARTIFACTS.get).toHaveBeenCalledWith("legacy.html");
    await expect(response.text()).resolves.toBe("legacy");
  });
});
