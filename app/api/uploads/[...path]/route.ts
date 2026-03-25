import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher, isSuperAdmin } from "@/lib/prisma";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

// In-memory auth cache: "userId:fileName" -> expiry timestamp
// Prevents repeated DB queries when loading multiple pages of the same submission
const authCache = new Map<string, number>();
const AUTH_CACHE_TTL = 60_000; // 1 minute

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".heic": "image/heic",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { path: pathParts } = await params;
    const filename = pathParts.join("/");

    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(filename);
    const uploadUrl = `/uploads/${safeName}`;
    const filePath = path.join(UPLOAD_DIR, safeName);

    // Build alternate name variants for authorization (e.g. .pdf -> .docx, .doc)
    const requestedExt = path.extname(safeName).toLowerCase();
    const nameVariants = [safeName];
    if (requestedExt === ".pdf") {
      nameVariants.push(safeName.replace(/\.pdf$/i, ".docx"));
      nameVariants.push(safeName.replace(/\.pdf$/i, ".doc"));
    }

    // Check auth cache first to avoid DB queries for recently-authorized files
    const cacheKey = `${session.user.id}:${safeName}`;
    const cachedExpiry = authCache.get(cacheKey);
    if (cachedExpiry && cachedExpiry > Date.now()) {
      // Skip DB auth checks - already verified recently
    } else {
    // Authorization: file must belong to a resource visible to current user.
    const [submission, assessment, streamPost] = await Promise.all([
      prisma.submission.findFirst({
        where: {
          OR: nameVariants.map(n => ({ imageUrls: { contains: n } })),
          AND: {
            OR: [
              { studentId: session.user.id },
              { assessment: { class: { teacherId: session.user.id } } },
              { assessment: { class: { enrollments: { some: { studentId: session.user.id, role: "TEACHER" } } } } },
              { assessment: { class: { school: { directorId: session.user.id } } } },
            ],
          },
        },
        select: { id: true },
      }),
      prisma.assessment.findFirst({
        where: {
          OR: nameVariants.flatMap(n => [
            { markSchemePdfUrl: { contains: `/uploads/${n}` } },
            { markSchemeFileUrls: { contains: n } },
            { questionPaperFileUrls: { contains: n } },
          ]),
          class: {
            OR: [
              { teacherId: session.user.id },
              { enrollments: { some: { studentId: session.user.id } } },
              { school: { directorId: session.user.id } },
            ],
          },
        },
        select: {
          classId: true,
          class: { select: { teacherId: true } },
          markSchemePdfUrl: true,
          markSchemeFileUrls: true,
          questionPaperFileUrls: true,
          studentsSeeMarkScheme: true,
          studentsSeeQP: true,
        },
      }),
      prisma.streamPost.findFirst({
        where: {
          attachments: { contains: safeName },
          class: {
            OR: [
              { teacherId: session.user.id },
              { enrollments: { some: { studentId: session.user.id } } },
              { school: { directorId: session.user.id } },
            ],
          },
        },
        select: { id: true },
      }),
    ]);

    // Superadmins can access any uploaded file
    const superAdmin = await isSuperAdmin(session.user.id);
    let allowed = superAdmin || Boolean(submission || streamPost);

    // Avatar files are accessible to any authenticated user
    if (!allowed && safeName.startsWith("avatars")) {
      allowed = true;
    }

    if (!allowed && assessment) {
      const isTeacher = await isUserClassTeacher(session.user.id, assessment.classId);
      if (isTeacher) {
        allowed = true;
      } else {
        let markSchemeFiles: string[] = [];
        let questionPaperFiles: string[] = [];
        try {
          markSchemeFiles = assessment.markSchemeFileUrls ? JSON.parse(assessment.markSchemeFileUrls) as string[] : [];
        } catch {
          markSchemeFiles = [];
        }
        try {
          questionPaperFiles = assessment.questionPaperFileUrls ? JSON.parse(assessment.questionPaperFileUrls) as string[] : [];
        } catch {
          questionPaperFiles = [];
        }
        const isMarkSchemeFile =
          assessment.markSchemePdfUrl?.includes(uploadUrl) ||
          markSchemeFiles.some((url) => typeof url === "string" && url.includes(uploadUrl));
        const isQuestionPaperFile =
          questionPaperFiles.some((url) => typeof url === "string" && url.includes(uploadUrl));

        if (isMarkSchemeFile && assessment.studentsSeeMarkScheme) {
          allowed = true;
        }
        if (isQuestionPaperFile && assessment.studentsSeeQP) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cache successful authorization
    authCache.set(cacheKey, Date.now() + AUTH_CACHE_TTL);
    } // end of auth cache miss block

    // Check if file exists
    let resolvedPath = filePath;
    let resolvedName = safeName;
    try {
      await fs.access(resolvedPath);
    } catch {
      // If a .pdf was requested but doesn't exist, try to convert from .docx/.doc
      if (requestedExt === ".pdf") {
        const docxPath = filePath.replace(/\.pdf$/i, ".docx");
        const docPath = filePath.replace(/\.pdf$/i, ".doc");
        let sourcePath: string | null = null;

        try {
          await fs.access(docxPath);
          sourcePath = docxPath;
        } catch {
          try {
            await fs.access(docPath);
            sourcePath = docPath;
          } catch {
            // Neither exists
          }
        }

        if (sourcePath) {
          // Convert Word doc to PDF on-the-fly using LibreOffice
          try {
            const os = await import("os");
            const { execFile } = await import("child_process");
            const { promisify } = await import("util");
            const execFileAsync = promisify(execFile);

            const tmpDir = await fs.mkdtemp(path.join(os.default.tmpdir(), "doc2pdf-"));
            try {
              await execFileAsync("libreoffice", [
                "--headless", "--convert-to", "pdf", "--outdir", tmpDir, sourcePath,
              ], { timeout: 30000 });

              const baseName = path.basename(sourcePath, path.extname(sourcePath));
              const pdfTmpPath = path.join(tmpDir, `${baseName}.pdf`);
              await fs.access(pdfTmpPath);

              // Copy to uploads directory for caching
              await fs.copyFile(pdfTmpPath, filePath);
              resolvedPath = filePath;
              resolvedName = safeName;
            } finally {
              await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
            }
          } catch (convError) {
            console.error("On-the-fly Word to PDF conversion failed:", convError);
            return NextResponse.json({ error: "File not found" }, { status: 404 });
          }
        } else {
          return NextResponse.json({ error: "File not found" }, { status: 404 });
        }
      } else {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
    }

    // Read file
    const fileBuffer = await fs.readFile(resolvedPath);

    // Determine content type
    const resolvedExt = path.extname(resolvedName).toLowerCase();
    const contentType = MIME_TYPES[resolvedExt] || "application/octet-stream";

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json({ error: "Failed to serve file" }, { status: 500 });
  }
}
