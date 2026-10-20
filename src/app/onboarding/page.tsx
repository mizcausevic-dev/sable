import { ActionForm } from "@/components/interactive";
import { CURRENCIES } from "@/lib/validation";
import { createOrganizationAction } from "@/server/actions/auth";
import { requireUser } from "@/server/context";

export default async function OnboardingPage() {
  await requireUser();
  return (
    <main className="auth" id="content">
      <h1>Create an organization</h1>
      <p className="muted">You become the owner. The currency cannot be changed after this, and reports never mix currencies.</p>
      <ActionForm action={createOrganizationAction} submit="Create organization">
        <label className="field">Name<input name="name" required /></label>
        <label className="field">Slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label>
        <label className="field">Currency
          <select name="currency" defaultValue="USD">{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select>
        </label>
        <label className="field">Timezone<input name="timezone" defaultValue="America/Chicago" required /></label>
      </ActionForm>
    </main>
  );
}
