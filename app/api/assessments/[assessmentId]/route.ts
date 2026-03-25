import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";
import {
  extractTextFromMultipleMarkSchemeFiles,
  extractTextFromMarkSchemeFile,
  isSupportedMarkSchemeType,
  getExtensionFromMimeType,
} from "@/lib/services/ocr-service";
import { uploadFile, convertDocToPdf } from "@/lib/storage";
import { detectLanguage } from "@/lib/services/grading-service";
import { hasCredits, deductCredit } from "@/lib/credits";
import { invalidateClassDetailCache } from "@/lib/server-cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Fetch basic data and permissions in parallel where possible
    const assessmentBasic = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        classId: true,
        class: {
          select: {
            teacherId: true,
            schoolId: true,
          }
        }
      }
    });

    if (!assessmentBasic) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    const [realEnrollment, isSA] = await Promise.all([
      prisma.enrollment.findUnique({
        where: { studentId_classId: { studentId: session.user.id, classId: assessmentBasic.classId } },
        select: { role: true }
      }),
      isSuperAdmin(session.user.id)
    ]);

    const isClassOwner = assessmentBasic.class.teacherId === session.user.id;
    const isCoTeacher = realEnrollment?.role === "TEACHER";
    const isEnrolledStudent = realEnrollment?.role === "STUDENT";

    // Check director status only if not already authorized
    let isDirector = false;
    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent && !isSA) {
      isDirector = await isDirectorOfSchool(session.user.id, assessmentBasic.class.schoolId);
    }

    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent && !isDirector && !isSA) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isTeacherRoleUser = isEnrolledStudent && session.user.role === "TEACHER";
    const viewerCanViewTeacherData = isClassOwner || isCoTeacher || isDirector || isSA || isTeacherRoleUser;

    const [assessment, enrollments] = await Promise.all([
      prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: {
          class: {
            select: {
              id: true,
              name: true,
              teacherId: true,
              teacher: {
                select: { id: true, name: true }
              }
            }
          },
          submissions: viewerCanViewTeacherData ? {
            include: {
              student: {
                select: { id: true, name: true, email: true }
              }
            },
            orderBy: { createdAt: "desc" }
          } : {
            where: { studentId: session.user.id },
            include: {
              student: {
                select: { id: true, name: true, email: true }
              }
            }
          }
        }
      }),
      viewerCanViewTeacherData ? prisma.enrollment.findMany({
        where: { classId: assessmentBasic.classId, role: "STUDENT" },
        select: {
          id: true,
          joinedAt: true,
          studentId: true,
          student: {
            select: { id: true, name: true, email: true }
          }
        }
      }) : Promise.resolve([])
    ]);

    const viewerRole =
      isClassOwner || isSA
        ? "OWNER"
        : isCoTeacher
          ? "CO_TEACHER"
          : isDirector
            ? "DIRECTOR"
            : "STUDENT";

    return NextResponse.json({
      assessment: {
        ...assessment,
        class: {
          ...assessment?.class,
          enrollments,
        },
        viewerRole,
        viewerCanManage: isClassOwner || isCoTeacher || isSA,
        viewerCanViewTeacherData,
      },
    }, {
      headers: {
        "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("Error fetching assessment:", error);
    return NextResponse.json(
      { error: "Failed to fetch assessment" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        classId: true,
        markScheme: true,
        questionPaper: true,
        questionMarks: true,
        feedbackLanguage: true,
        totalMarks: true,
        customPrompt: true,
        dueDate: true,
        showAIFeedback: true,
        class: {
          select: { teacherId: true },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json(
        { error: "Assessment not found" },
        { status: 404 }
      );
    }

    // Class owner, co-teacher, super admin, or linked director can update assessments
    const isOwner = assessment.class.teacherId === session.user.id;
    if (!isOwner) {
      const [coTeacherEnrollment, isSA] = await Promise.all([
        prisma.enrollment.findUnique({
          where: { studentId_classId: { studentId: session.user.id, classId: assessment.classId } },
          select: { role: true },
        }),
        isSuperAdmin(session.user.id),
      ]);
      if (coTeacherEnrollment?.role !== "TEACHER" && !isSA) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const formData = await request.formData();
    const title = formData.get("title") as string;
    const questionMarksStr = formData.get("questionMarks") as string | null;
    const feedbackLanguageRaw = (formData.get("feedbackLanguage") as string) || "auto";
    const dueDateStr = formData.get("dueDate") as string | null;
    
    // Robust boolean parsing
    const parseBool = (val: any) => val === "true" || val === true;
    
    const enableMarkSchemeOcr = parseBool(formData.get("enableMarkSchemeOcr"));
    const showTextInput = parseBool(formData.get("showTextInput"));
    const showAIFeedback = parseBool(formData.get("showAIFeedback"));
    const studentsCanUpload = parseBool(formData.get("studentsCanUpload"));
    const studentsSeeMarkScheme = parseBool(formData.get("studentsSeeMarkScheme"));
    const studentsSeeQP = parseBool(formData.get("studentsSeeQP"));

    console.log("Updating assessment with toggles:", {
      studentsCanUpload,
      studentsSeeMarkScheme,
      studentsSeeQP
    });

    // Get text inputs (can be used alongside file uploads)
    const markSchemeTextInput = formData.get("markSchemeText") as string | null;
    const assessmentTextInput = formData.get("questionPaperText") as string | null;
    const customPrompt = formData.get("customPrompt") as string | null;

    // Get all mark scheme files (supports multiple files)
    const markSchemeFiles = formData.getAll("markSchemeFiles") as File[];

    // Get assessment/question paper files
    const assessmentFiles = formData.getAll("assessmentFiles") as File[];

    // Get existing URLs to keep
    const keepMarkSchemeUrls = formData.getAll("keepMarkSchemeUrls") as string[];
    const keepAssessmentUrls = formData.getAll("keepAssessmentUrls") as string[];

    // Parse question marks if provided
    let questionMarks: { question: string; marks: number }[] = [];
    if (questionMarksStr) {
      try {
        questionMarks = JSON.parse(questionMarksStr);
      } catch {
        return NextResponse.json(
          { error: "Invalid question marks format" },
          { status: 400 }
        );
      }
    }

    if (!title || title.length < 2) {
      return NextResponse.json(
        { error: "Title must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Mark scheme processing (same as create)
    let savedFileUrls: string[] = [];
    let markSchemeText = "";

    // Handle mark scheme text input first
    if (markSchemeTextInput && markSchemeTextInput.trim()) {
      markSchemeText = markSchemeTextInput.trim();
      console.log("Using text input for mark scheme");
    }

    // Handle mark scheme files (can be combined with text input)
    if (markSchemeFiles && markSchemeFiles.length > 0) {
      const validFiles = markSchemeFiles.filter(f => f.size > 0);

      if (validFiles.length > 0) {
        // Validate all files
        for (const file of validFiles) {
          if (!isSupportedMarkSchemeType(file.type)) {
            return NextResponse.json(
              { error: `Unsupported file type: ${file.type}. Supported: PDF, Word, Excel, and images.` },
              { status: 400 }
            );
          }
        }

        // Upload all files to blob storage
        const fileBuffers: { buffer: Buffer; mimeType: string; filename: string }[] = [];

        for (let i = 0; i < validFiles.length; i++) {
          const file = validFiles[i];
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);

          const extension = getExtensionFromMimeType(file.type) || file.name.substring(file.name.lastIndexOf(".")) || ".bin";
          const filename = `markschemes/${assessment.classId}-${Date.now()}-${i}${extension}`;
          const blobUrl = await uploadFile(buffer, filename, file.type);

          savedFileUrls.push(blobUrl);
          fileBuffers.push({ buffer, mimeType: file.type, filename: file.name });
        }

        // Run OCR and Word-to-PDF conversion in parallel
        const ocrPromise = enableMarkSchemeOcr
          ? (fileBuffers.length === 1
              ? extractTextFromMarkSchemeFile(fileBuffers[0].buffer, fileBuffers[0].mimeType)
              : extractTextFromMultipleMarkSchemeFiles(fileBuffers))
          : Promise.resolve("");

        // Convert any Word docs to PDF for preview (non-blocking)
        const conversionPromises = savedFileUrls.map(async (url) => {
          const lower = url.toLowerCase();
          if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
            const pdfUrl = await convertDocToPdf(url);
            return pdfUrl ? { original: url, pdf: pdfUrl } : null;
          }
          return null;
        });

        const [ocrText, ...conversionResults] = await Promise.all([ocrPromise, ...conversionPromises]);

        if (ocrText) {
          if (markSchemeText) {
            markSchemeText = markSchemeText + "\n\n--- OCR Extracted Content ---\n\n" + ocrText;
          } else {
            markSchemeText = ocrText;
          }
        }

        // Replace Word doc URLs with PDF URLs for preview
        for (const result of conversionResults) {
          if (result) {
            const idx = savedFileUrls.indexOf(result.original);
            if (idx !== -1) {
              savedFileUrls[idx] = result.pdf;
            }
          }
        }

        console.log("Mark scheme processing completed");
      }
    }

    // Handle assessment/question paper
    let assessmentFileUrls: string[] = [];
    let assessmentContent = "";

    // Handle text input first
    if (assessmentTextInput && assessmentTextInput.trim()) {
      assessmentContent = assessmentTextInput.trim();
      console.log("Using text input for assessment");
    }

    // Handle file uploads (can be combined with text input)
    if (assessmentFiles && assessmentFiles.length > 0) {
      const validAssessmentFiles = assessmentFiles.filter(f => f.size > 0);

      for (let i = 0; i < validAssessmentFiles.length; i++) {
        const file = validAssessmentFiles[i];
        if (isSupportedMarkSchemeType(file.type)) {
          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const extension = getExtensionFromMimeType(file.type) || file.name.substring(file.name.lastIndexOf(".")) || ".bin";
          const filename = `assessments/${assessment.classId}-${Date.now()}-${i}${extension}`;
          const blobUrl = await uploadFile(buffer, filename, file.type);
          assessmentFileUrls.push(blobUrl);
        }
      }
      console.log(`Uploaded ${assessmentFileUrls.length} assessment file(s)`);
    }

    // Combine kept URLs with new ones
    const finalMarkSchemeUrls = [...keepMarkSchemeUrls, ...savedFileUrls];
    const finalAssessmentUrls = [...keepAssessmentUrls, ...assessmentFileUrls];

    // Calculate total marks from question marks if provided
    const totalMarksFromQuestions = questionMarks.reduce((sum, q) => sum + q.marks, 0);

    // Update the assessment
    // If AI feedback is being turned ON (was off before), check and deduct credit
    const turningOnAI = showAIFeedback && !assessment.showAIFeedback;
    if (turningOnAI) {
      const teacherHasCredits = await hasCredits(session.user.id, 1);
      if (!teacherHasCredits) {
        return NextResponse.json(
          { error: "Insufficient credits. Enabling AI feedback requires credits. Upgrade your plan or add credits." },
          { status: 402 }
        );
      }
      await deductCredit(session.user.id, `Enabled AI feedback on assessment ${title}`);
    }

    // Determine feedback language: teacher's explicit choice, or auto-detect from content
    const isAuto = !feedbackLanguageRaw || feedbackLanguageRaw === "auto";
    const textForDetection = assessmentContent || markSchemeText || "";
    let resolvedFeedbackLanguage: string;
    if (isAuto && textForDetection.trim().length >= 20) {
      resolvedFeedbackLanguage = await detectLanguage(textForDetection);
    } else if (isAuto) {
      // Fall back to existing saved language
      resolvedFeedbackLanguage = assessment.feedbackLanguage || "english";
    } else {
      resolvedFeedbackLanguage = feedbackLanguageRaw.trim().toLowerCase();
    }

    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        title,
        markScheme: markSchemeText || assessment.markScheme, // Keep old if not provided
        markSchemePdfUrl: finalMarkSchemeUrls.length > 0 ? finalMarkSchemeUrls[0] : null,
        markSchemeFileUrls: finalMarkSchemeUrls.length > 0 ? JSON.stringify(finalMarkSchemeUrls) : null,
        questionPaper: assessmentContent || assessment.questionPaper,
        questionPaperFileUrls: finalAssessmentUrls.length > 0 ? JSON.stringify(finalAssessmentUrls) : null,
        questionMarks: questionMarks.length > 0 ? JSON.stringify(questionMarks) : assessment.questionMarks,
        totalMarks: totalMarksFromQuestions || assessment.totalMarks,
        ocrType: "all",
        feedbackLanguage: resolvedFeedbackLanguage,
        dueDate: dueDateStr ? new Date(dueDateStr) : assessment.dueDate,
        customPrompt: customPrompt?.trim() || assessment.customPrompt,
        showTextInput,
        showAIFeedback,
        studentsCanUpload,
        studentsSeeMarkScheme,
        studentsSeeQP,
      },
    });

    invalidateClassDetailCache(assessment.classId);

    return NextResponse.json(
      { message: "Assessment updated successfully", assessment: updated },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating assessment:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to update assessment: ${errorMessage}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assessmentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { assessmentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        classId: true,
        class: {
          select: { teacherId: true },
        },
      },
    });

    if (!assessment) {
      return NextResponse.json(
        { error: "Assessment not found" },
        { status: 404 }
      );
    }

    // Class owner, co-teacher, super admin, or linked director can delete assessments
    const isDeleteOwner = assessment.class.teacherId === session.user.id;
    if (!isDeleteOwner) {
      const [coTeacherEnrollment, isDeleteSA] = await Promise.all([
        prisma.enrollment.findUnique({
          where: { studentId_classId: { studentId: session.user.id, classId: assessment.classId } },
          select: { role: true },
        }),
        isSuperAdmin(session.user.id),
      ]);
      if (coTeacherEnrollment?.role !== "TEACHER" && !isDeleteSA) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    await prisma.assessment.delete({
      where: { id: assessmentId },
    });

    invalidateClassDetailCache(assessment.classId);

    return NextResponse.json({ message: "Assessment deleted successfully" });
  } catch (error) {
    console.error("Error deleting assessment:", error);
    return NextResponse.json(
      { error: "Failed to delete assessment" },
      { status: 500 }
    );
  }
}
