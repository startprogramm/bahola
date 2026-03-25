import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getCrossAppAccessViolation } from "@/lib/app-access";
import { isMaktab } from "@/lib/platform";
import LandingPage from "@/components/landing-page";

export default async function Home() {
  const session = await getAuthSession();
  if (session) {
    const accessViolation = getCrossAppAccessViolation(session.user);
    if (accessViolation) {
      // On bahola, show the landing page instead of redirecting cross-app users
      if (!isMaktab()) return <LandingPage />;
      redirect(accessViolation.loginUrl);
    }
    const role = (session.user as { role?: string })?.role;
    redirect(role === "DIRECTOR" ? "/director" : "/classes");
  }
  if (isMaktab()) redirect("/login");
  return <LandingPage />;
}
