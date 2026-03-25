import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export default async function DirectorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  // Enforce DB role at layout level so stale JWT role cannot show director UI.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, schoolId: true },
  });

  if (!user || user.role !== "DIRECTOR" || !user.schoolId) {
    redirect("/classes");
  }

  return <>{children}</>;
}
