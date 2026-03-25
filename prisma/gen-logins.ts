import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const school = await prisma.school.findUnique({ where: { code: "PMGUL2025" } });
  if (!school) { console.log("School not found"); return; }

  const users = await prisma.user.findMany({
    where: { schoolId: school.id },
    include: { schoolMemberships: { where: { schoolId: school.id } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const lines: string[] = [];
  lines.push("=".repeat(70));
  lines.push("GULISTON SHAHRIDAGI PREZIDENT MAKTABI");
  lines.push("Login ma'lumotlari / Login Details");
  lines.push("=".repeat(70));
  lines.push("");

  const director = users.find(u => u.role === "DIRECTOR");
  if (director) {
    lines.push("-".repeat(50));
    lines.push("DIREKTOR / DIRECTOR");
    lines.push("-".repeat(50));
    lines.push("Ism: " + director.name);
    lines.push("Login: " + director.email);
    lines.push("Parol: Direktor2025!");
    lines.push("");
  }

  const teachers = users.filter(u => u.role === "TEACHER").sort((a, b) => a.name.localeCompare(b.name));
  lines.push("-".repeat(50));
  lines.push("O'QITUVCHILAR / TEACHERS");
  lines.push("Parol (hammasi uchun): Teacher2025!");
  lines.push("-".repeat(50));
  for (const t of teachers) {
    lines.push(t.name.padEnd(45) + " | " + t.email);
  }
  lines.push("");

  const students = users.filter(u => u.role === "STUDENT");
  lines.push("-".repeat(50));
  lines.push("O'QUVCHILAR / STUDENTS");
  lines.push("Parol (hammasi uchun): Student2025!");
  lines.push("-".repeat(50));

  const groups: Record<string, { name: string; email: string }[]> = {};
  for (const s of students) {
    const mem = s.schoolMemberships[0];
    const key = (mem?.grade || "?") + "-" + (mem?.subclass || "?");
    if (!groups[key]) groups[key] = [];
    groups[key].push({ name: s.name, email: s.email || "" });
  }

  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const [ga, da] = a.split("-");
    const [gb, db] = b.split("-");
    return parseInt(ga) - parseInt(gb) || da.localeCompare(db);
  });

  for (const key of sortedKeys) {
    const [grade, div] = key.split("-");
    lines.push("");
    lines.push("  " + grade + "-sinf " + div + ":");
    groups[key].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of groups[key]) {
      lines.push("    " + s.name.padEnd(45) + " | " + s.email);
    }
  }

  lines.push("");
  lines.push("=".repeat(70));
  lines.push("Website: https://maktab.bahola.uz");
  lines.push("Maktab kodi: PMGUL2025");
  lines.push("=".repeat(70));

  const outPath = path.join(__dirname, "guliston-logins.txt");
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log(`Done: ${teachers.length} teachers, ${students.length} students -> ${outPath}`);
}

main().then(() => prisma.$disconnect());
