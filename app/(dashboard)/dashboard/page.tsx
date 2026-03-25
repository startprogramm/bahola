import { getAuthSession } from "@/lib/auth";
import { redirect } from "next/navigation";

// Dashboard redirects based on user role
export default async function DashboardPage() {
  const session = await getAuthSession();

  if (!session) {
    redirect("/login");
  }

  // Directors go to the director panel
  if (session.user.role === "DIRECTOR") {
    redirect("/director");
  }

  // Everyone else goes to the classes page
  redirect("/classes");
}
