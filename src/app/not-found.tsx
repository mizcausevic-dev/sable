import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth" id="content">
      <h1>Not found</h1>
      <p className="muted">That page is not in this application, or the record is outside your organization.</p>
      <p><Link href="/app">Back to Sable</Link></p>
    </main>
  );
}
