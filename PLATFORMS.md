# Platform Architecture: bahola.uz & maktab.bahola.uz

## Overview

Two platforms serve different audiences but share underlying infrastructure:

| | **bahola.uz** | **maktab.bahola.uz** |
|---|---|---|
| **Purpose** | Open assessment platform — anyone can create/join classes | School management — strict roles, director-controlled |
| **Directory** | `/home/ubuntu/bahola` | `/home/ubuntu/maktab` |
| **Port** | 3001 | 3002 |
| **PM2 name** | `assessment-checker` | `maktab` |
| **URL** | `https://bahola.uz` | `https://maktab.bahola.uz` |

## What They Share

### Same Git Repository
Both directories are clones of `https://github.com/Salen-Project/bahola.git` at the **same commit**. They have diverged through **uncommitted local changes only**. Neither has committed their platform-specific customizations.

### Same Database
Both connect to the same Supabase PostgreSQL instance. All tables, rows, and data are shared. A user created on bahola.uz exists in maktab's database too.

### Same Prisma Schema
`prisma/schema.prisma` is identical. The `Role` enum (`STUDENT`, `TEACHER`, `DIRECTOR`) and all models exist in both. **Never change the schema in one without considering the other.**

## How They Differ (Uncommitted Local Changes)

### Role Model
- **bahola**: `User.role` is mostly ignored. Authorization uses class-level checks (`Class.teacherId`, `Enrollment.role`). Anyone can create classes, join classes, be a teacher in one and student in another.
- **maktab**: `User.role` is strictly enforced. Only `DIRECTOR` can create classes. `TEACHER`/`STUDENT` roles gate access. Middleware redirects non-directors away from `/director` pages.

### Class Creation
- **bahola** (`app/api/classes/route.ts`): Any authenticated user can create a class. Only directors can assign a different `teacherId`.
- **maktab**: Only directors can create classes (`creator.role !== "DIRECTOR"` check). Directors see all school classes, not just their own.

### Director Dashboard
- **bahola**: Basic director pages with standard components.
- **maktab**: Heavily customized director dashboard (1154+ lines in class page alone), extended API endpoints for school analytics, much richer UI.

### Middleware
- **bahola**: Only redirects DIRECTOR users to `/director` dashboard.
- **maktab**: Also redirects non-DIRECTOR users AWAY from `/director` pages.

### Landing Page, Auth Pages, Onboarding
Each has platform-specific branding, copy, and flows.

### Account Boundary
- Users with `User.schoolId != null` are treated as **maktab** accounts and must sign in on `https://maktab.bahola.uz`.
- Users with `User.schoolId == null` are treated as **bahola** accounts and must sign in on `https://bahola.uz`.
- This boundary is enforced in:
  - NextAuth credential / Google / auto-login flows
  - middleware redirects for protected routes
  - auth page redirects
  - registration (self-registration is blocked in maktab mode)

## Rules for AI Agents

### 1. Bug Fixes to Shared Logic MUST Be Applied to Both
Files that contain core business logic are functionally the same (or should be) across both platforms. When fixing bugs in these files, the same fix must be applied to `/home/ubuntu/maktab` as well:

**Shared logic files (fix in both):**
- `lib/services/grading-service.ts` — AI grading, scoring, feedback formatting
- `lib/services/ocr-service.ts` — OCR text extraction
- `lib/credits.ts` — Credit system
- `lib/ai-grading-queue.ts` — Grading queue
- `lib/subscription.ts` — Plan details
- `lib/storage.ts` — File upload/download
- `app/api/submissions/upload/route.ts` — Submission upload + grading
- `app/api/submissions/[submissionId]/ai-grade/route.ts` — Re-grade endpoint
- `app/api/submissions/[submissionId]/route.ts` — Submission CRUD
- `app/api/to-review/bulk-grade/route.ts` — Bulk grading
- `app/api/classes/[classId]/grades/route.ts` — Grades data
- `app/api/classes/[classId]/grades/export/route.ts` — Excel export
- `app/api/classes/[classId]/grades/set-score/route.ts` — Manual score entry
- `app/api/cron/expire-subscriptions/route.ts` — Subscription expiry
- `app/api/ai/chat/route.ts` — AI chat
- `prisma/schema.prisma` — Database schema

**Platform-specific files (do NOT copy between them):**
- `app/api/classes/route.ts` — Different role logic
- `app/api/classes/[classId]/assessments/route.ts` — May have platform-specific queue logic
- `middleware.ts` — Different role redirects
- `app/(auth)/` pages — Different auth flows
- `app/(director)/` pages — Heavily diverged
- `components/director/` — Heavily diverged
- `components/landing-page.tsx` — Different branding
- `components/sidebar.tsx` — Different navigation
- `app/api/director/` — Different analytics queries

### 2. Never `rsync`, `cp -r`, or Overwrite One With the Other
Each platform has unique uncommitted customizations. Wholesale copying destroys those customizations.

### 3. Apply Fixes Manually, Not by Copy
When a shared file needs the same fix in both:
1. Fix the file in `/home/ubuntu/bahola`
2. Read the corresponding file in `/home/ubuntu/maktab`
3. Apply the equivalent edit (the surrounding code may differ slightly)
4. Build and restart each independently

### 4. Build and Deploy Independently
```bash
# bahola.uz
cd /home/ubuntu/bahola && npm run build && pm2 restart assessment-checker

# maktab.bahola.uz
cd /home/ubuntu/maktab && npm run build && pm2 restart maktab
```

### 5. Schema Changes Affect Both
Since both share the same database, any `prisma db push` or migration runs against the shared database. Always consider impact on both platforms before modifying the schema.

### 6. When in Doubt, Ask
If unsure whether a file is shared or platform-specific, check:
```bash
diff /home/ubuntu/bahola/<file> /home/ubuntu/maktab/<file>
```
If the diff is small (just the bug you're fixing), it's shared logic. If the diff is large with completely different implementations, it's platform-specific.

## Known Pending: Bugs Fixed in bahola but NOT in maktab

As of 2026-02-25, the following bugs were fixed in bahola only. They still exist in maktab:

1. **ai-grade maxScore=0** when totalMarks=0 (saves 0 instead of AI result)
2. **ai-grade credit race** — non-atomic `hasCredits` + late `deductCredit`
3. **ai-grade credits charged to co-teacher** instead of class owner
4. **bulk-grade ignores totalMarks** — uses raw AI maxScore, no clamping
5. **bulk-grade credit race** — same `hasCredits` + late `deductCredit`
6. **bulk-grade credits charged to co-teacher**
7. **Grades export broken dedup** — compares date against `new Date("GRADED")`
8. **Grades export Infinity in average** — division by maxScore=0
9. **set-score fake 100%** — maxScore falls back to student's own score
10. **formatFeedbackAsMarkdown division by zero** — `score/maxScore` when maxScore=0
11. **ai/chat charges on empty reply** — non-streaming path deducts credit unconditionally
12. **expire-subscriptions PRO→0 credits** — `Math.min(-1, 50)` = -1 → 0
13. **Score adjustment null maxScore** — validates against `submission.maxScore!` which can be null
14. **File deletion orphans files** — `path.basename` strips subdirectory
15. **processQueuedSubmission maxScore bug** — ignores totalMarks
16. **processQueuedSubmission credit race** — same `hasCredits` + late `deductCredit`
17. **Assessment stuck in DRAFT** — background OCR failure leaves assessment unactivated
