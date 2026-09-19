/**
 * Public read-only audio surface.
 *
 * The request selects a known Council source; it cannot submit arbitrary text.
 * Audio generation is presentation-only and never reaches desk decisions.
 */
export default async function councilVoiceRoute(event: { url: URL }) {
  try {
    const source = event.url.searchParams.get("source");
    const speaker = event.url.searchParams.get("speaker");
    const eventKey = event.url.searchParams.get("event");

    const shared = await import("../../src/lib/desk/council-voice");
    if (!shared.isCouncilVoiceSource(source) || !shared.isCouncilVoiceSpeaker(speaker)) {
      return new Response("not found", { status: 404 });
    }
    const mod = await import("../../src/lib/desk/council-voice.server");
    const result = await mod.councilVoice({ source, speaker, eventKey });

    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": result.stable
          ? "public, max-age=86400, stale-while-revalidate=604800"
          : "no-store",
        "x-council-voice": result.speaker,
        "x-council-voice-cache": result.cache,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status) || 503
        : 503;
    return new Response(status === 404 ? "not found" : "voice unavailable", {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
