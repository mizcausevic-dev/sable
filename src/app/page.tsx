import { redirect } from "next/navigation";
import { currentUser } from "@/server/context";

export default async function IndexPage() {
  const user = await currentUser();
  redirect(user ? "/app" : "/login");
}
