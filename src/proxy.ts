export async function proxyDestination(destination: string): Promise<Response> {
  try {
    const upstream = await fetch(destination, { redirect: "follow" });
    const headers = new Headers(upstream.headers);

    // The response is served from short.bruol.me, so do not expose origin cookies
    // or the signed R2 URL through origin-specific headers.
    headers.delete("set-cookie");
    headers.delete("content-location");
    headers.delete("location");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-content-type-options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Failed to fetch a shortened URL destination",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response("Could not load the destination", { status: 502 });
  }
}
