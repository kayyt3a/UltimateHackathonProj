/**
 * Placeholder root page. Person D owns the UI — this exists only so the app
 * builds and so there is a quick link to the API contract during integration.
 */
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
      <h1>Cloudy&rsquo;s Second Opinion</h1>
      <p>
        The diagnosis API is at{" "}
        <code>/api/diagnose?ts=2026-07-05T04:00:00Z</code>.
      </p>
      <p>
        Pre-warmed demo timestamps: <code>2026-07-04T23:00:00Z</code>,{" "}
        <code>2026-07-05T04:00:00Z</code>, <code>2026-07-06T00:00:00Z</code>,{" "}
        <code>2026-07-10T06:00:00Z</code>. Append <code>&amp;cache=only</code> to
        serve the pre-warmed file without a live call.
      </p>
    </main>
  );
}
