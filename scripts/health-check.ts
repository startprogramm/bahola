#!/usr/bin/env npx tsx
/**
 * Dev Environment Health Check Script
 *
 * Checks both dev servers (bahola :4001, maktab :4002) for:
 * - Server responsiveness (homepage, key pages)
 * - Static asset availability (landing images, uploads)
 * - API endpoint responsiveness
 * - Database connectivity and model integrity
 * - Missing files referenced in DB records (avatars, submission images, mark schemes)
 *
 * Usage:
 *   npx tsx scripts/health-check.ts            # Full check (both servers + DB)
 *   npx tsx scripts/health-check.ts --http-only # HTTP checks only (no DB)
 *   npx tsx scripts/health-check.ts --db-only   # DB integrity checks only
 *   npx tsx scripts/health-check.ts --json      # Output as JSON
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVERS = [
  { name: "dev-bahola", baseUrl: "http://127.0.0.1:4001", mode: "bahola" },
  { name: "dev-maktab", baseUrl: "http://127.0.0.1:4002", mode: "maktab" },
] as const;

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

const TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = "error" | "warning" | "info";

interface Finding {
  category: string;
  severity: Severity;
  message: string;
  details?: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function httpCheck(url: string, timeoutMs = TIMEOUT_MS): Promise<{ ok: boolean; status: number; durationMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, durationMs: Date.now() - start };
  } catch {
    return { ok: false, status: 0, durationMs: Date.now() - start };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveLocalPath(url: string): string | null {
  if (!url) return null;
  // Handle /uploads/filename or /api/uploads/filename
  const match = url.match(/\/(?:api\/)?uploads\/(.+)$/);
  if (match) return path.join(UPLOAD_DIR, match[1]);
  // Handle full URLs with /uploads/ path
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/(?:api\/)?uploads\/(.+)$/);
    if (pathMatch) return path.join(UPLOAD_DIR, pathMatch[1]);
  } catch {
    // not a URL
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP Checks
// ---------------------------------------------------------------------------

async function checkServerPages(server: typeof SERVERS[number]): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const pages = [
    { path: "/", label: "Homepage" },
    { path: "/login", label: "Login page" },
    { path: "/register", label: "Register page" },
  ];

  for (const page of pages) {
    const url = `${server.baseUrl}${page.path}`;
    const result = await httpCheck(url);
    if (!result.ok) {
      findings.push({
        category: "server",
        severity: "error",
        message: `${page.label} returned ${result.status || "timeout"} on ${server.name}`,
        details: url,
      });
    } else if (result.durationMs > 5000) {
      findings.push({
        category: "server",
        severity: "warning",
        message: `${page.label} slow (${result.durationMs}ms) on ${server.name}`,
        details: url,
      });
    }
  }

  return {
    name: `${server.name}: page responsiveness`,
    passed: findings.filter(f => f.severity === "error").length === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkStaticAssets(server: typeof SERVERS[number]): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const assets = [
    "/landing/grading.png",
    "/landing/step1.png",
    "/landing/step2.png",
    "/landing/step3.png",
    "/landing/step4.png",
  ];

  for (const asset of assets) {
    const url = `${server.baseUrl}${asset}`;
    const result = await httpCheck(url);
    if (!result.ok) {
      findings.push({
        category: "static-assets",
        severity: "warning",
        message: `Missing static asset: ${asset} on ${server.name}`,
        details: `HTTP ${result.status || "timeout"}`,
      });
    }
  }

  return {
    name: `${server.name}: static assets`,
    passed: findings.filter(f => f.severity === "error").length === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkApiEndpoints(server: typeof SERVERS[number]): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  // These endpoints should return something even without auth (401 is acceptable — means the route exists)
  const endpoints = [
    { path: "/api/auth/providers", expectStatus: [200] },
    { path: "/api/app/version-check", expectStatus: [200] },
    { path: "/api/classes", expectStatus: [200, 401, 403] },
    { path: "/api/submissions/recent", expectStatus: [200, 401, 403] },
    { path: "/api/to-review", expectStatus: [200, 401, 403] },
  ];

  for (const ep of endpoints) {
    const url = `${server.baseUrl}${ep.path}`;
    const result = await httpCheck(url);
    if (result.status === 0) {
      findings.push({
        category: "api",
        severity: "error",
        message: `API timeout: ${ep.path} on ${server.name}`,
        details: url,
      });
    } else if (result.status === 500 || result.status === 502 || result.status === 503) {
      findings.push({
        category: "api",
        severity: "error",
        message: `API server error: ${ep.path} returned ${result.status} on ${server.name}`,
        details: url,
      });
    } else if (result.status === 404) {
      findings.push({
        category: "api",
        severity: "warning",
        message: `API route not found: ${ep.path} on ${server.name}`,
        details: `HTTP 404`,
      });
    }
  }

  return {
    name: `${server.name}: API endpoints`,
    passed: findings.filter(f => f.severity === "error").length === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Database Integrity Checks
// ---------------------------------------------------------------------------

async function checkMissingAvatars(prisma: PrismaClient): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const usersWithAvatars = await prisma.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, name: true, avatar: true },
  });

  let missing = 0;
  for (const user of usersWithAvatars) {
    if (!user.avatar) continue;
    const localPath = resolveLocalPath(user.avatar);
    if (localPath) {
      const exists = await fileExists(localPath);
      if (!exists) {
        missing++;
        if (missing <= 10) {
          findings.push({
            category: "db-integrity",
            severity: "error",
            message: `Missing avatar file for user "${user.name}" (${user.id})`,
            details: user.avatar,
          });
        }
      }
    }
  }

  if (missing > 10) {
    findings.push({
      category: "db-integrity",
      severity: "error",
      message: `... and ${missing - 10} more missing avatar files (${missing} total)`,
    });
  }

  if (missing === 0) {
    findings.push({
      category: "db-integrity",
      severity: "info",
      message: `All ${usersWithAvatars.length} user avatars are present on disk`,
    });
  }

  return {
    name: "DB: missing avatar files",
    passed: missing === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkMissingSubmissionImages(prisma: PrismaClient): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const submissions = await prisma.submission.findMany({
    where: { imageUrls: { not: "" } },
    select: { id: true, imageUrls: true, studentId: true, assessmentId: true },
  });

  let totalUrls = 0;
  let missingCount = 0;
  const missingBySubmission: { submissionId: string; urls: string[] }[] = [];

  for (const sub of submissions) {
    let urls: string[] = [];
    try {
      urls = JSON.parse(sub.imageUrls);
    } catch {
      // imageUrls might be a single URL string
      if (sub.imageUrls.startsWith("/") || sub.imageUrls.startsWith("http")) {
        urls = [sub.imageUrls];
      }
    }

    const missingUrls: string[] = [];
    for (const url of urls) {
      totalUrls++;
      const localPath = resolveLocalPath(url);
      if (localPath) {
        const exists = await fileExists(localPath);
        if (!exists) {
          missingCount++;
          missingUrls.push(url);
        }
      }
    }

    if (missingUrls.length > 0) {
      missingBySubmission.push({ submissionId: sub.id, urls: missingUrls });
    }
  }

  // Report first 5 submissions with missing files
  for (const item of missingBySubmission.slice(0, 5)) {
    findings.push({
      category: "db-integrity",
      severity: "error",
      message: `Submission ${item.submissionId}: ${item.urls.length} missing image(s)`,
      details: item.urls.slice(0, 3).join(", ") + (item.urls.length > 3 ? ` ... +${item.urls.length - 3} more` : ""),
    });
  }

  if (missingBySubmission.length > 5) {
    findings.push({
      category: "db-integrity",
      severity: "error",
      message: `... and ${missingBySubmission.length - 5} more submissions with missing images`,
    });
  }

  if (missingCount === 0) {
    findings.push({
      category: "db-integrity",
      severity: "info",
      message: `All ${totalUrls} submission image URLs resolve to files on disk`,
    });
  } else {
    findings.push({
      category: "db-integrity",
      severity: "error",
      message: `${missingCount}/${totalUrls} submission image files missing on disk`,
    });
  }

  return {
    name: "DB: missing submission images",
    passed: missingCount === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkMissingMarkSchemes(prisma: PrismaClient): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const assessments = await prisma.assessment.findMany({
    where: {
      OR: [
        { markSchemeFileUrls: { not: null } },
        { markSchemePdfUrl: { not: null } },
        { questionPaperFileUrls: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      markSchemeFileUrls: true,
      markSchemePdfUrl: true,
      questionPaperFileUrls: true,
    },
  });

  let missingCount = 0;
  let totalFiles = 0;

  for (const assessment of assessments) {
    const urlSources: { label: string; raw: string | null }[] = [
      { label: "markSchemeFileUrls", raw: assessment.markSchemeFileUrls },
      { label: "markSchemePdfUrl", raw: assessment.markSchemePdfUrl },
      { label: "questionPaperFileUrls", raw: assessment.questionPaperFileUrls },
    ];

    for (const source of urlSources) {
      if (!source.raw) continue;

      let urls: string[] = [];
      try {
        const parsed = JSON.parse(source.raw);
        urls = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        if (source.raw.startsWith("/") || source.raw.startsWith("http")) {
          urls = [source.raw];
        }
      }

      for (const url of urls) {
        totalFiles++;
        const localPath = resolveLocalPath(url);
        if (localPath) {
          const exists = await fileExists(localPath);
          if (!exists) {
            missingCount++;
            if (missingCount <= 5) {
              findings.push({
                category: "db-integrity",
                severity: "error",
                message: `Assessment "${assessment.title}" (${assessment.id}): missing ${source.label} file`,
                details: url,
              });
            }
          }
        }
      }
    }
  }

  if (missingCount > 5) {
    findings.push({
      category: "db-integrity",
      severity: "error",
      message: `... and ${missingCount - 5} more missing mark scheme/question paper files (${missingCount} total)`,
    });
  }

  if (missingCount === 0) {
    findings.push({
      category: "db-integrity",
      severity: "info",
      message: `All ${totalFiles} mark scheme / question paper files present on disk`,
    });
  }

  return {
    name: "DB: missing mark scheme / question paper files",
    passed: missingCount === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkClassBanners(prisma: PrismaClient): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  const classes = await prisma.class.findMany({
    where: { classAvatar: { not: null } },
    select: { id: true, name: true, classAvatar: true },
  });

  let missingCount = 0;
  for (const cls of classes) {
    if (!cls.classAvatar) continue;
    const localPath = resolveLocalPath(cls.classAvatar);
    if (localPath) {
      const exists = await fileExists(localPath);
      if (!exists) {
        missingCount++;
        if (missingCount <= 5) {
          findings.push({
            category: "db-integrity",
            severity: "warning",
            message: `Class "${cls.name}" (${cls.id}): missing banner/avatar file`,
            details: cls.classAvatar,
          });
        }
      }
    }
  }

  if (missingCount > 5) {
    findings.push({
      category: "db-integrity",
      severity: "warning",
      message: `... and ${missingCount - 5} more missing class banners (${missingCount} total)`,
    });
  }

  if (missingCount === 0) {
    findings.push({
      category: "db-integrity",
      severity: "info",
      message: `All ${classes.length} class banners present on disk`,
    });
  }

  return {
    name: "DB: missing class banner files",
    passed: missingCount === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

async function checkDatabaseConnectivity(prisma: PrismaClient): Promise<CheckResult> {
  const findings: Finding[] = [];
  const start = Date.now();

  try {
    const userCount = await prisma.user.count();
    const classCount = await prisma.class.count();
    const submissionCount = await prisma.submission.count();
    const assessmentCount = await prisma.assessment.count();

    findings.push({
      category: "database",
      severity: "info",
      message: `DB connected — ${userCount} users, ${classCount} classes, ${assessmentCount} assessments, ${submissionCount} submissions`,
    });

    // Check for stuck submissions (PROCESSING for > 30 min)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const stuckSubmissions = await prisma.submission.count({
      where: { status: "PROCESSING", updatedAt: { lt: thirtyMinAgo } },
    });

    if (stuckSubmissions > 0) {
      findings.push({
        category: "database",
        severity: "warning",
        message: `${stuckSubmissions} submissions stuck in PROCESSING for >30 minutes`,
      });
    }

    // Check for error submissions
    const errorSubmissions = await prisma.submission.count({
      where: { status: "ERROR" },
    });

    if (errorSubmissions > 0) {
      findings.push({
        category: "database",
        severity: "warning",
        message: `${errorSubmissions} submissions in ERROR status`,
      });
    }
  } catch (err) {
    findings.push({
      category: "database",
      severity: "error",
      message: `Database connection failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    name: "DB: connectivity & model counts",
    passed: findings.filter(f => f.severity === "error").length === 0,
    durationMs: Date.now() - start,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: CheckResult[], asJson: boolean) {
  if (asJson) {
    const summary = {
      timestamp: new Date().toISOString(),
      overallPassed: results.every(r => r.passed),
      totalChecks: results.length,
      passedChecks: results.filter(r => r.passed).length,
      failedChecks: results.filter(r => !r.passed).length,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
      errors: results.flatMap(r => r.findings.filter(f => f.severity === "error")),
      warnings: results.flatMap(r => r.findings.filter(f => f.severity === "warning")),
      results,
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log("  DEV ENVIRONMENT HEALTH CHECK REPORT");
  console.log("  " + new Date().toISOString());
  console.log("=".repeat(70) + "\n");

  for (const result of results) {
    const icon = result.passed ? "PASS" : "FAIL";
    console.log(`[${icon}] ${result.name} (${result.durationMs}ms)`);
    for (const f of result.findings) {
      const prefix = f.severity === "error" ? "  !! " : f.severity === "warning" ? "  !  " : "     ";
      console.log(`${prefix}${f.message}`);
      if (f.details) console.log(`       ${f.details}`);
    }
    console.log();
  }

  const errors = results.flatMap(r => r.findings.filter(f => f.severity === "error"));
  const warnings = results.flatMap(r => r.findings.filter(f => f.severity === "warning"));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log("=".repeat(70));
  console.log(`  SUMMARY: ${passed}/${total} checks passed | ${errors.length} errors | ${warnings.length} warnings`);
  console.log("=".repeat(70) + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const httpOnly = args.includes("--http-only");
  const dbOnly = args.includes("--db-only");
  const asJson = args.includes("--json");

  const results: CheckResult[] = [];

  // HTTP checks
  if (!dbOnly) {
    for (const server of SERVERS) {
      const [pages, assets, api] = await Promise.all([
        checkServerPages(server),
        checkStaticAssets(server),
        checkApiEndpoints(server),
      ]);
      results.push(pages, assets, api);
    }
  }

  // DB checks
  if (!httpOnly) {
    const prisma = new PrismaClient();
    try {
      results.push(await checkDatabaseConnectivity(prisma));
      results.push(await checkMissingAvatars(prisma));
      results.push(await checkMissingSubmissionImages(prisma));
      results.push(await checkMissingMarkSchemes(prisma));
      results.push(await checkClassBanners(prisma));
    } finally {
      await prisma.$disconnect();
    }
  }

  printReport(results, asJson);

  // Exit with non-zero if any check failed
  const hasFailures = results.some(r => !r.passed);
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error("Health check script crashed:", err);
  process.exit(2);
});
