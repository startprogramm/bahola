# Bahola

AI-powered assessment grading platform for educational institutions. Teachers create classes, upload mark schemes, and grade handwritten student work automatically using Google Gemini AI with support for multiple exam boards and languages.

## Features

### Teacher Tools
- **Class Management** — Create classes with unique join codes, customizable banners, and class streams (announcements, discussions)
- **Assessment Creation** — Upload mark schemes as PDF, Word, Excel, or images; AI extracts and stores the marking criteria
- **AI Grading** — Automatic OCR + grading of handwritten student submissions with detailed per-question feedback
- **Exam Board Detection** — Auto-detects Edexcel, Cambridge/CAIE, AQA, OCR, IB marking conventions (M/A/B marks, ECF, follow-through)
- **Score Adjustment** — Review and override AI-generated scores with adjustment reasons
- **Student Reports** — Track student progress across assessments

### Student Tools
- **Join Classes** — Enter a class code to join
- **Submit Work** — Upload photos of handwritten work (supports paste, drag-and-drop, multi-page, rotation)
- **Instant Feedback** — View AI-generated scores and detailed feedback per question
- **Class Stream** — Participate in class discussions and view announcements

### Platform
- **Multi-language UI** — English, Uzbek, Russian (full i18n across all pages)
- **Multi-language Feedback** — AI feedback generated in the user's chosen language, preserving technical terms in English
- **Subscription System** — Free (50 credits), Plus (300 credits/mo), Pro (unlimited)
- **Telegram Bot Integration** — Manage classes, upload assessments, and receive notifications via Telegram
- **Admin Dashboard** — User management, subscription approval, analytics
- **Dark Mode** — Full dark/light theme support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4, Shadcn/UI (Radix primitives), Framer Motion |
| Auth | NextAuth.js 4 (credentials + JWT, 30-day sessions) |
| Database | PostgreSQL via Neon Serverless + Prisma 6 ORM |
| AI | Google Gemini API — Gemini 3 Flash Preview (OCR/grading), Gemini 2.0 Flash Lite (page detection) |
| File Processing | sharp (images), mammoth (Word), exceljs (Excel) |
| Storage | Local filesystem (`/public/uploads/`) |
| Bot | node-telegram-bot-api |
| Animations | GSAP (landing page), Framer Motion (dashboard), CSS keyframes (cards) |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database ([Neon](https://neon.tech) recommended)
- [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd assessment-checker

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, secrets, and API keys

# Set up the database
npx prisma db push

# Start development server
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Yes |
| `NEXTAUTH_URL` | Application base URL | Yes |
| `NEXTAUTH_SECRET` | JWT signing secret | Yes |
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | No |
| `TELEGRAM_ADMIN_CHAT_ID` | Admin chat ID for notifications | No |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook verification secret | No |

## Project Structure

```
assessment-checker/
├── app/
│   ├── (auth)/                    # Login & registration pages
│   ├── (dashboard)/               # Protected routes
│   │   ├── admin/                 # Admin panel
│   │   ├── assessments/           # Submit work, view feedback
│   │   ├── classes/               # Class management & detail
│   │   ├── dashboard/             # Main dashboard (teacher/student)
│   │   ├── calendar/              # Calendar view
│   │   ├── profile/               # User profile
│   │   ├── settings/              # Subscription & preferences
│   │   ├── to-review/             # Pending reviews queue
│   │   └── todo/                  # Todo list
│   ├── api/                       # REST API routes
│   │   ├── auth/                  # NextAuth + registration
│   │   ├── classes/[classId]/     # Class CRUD, assessments, stream
│   │   ├── submissions/           # Upload & grading pipeline
│   │   ├── subscription/          # Plan management
│   │   ├── telegram/              # Bot webhook & commands
│   │   └── ...                    # Dashboard stats, translate, etc.
│   ├── globals.css
│   ├── layout.tsx                 # Root layout with providers
│   └── page.tsx                   # Landing page route
├── components/
│   ├── ui/                        # Shadcn UI primitives
│   ├── dashboard/                 # Dashboard-specific components
│   ├── landing-page.tsx           # Animated landing page (GSAP)
│   ├── navbar.tsx                 # Top navigation
│   ├── sidebar.tsx                # Side navigation
│   └── language-switcher.tsx      # EN/UZ/RU language toggle
├── hooks/
│   ├── use-sound-effects.ts       # UI sound effects
│   ├── use-submission-watcher.ts  # Polls grading status
│   └── use-toast.ts               # Toast notifications
├── lib/
│   ├── services/
│   │   ├── ocr-service.ts         # Gemini OCR (handwritten/all text modes)
│   │   └── grading-service.ts     # Gemini grading with exam board detection
│   ├── i18n/
│   │   ├── translations.ts        # 150+ translation keys (EN/UZ/RU)
│   │   └── language-context.tsx    # React context for language state
│   ├── auth.ts                    # NextAuth configuration
│   ├── prisma.ts                  # Prisma client singleton
│   ├── storage.ts                 # File upload/download helpers
│   ├── credits.ts                 # Credit system logic
│   └── subscription.ts            # Subscription tier logic
├── prisma/
│   └── schema.prisma              # Database schema (15 models)
├── scripts/
│   └── check-subscriptions.ts     # Subscription expiry checker
├── types/
│   └── next-auth.d.ts             # NextAuth type extensions
├── public/
│   ├── uploads/                   # User-uploaded files (gitignored)
│   ├── fonts/                     # Custom fonts
│   └── landing/                   # Landing page assets
├── middleware.ts                   # Route protection & redirects
├── ecosystem.config.js            # PM2 process manager config
├── package.json
└── tsconfig.json
```

## Scripts

```bash
npm run dev          # Start dev server (Next 16 + webpack mode)
npm run build        # Build for production (prisma generate + next build)
npm run start        # Start production server
npm run lint         # Run ESLint
npm run db:push      # Push schema changes to database
npm run db:generate  # Regenerate Prisma client
npm run db:studio    # Open Prisma Studio (database GUI)
```

## Grading Flow

1. **Teacher** creates an assessment and uploads mark scheme files (PDF/Word/Excel/images)
2. Mark scheme files are processed via OCR, extracted text is stored in the database
3. **Student** (or teacher on behalf) submits photos of handwritten work
4. Submission images are uploaded to storage and queued for processing
5. OCR service extracts text from student work (auto-sorts multi-page submissions by page number)
6. Grading service compares extracted text against mark scheme using Gemini AI
7. Per-question scores, feedback, and total score are stored in the database
8. Student views results with detailed feedback on the assessment page

## License

MIT

## Detailed Engineering Docs

For a full technical deep dive (architecture, auth flows, queueing, API grouping, operations, troubleshooting), see:

- `docs/ENGINEERING_DOCUMENTATION.md`
