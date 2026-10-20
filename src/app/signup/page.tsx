import Link from "next/link";
import { ActionForm } from "@/components/interactive";
import { signupAction } from "@/server/actions/auth";

export default function SignupPage() {
  return (
    <main className="auth" id="content">
      <h1>Create your account</h1>
      <p className="muted">You will create an organization next. One currency is chosen there and is not converted later.</p>
      <ActionForm action={signupAction} submit="Create account">
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Email<input name="email" type="email" autoComplete="username" required /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      </ActionForm>
      <p><Link href="/login">Already have an account</Link></p>
    </main>
  );
}
