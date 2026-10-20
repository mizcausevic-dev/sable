"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page" id="content">
      <div className="denied" role="alert">
        <h1>Something failed</h1>
        <p>{error.message || "The page could not be rendered."}</p>
        <button className="btn" type="button" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
