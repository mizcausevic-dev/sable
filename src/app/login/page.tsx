import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/interactive";
import { loginAction } from "@/server/actions/auth";
import { currentUser } from "@/server/context";
import { SEED_PASSWORD } from "@/lib/password";

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  const showDemo = process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_ACCOUNTS === "1";
  return (
    <main className="auth" id="content">
      <p className="muted">Sable</p>
      <h1>Sign in</h1>
      <ActionForm action={loginAction} submit="Sign in">
        <label className="field">Email<input name="email" type="email" autoComplete="username" required /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
      </ActionForm>
      <p><Link href="/signup">Create an account</Link></p>
      {showDemo ? (
        <div className="panel">
          <h2>Seeded organizations</h2>
          <p className="muted">Password for every seeded person: {SEED_PASSWORD}</p>
          <ul>
            <li>mira.ellison@northline.test, owner at Northline</li>
            <li>leo.park@northline.test, contributor</li>
            <li>ava.quinn@brightparcel.test, client on Bright Parcel only</li>
            <li>jonah.adler@northline.test, admin at Northline and contributor at Harbor</li>
            <li>owen.marsh@harbor.test, owner at Harbor & Co</li>
          </ul>
        </div>
      ) : null}
    </main>
  );
}
