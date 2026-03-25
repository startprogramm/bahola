# Mobile API Documentation

Base URL: `https://teztekshir.uz`

All endpoints return JSON. Auth uses cookies (NextAuth JWT session). The native app must persist cookies across requests using OkHttp CookieJar (Android) or URLSession cookie storage (iOS).

All error responses follow the format: `{ error: string }`

---

## App Lifecycle

### GET /api/app/version-check
Check if the mobile app needs an update. **No auth required.**
```
Query: ?platform=android|ios&version=1.0.0
Response: {
  forceUpdate: boolean,
  updateAvailable: boolean,
  latestVersion: string,
  minVersion: string,
  updateUrl: string
}
```

---

## Auth

### POST /api/auth/callback/credentials
Login with email/password.
```
Body (JSON): { email: string, password: string }
Response: NextAuth session cookie set automatically
```
Note: On success, the response sets `next-auth.session-token` cookie. Store and send this cookie with all subsequent requests.

### POST /api/auth/callback/google-id-token
Login with Google ID token (for native Google Sign-In).
```
Body (JSON): { idToken: string }
Response: NextAuth session cookie set automatically
```
Important: Use the Android server client ID (`GOOGLE_ANDROID_SERVER_CLIENT_ID`) when configuring Google Sign-In on the mobile app. The backend verifies the token's audience against both web and Android client IDs.

### GET /api/auth/session
Get current session info.
```
Response: {
  user: { id: string, name: string, email: string, image: string | null },
  expires: string
}
```
Returns `{}` if not authenticated.

### POST /api/auth/signout
Logout. Clears session cookie.
```
Body (JSON): { csrfToken?: string }
```

### POST /api/auth/register
Create a new account. **No auth required.**
```
Body (JSON): { name: string, email: string, password: string }
Response (201): { message: string, user: { id, name, email, credits } }
```

### POST /api/auth/forgot-password
Request a password reset code. **No auth required.**
```
Body (JSON): { email: string }
Response: { message: "If an account with that email exists, a reset code has been sent." }
```
Always returns success to prevent email enumeration. A 6-digit code is sent to the email (email delivery requires server-side email provider configuration).

### POST /api/auth/reset-password
Reset password using the 6-digit code. **No auth required.**
```
Body (JSON): { email: string, code: string, newPassword: string }
Response: { message: "Password reset successfully. You can now log in." }
```
Code expires after 15 minutes.

---

## User Profile

### GET /api/user/profile
```
Response: {
  user: {
    id: string,
    name: string,
    email: string | null,
    avatar: string | null,
    credits: number,
    subscription: "FREE" | "PLUS" | "PRO" | "MAX",
    subscriptionExpiresAt: string | null,
    fileLimit: number,
    createdAt: string
  }
}
```

### PATCH /api/user/profile
```
Body (JSON): { name?: string, email?: string }
Response: { user: { id, name, email } }
```

### DELETE /api/user/profile
Deletes account and all related data (classes, submissions, enrollments).
```
Response: { message: string }
```

### POST /api/user/avatar
Upload a profile picture. Multipart form.
```
Fields:
  avatar: File (JPEG, PNG, WebP, GIF; max 5MB)
Response: { user: { id, avatar } }
```

### DELETE /api/user/avatar
Remove profile picture.
```
Response: { message: string }
```

---

## Push Notifications (Device Tokens)

### POST /api/user/device-token
Register or update a push notification token. Call after login and on token refresh.
```
Body (JSON): { token: string, platform: "android" | "ios" }
Response: { message: string, deviceToken: { id, platform } }
```

### DELETE /api/user/device-token
Remove a device token (call on logout).
```
Body (JSON): { token: string }
Response: { message: string }
```

---

## Classes (Teacher)

### GET /api/classes
List classes the user created (teacher view).
```
Query: ?limit=50&archived=true|false
Response: { classes: [{
  id, name, code, subject, description, headerColor, bannerStyle,
  createdAt, updatedAt, teacherId,
  _count: { enrollments: number, assessments: number },
  assessments: [{ id, title, dueDate }]
}] }
```
When `?archived` param is provided, returns the array directly (no `classes` wrapper).

### POST /api/classes
Create a class.
```
Body (JSON): { name: string, description?: string, subject?: string }
Response (201): {
  message: string,
  class: { id, name, description, subject, code, teacherId, headerColor, bannerStyle, createdAt, updatedAt }
}
```

### GET /api/classes/[classId]
Full class detail with enrollments and assessments.
```
Response: {
  class: {
    id, name, code, description, subject, headerColor, bannerStyle, teacherId, archived,
    teacher: { id, name, email },
    enrollments: [{ id, joinedAt, student: { id, name, email, avatar } }],
    assessments: [{
      id, title, status, totalMarks, dueDate, createdAt,
      submissions: [{ id, status, score, maxScore, createdAt, student: { id, name, email } }]
    }]
  }
}
```

### PATCH /api/classes/[classId]
```
Body (JSON): { name?, description?, subject?, archived?: boolean, headerColor?, bannerStyle? }
Response: { class: { id, name, code, description, subject, headerColor, bannerStyle, createdAt, updatedAt, teacherId } }
```

### DELETE /api/classes/[classId]
Deletes class + all assessments + submissions.
```
Response: { message: string }
```

### POST /api/classes/join
Join a class as a student.
```
Body (JSON): { code: string }
Response: { message: string, class: { id, name, teacher: string } }
```

### POST /api/classes/[classId]/leave
Student leaves a class (removes enrollment).
```
Response: { success: true }
```

### DELETE /api/classes/[classId]/students/[studentId]
Teacher removes a student from the class.
```
Response: { message: string }
```

### POST /api/classes/[classId]/transfer-ownership
Transfer class ownership to an enrolled student. Teacher only.
```
Body (JSON): { newTeacherId: string }
Response: { message: string }
```

---

## Student Classes

### GET /api/student/classes
Classes the current user is enrolled in (student view).
```
Response: {
  enrollments: [{
    id: string,
    joinedAt: string,
    class: {
      id, name, code, subject, description, headerColor, bannerStyle, createdAt, teacherId,
      teacher: { name, avatar },
      _count: { assessments: number },
      assessments: [{ id, title, dueDate }]
    }
  }]
}
```

### GET /api/student/dashboard/stats
```
Response: {
  totalClasses: number,
  completedAssessments: number,
  averageScore: number,
  pendingAssessments: number
}
```

### GET /api/student/assessments/recent
```
Query: ?limit=5
Response: {
  assessments: [{
    id, title, createdAt, dueDate, totalMarks, status,
    class: { name },
    submissions: [{ id, score, maxScore, status }]
  }]
}
```

---

## Assessments

### POST /api/classes/[classId]/assessments
Create an assessment. Multipart form. Teacher only.
```
Fields:
  title: string (required)
  dueDate?: ISO 8601 string
  feedbackLanguage: "english" | "uzbek" | "russian"
  totalMarks: number
  showAIFeedback: boolean
  showTextInput: boolean
  studentsCanUpload: boolean
  studentsSeeMarkScheme: boolean
  studentsSeeQP: boolean
  customPrompt?: string
  markSchemeText?: string
  markSchemeFiles: File[]
  assessmentFiles: File[]
Response (201): {
  message: string,
  assessment: { id, title, status: "DRAFT", ... }
}
```
Note: Status starts as `DRAFT` while mark scheme/question paper files are processed via OCR. It transitions to `ACTIVE` automatically once processing completes.

### GET /api/assessments/[assessmentId]
```
Response: {
  assessment: {
    id, title, markScheme, totalMarks, status, dueDate, createdAt,
    feedbackLanguage, customPrompt, assessmentType,
    showAIFeedback, showTextInput, studentsCanUpload, studentsSeeMarkScheme, studentsSeeQP,
    markSchemeFileUrls, questionPaperFileUrls,
    class: {
      id, name, code,
      teacher: { id, name, email },
      enrollments: [{ student: { id, name, email, avatar } }]
    },
    submissions: [{
      id, imageUrls, score, maxScore, feedback, status,
      gradingProgress, createdAt, gradedAt,
      originalScore, adjustedBy, adjustmentReason, adjustedAt,
      reportReason, reportedAt,
      student: { id, name, email, avatar }
    }]
  }
}
```

### PATCH /api/assessments/[assessmentId]
Update assessment. Multipart form. Teacher only. Same fields as create.
```
Response: { message: string, assessment: { ... } }
```

### DELETE /api/assessments/[assessmentId]
Teacher only.
```
Response: { message: string }
```

---

## Submissions

### POST /api/submissions/upload
Upload student work. Multipart form.
```
Fields:
  assessmentId: string (required)
  studentId: string (required; for students, forced to their own ID server-side)
  files: File[] (images: PNG, JPG, GIF, WebP; max 10MB each)
  reuseImageUrls?: JSON string (array of URLs from previous submission)
  pageOrder?: JSON string ([{ type: "file"|"reuse", index: number }])
  feedbackLanguage?: string
  useAIGrading?: "true"|"false" (default: true)
Response (201): {
  message: string,
  submission: { id: string, status: string, useAIGrading: boolean }
}
```

### GET /api/submissions/[submissionId]
```
Response: {
  submission: {
    id, imageUrls (JSON string), extractedText (null for students),
    score, maxScore, feedback, status, gradingProgress,
    createdAt, gradedAt, updatedAt,
    originalScore, adjustedBy, adjustmentReason, adjustedAt,
    reportReason, reportedAt,
    student: { id, name, email, avatar },
    assessment: {
      id, title, markScheme, markSchemeFileUrls, questionPaperFileUrls,
      totalMarks, showAIFeedback, studentsSeeMarkScheme, studentsSeeQP,
      class: { id, name }
    }
  }
}
```
Note: `extractedText` is only returned for teachers (hidden from students). `imageUrls` is a JSON-encoded string array.

### DELETE /api/submissions/[submissionId]
Student deletes their own submission, or teacher deletes any.
```
Response: { message: string }
```

### PATCH /api/submissions/[submissionId]
Teacher adjusts score after grading.
```
Body (JSON): { score: number, reason: string }
Response: { submission: { ... full submission with student and assessment } }
```

### POST /api/submissions/[submissionId]/grade
Manual grading by teacher (for PENDING submissions).
```
Body (JSON): { score: number, feedback?: string }
Response: { submission: { ... full submission with student and assessment } }
```

### POST /api/submissions/[submissionId]/ai-grade
Trigger AI (re)grading. Teacher only. No body needed.
```
Response: { message: string, submission: { id, status: "PROCESSING" } }
```

### POST /api/submissions/[submissionId]/report
Student reports a grading issue.
```
Body (JSON): { reason: string }
Response: { success: true }
```

### DELETE /api/submissions/[submissionId]/report
Teacher dismisses a report.
```
Response: { success: true }
```

### GET /api/assessments/[assessmentId]/my-submission
Get the current student's own submission for an assessment.
```
Response: {
  submission: {
    id, score, maxScore, feedback, status, gradingProgress,
    imageUrls, createdAt, gradedAt,
    originalScore, adjustedBy, adjustmentReason,
    reportReason, reportedAt,
    assessment: {
      id, title, markScheme (if studentsSeeMarkScheme), totalMarks,
      showAIFeedback, studentsSeeMarkScheme, studentsSeeQP,
      markSchemeFileUrls, questionPaperFileUrls,
      class: { id, name }
    }
  }
}
```
Returns `{ submission: null }` if no submission exists.

---

## To Review (Teacher)

### GET /api/to-review
Submissions that need teacher attention (PENDING, PROCESSING, or reported).
```
Query: ?classId=optional
Response: {
  submissions: [{
    id, status, imageUrls, score, maxScore, feedback,
    gradingProgress, createdAt, gradedAt,
    reportReason, reportedAt,
    student: { id, name },
    assessment: {
      id, title, markScheme, feedbackLanguage,
      class: { id, name, headerColor }
    }
  }]
}
```

### GET /api/submissions/recent
Teacher's recent submissions across all classes.
```
Query: ?limit=5
Response: {
  submissions: [{
    id, status, score, maxScore, createdAt, gradedAt,
    student: { name },
    assessment: { title, class: { name } }
  }]
}
```

### POST /api/to-review/bulk-grade
Queue multiple submissions for AI grading. Teacher only.
```
Body (JSON): { submissionIds: string[] }
Response: { success: true, count: number, message: string }
```

---

## Calendar & Todo

### GET /api/calendar/week
Assessments grouped by day for a given week.
```
Query: ?start=2026-02-16 (ISO date, Monday of week; defaults to current week)
Response: {
  startDate: string,
  endDate: string,
  weekDays: {
    "2026-02-16": [{ id, title, dueDate, totalMarks, status, class: { id, name, headerColor }, ... }],
    "2026-02-17": [...],
    ...
  },
  totalAssessments: number
}
```

### GET /api/todo
Assessments filtered by status and grouped by time period.
```
Query: ?status=assigned|missing|done&classId=optional
Response: {
  grouped: {
    noDueDate: [assessment, ...],
    overdue: [...],
    today: [...],
    tomorrow: [...],
    thisWeek: [...],
    nextWeek: [...],
    later: [...]
  },
  total: number,
  classIds: string[]
}
```
Each assessment includes: `{ id, title, dueDate, totalMarks, createdAt, class: { id, name, headerColor, teacherId }, submissionStatus, submission, isTeacher }`

---

## Stream (Class Feed)

### GET /api/classes/[classId]/stream
```
Response: {
  posts: [{
    id, content, attachments (JSON string | null), pinned, createdAt,
    author: { id, name, avatar },
    comments: [{ id, content, createdAt, author: { id, name, avatar } }],
    _count: { comments: number }
  }]
}
```
Includes virtual "assessment created" posts mixed in with real posts, sorted by pinned first then date.

### POST /api/classes/[classId]/stream
Create a post. Multipart form.
```
Fields:
  content?: string
  attachments?: File[]
Response (201): { post: { id, content, attachments, classId, authorId, author, comments, _count } }
```

### POST /api/stream/[postId]/comments
```
Body (JSON): { content: string }
Response (201): { comment: { id, content, postId, authorId, createdAt, author: { id, name, avatar } } }
```

### PATCH /api/stream/[postId]
Pin/unpin (teacher) or edit content (author).
```
Body (JSON): { content?: string, pinned?: boolean }
Response: { post: { ... } }
```

### DELETE /api/stream/[postId]
Teacher or original author can delete.
```
Response: { success: true }
```

---

## AI Chat

### POST /api/submissions/[submissionId]/chat
Context-aware AI tutor for a specific submission.
```
Body (JSON): { message: string, history?: [{ role: "user"|"assistant", content: string }] }
Response: { reply: string }
```

### POST /api/ai/chat
General AI chat assistant. Costs 1 credit per message.
```
Body (JSON): {
  message: string,
  history?: [{ role: "user"|"assistant", content: string }],
  context?: { pathname: string }
}
Response: { reply: string }
```

---

## Translate

### POST /api/translate
Translate text using AI.
```
Body (JSON): { text: string, targetLanguage?: string }
Response: { translatedText: string }
```
Max 10,000 characters. Default target language is "uzbek".

---

## File Access

### GET /api/uploads/[...path]
Serves uploaded files (images, PDFs, docs). Auth required. Returns file with proper MIME type and `Content-Disposition` header.

Access is permission-checked: the file must belong to a submission, assessment, or stream post that the current user has access to. Mark scheme and question paper visibility respects assessment settings for students.

---

## Dashboard Stats (Teacher)

### GET /api/dashboard/stats
```
Response: {
  totalClasses: number,
  totalStudents: number,
  totalAssessments: number,
  pendingSubmissions: number
}
```

---

## Subscription & Payments

### GET /api/subscription
```
Response: {
  subscription: "FREE" | "PLUS" | "PRO" | "MAX",
  credits: number,
  subscriptionExpiresAt: string | null,
  pendingRequest: { id: string } | null,
  planDetails: { name, credits, price, description, features }
}
```

### POST /api/subscription
Request a manual upgrade (admin approval).
```
Body (JSON): { plan: "PLUS" | "PRO" | "MAX" }
Response: { success: true, message: string, request: { ... } }
```

### POST /api/orders/create
Create a Click payment order for subscription purchase.
```
Body (JSON): { plan: "PLUS" | "PRO", billing: "monthly" | "annual" }
Response: { orderId: string, payUrl: string }
```
The `payUrl` should be opened in a WebView or external browser for payment.

### GET /api/orders/[orderId]/status
Check payment/order status.
```
Response: { status: "PENDING" | "PREPARING" | "COMPLETED" | "CANCELLED", plan: string }
```
Poll this endpoint after payment redirect to confirm completion.

---

## Enums

```
SubscriptionTier: FREE, PLUS, PRO, MAX
AssessmentStatus: DRAFT, ACTIVE, CLOSED
SubmissionStatus: PENDING, PROCESSING, GRADED, ERROR
OrderStatus: PENDING, PREPARING, COMPLETED, CANCELLED
```

---

## Notes for Mobile Development

### Authentication
- Auth is cookie-based (NextAuth JWT). Store and send cookies with every request.
- Android: Use OkHttp `CookieJar` or `PersistentCookieJar` for cookie persistence.
- iOS: Use `URLSession` with `HTTPCookieStorage.shared` for automatic cookie handling.
- The session cookie name is `next-auth.session-token` (or `__Secure-next-auth.session-token` over HTTPS).
- Session expires after 30 days.

### Data Formats
- All dates are ISO 8601 strings.
- `imageUrls`, `markSchemeFileUrls`, `questionPaperFileUrls`, and `attachments` are JSON-encoded string arrays: `'["url1","url2"]'`. Parse them with `JSON.parse()`.
- File uploads use `multipart/form-data`.
- All other request bodies are `application/json`.

### Image URLs
- Image URLs returned by the API are relative paths like `/uploads/filename.jpg`.
- Construct full URLs by prepending the base URL: `https://teztekshir.uz/uploads/filename.jpg`.
- Accessing files via `/api/uploads/...` requires auth and performs permission checks.
- Accessing files directly via `/uploads/...` is public (for serving uploaded images).

### Grading Flow (Polling)
1. Upload submission via `POST /api/submissions/upload` -> get `submission.id`
2. Poll `GET /api/submissions/[submissionId]` every 2-3 seconds
3. Check `submission.status` and `submission.gradingProgress` (0-100)
4. Status flow: `PENDING` -> `PROCESSING` -> `GRADED` (or `ERROR`)
5. Stop polling when status is `GRADED` or `ERROR`

### Error Handling
- `401` - Unauthorized (session expired, need to re-login)
- `400` - Bad request (validation error)
- `402` - Payment required (insufficient credits)
- `403` - Forbidden (permission denied)
- `404` - Not found
- `500` - Server error

### Push Notifications (Future)
- Register device tokens via `POST /api/user/device-token` after login.
- Remove tokens via `DELETE /api/user/device-token` on logout.
- Server-side push delivery (FCM/APNs) is not yet implemented - token storage is ready.

### Offline Considerations
- Cache class lists, assessment details, and submission results locally.
- Queue submission uploads for retry if network is unavailable.
- Use `gradingProgress` field to show a progress indicator during AI grading.
