import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const CLASS_ID = "cml41hthq0003hw2kodv5ztmo";
const TEACHER_ID = "cmkz8mf8y00006txani1qy4kv";

const ASSESSMENTS_WITH_MARKS = [
  { id: "cml94y3pg00016tvq2g1rb89i", title: "cs", totalMarks: 100 },
  { id: "cml9b12n600016te2nv1d15c0", title: "from tg", totalMarks: 100 },
  { id: "cmlafu0es00016t1lid4ta0w3", title: "English", totalMarks: 100 },
  { id: "cmlaq9gzp00016tjlotvd5zz6", title: "CS paper 3 (mixed)", totalMarks: 100 },
  { id: "cmlotl1b10005jxpb0y900rhk", title: "test", totalMarks: 100 },
];

const ASSESSMENTS_NO_MARKS = [
  { id: "cml4m4zqe00086tr5m2oh36ij", title: "Just for fun" },
  { id: "cml54ls8900016twwafi39bit", title: "blooket test" },
  { id: "cml671hlk00556thgkhaicvb2", title: "Ona tili" },
  { id: "cml6frlzp00076tau8edmmquq", title: "8-green rus tili 3-chorak" },
];

const UZBEK_NAMES = [
  "Aziz Karimov", "Dilshod Rakhimov", "Jasur Toshmatov", "Sardor Mirzayev",
  "Bobur Aliyev", "Otabek Nazarov", "Sherzod Umarov", "Islom Kholmatov",
  "Asilbek Tursunov", "Bekzod Yusupov", "Nodir Abdullayev", "Doniyor Saidov",
  "Ulugbek Ergashev", "Farrukh Ismoilov", "Jamshid Baxtiyorov",
  "Madina Rashidova", "Nilufar Karimova", "Gulnora Ahmedova",
  "Shahlo Mirzayeva", "Dilorom Toshpulatova", "Zarina Umarova",
  "Kamola Nazarova", "Sevara Rakhmatova", "Mohira Khamidova",
  "Nargiza Yuldasheva", "Malika Abdullaeva", "Fotima Saidova",
  "Sabina Ergasheva", "Iroda Ismoilova", "Laylo Baxtiyorova",
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysBack: number): Date {
  const now = Date.now();
  const past = now - daysBack * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

// Bell-curve-ish distribution
function realisticScore(min: number, max: number): number {
  const r1 = Math.random();
  const r2 = Math.random();
  const avg = (r1 + r2) / 2;
  return Math.round(min + avg * (max - min));
}

async function main() {
  console.log("Starting C++ class seed...");

  const hashedPassword = await bcrypt.hash("Student2025!", 10);
  console.log("Password hashed.");

  await prisma.$transaction(
    async (tx) => {
      // 1. Create 30 dummy students
      console.log("Creating 30 dummy students...");
      const studentIds: string[] = [];

      for (let i = 1; i <= 30; i++) {
        const email = `dummy-student-${i}@bahola.uz`;
        const user = await tx.user.upsert({
          where: { email },
          update: {},
          create: {
            name: UZBEK_NAMES[i - 1],
            email,
            password: hashedPassword,
            role: "STUDENT",
            isPlaceholder: false,
          },
          select: { id: true },
        });
        studentIds.push(user.id);
      }
      console.log(`Created/found ${studentIds.length} students.`);

      // 2. Enroll all 30 students
      console.log("Enrolling students in class...");
      await tx.enrollment.createMany({
        data: studentIds.map((studentId) => ({
          studentId,
          classId: CLASS_ID,
        })),
        skipDuplicates: true,
      });
      console.log("Enrollments done.");

      // 3. Create graded submissions for all 9 assessments
      console.log("Creating graded submissions...");
      const submissionData: any[] = [];

      for (const studentId of studentIds) {
        for (const assessment of ASSESSMENTS_WITH_MARKS) {
          submissionData.push({
            studentId,
            assessmentId: assessment.id,
            imageUrls: "[]",
            extractedText: "Dummy submission text",
            score: realisticScore(40, 98),
            maxScore: 100,
            feedback: "Good work! Keep practicing.",
            status: "GRADED" as const,
            gradedAt: randomDate(90),
          });
        }
        for (const assessment of ASSESSMENTS_NO_MARKS) {
          submissionData.push({
            studentId,
            assessmentId: assessment.id,
            imageUrls: "[]",
            extractedText: "Dummy submission text",
            score: randomInt(5, 25),
            maxScore: 30,
            feedback: "Good work! Keep practicing.",
            status: "GRADED" as const,
            gradedAt: randomDate(90),
          });
        }
      }

      const CHUNK = 50;
      for (let i = 0; i < submissionData.length; i += CHUNK) {
        await tx.submission.createMany({
          data: submissionData.slice(i, i + CHUNK),
          skipDuplicates: true,
        });
      }
      console.log(`Created ${submissionData.length} graded submissions.`);

      // 4. Create stream posts and comments
      console.log("Creating stream posts...");
      const posts = [
        { content: "Welcome to C++ Programming! This semester we'll cover OOP, data structures, and algorithms. Make sure you have your compiler set up (VS Code + g++ recommended).", authorId: TEACHER_ID, pinned: true },
        { content: "Homework reminder: Chapter 5 exercises (arrays and pointers) are due this Friday. Please submit your .cpp files through the platform.", authorId: TEACHER_ID, pinned: false },
        { content: "Great job on the midterm everyone! Average score was 72/100. I'll post detailed feedback soon.", authorId: TEACHER_ID, pinned: false },
        { content: "Can someone explain the difference between pass by value and pass by reference? I keep getting confused in the exercises.", authorId: studentIds[0], pinned: false },
        { content: "For those struggling with linked lists, I found this great tutorial: think of each node like a train car connected to the next one. The pointer is the connector between cars.", authorId: studentIds[5], pinned: false },
        { content: "Lab session tomorrow will be in Room 204. We'll practice implementing binary search trees. Bring your laptops!", authorId: TEACHER_ID, pinned: false },
        { content: "Does anyone have notes from last Wednesday's lecture on templates? I missed the class due to illness.", authorId: studentIds[12], pinned: false },
        { content: "Final exam will cover everything from Week 1 to Week 14. Focus especially on: classes & inheritance, STL containers, file I/O, and recursion. Good luck!", authorId: TEACHER_ID, pinned: true },
        { content: "I wrote a small sorting visualizer in C++ using the console. Happy to share the code if anyone wants to study sorting algorithms visually!", authorId: studentIds[20], pinned: false },
        { content: "Reminder: No class next Monday (holiday). Use the time to review your code and prepare for the final project submission.", authorId: TEACHER_ID, pinned: false },
      ];

      const createdPosts: string[] = [];
      for (let i = 0; i < posts.length; i++) {
        const post = await tx.streamPost.create({
          data: {
            content: posts[i].content,
            authorId: posts[i].authorId,
            classId: CLASS_ID,
            pinned: posts[i].pinned,
            createdAt: randomDate(60),
          },
          select: { id: true },
        });
        createdPosts.push(post.id);
      }
      console.log(`Created ${createdPosts.length} stream posts.`);

      const commentsData = [
        { postId: createdPosts[0], authorId: studentIds[2], content: "Excited to start! Already installed VS Code." },
        { postId: createdPosts[0], authorId: studentIds[8], content: "Can we use CLion instead of VS Code?" },
        { postId: createdPosts[0], authorId: TEACHER_ID, content: "Yes, CLion works great too! Any C++ compiler is fine." },
        { postId: createdPosts[3], authorId: studentIds[5], content: "Pass by value copies the data, pass by reference gives the function direct access to the original variable using &." },
        { postId: createdPosts[3], authorId: TEACHER_ID, content: "Good explanation! Think of it like sending a photocopy (value) vs giving someone your original document (reference)." },
        { postId: createdPosts[6], authorId: studentIds[15], content: "I have the notes, I'll send them to you on Telegram!" },
        { postId: createdPosts[6], authorId: studentIds[12], content: "Thanks a lot! Really appreciate it." },
        { postId: createdPosts[8], authorId: studentIds[3], content: "That sounds awesome! Please share the GitHub link." },
        { postId: createdPosts[8], authorId: studentIds[18], content: "Would love to see it! Did you use ncurses for the visualization?" },
      ];

      for (const c of commentsData) {
        await tx.streamComment.create({
          data: {
            content: c.content,
            authorId: c.authorId,
            postId: c.postId,
            createdAt: randomDate(30),
          },
        });
      }
      console.log(`Created ${commentsData.length} stream comments.`);

      // 5. Create "Final Exam" assessment + 5 PENDING submissions
      console.log("Creating Final Exam assessment with pending submissions...");
      const finalExam = await tx.assessment.create({
        data: {
          title: "Final Exam",
          markScheme: "",
          totalMarks: 100,
          classId: CLASS_ID,
          status: "ACTIVE",
          ocrType: "handwritten",
          feedbackLanguage: "english",
        },
        select: { id: true },
      });

      const pendingStudents = studentIds.slice(0, 5);
      await tx.submission.createMany({
        data: pendingStudents.map((studentId) => ({
          studentId,
          assessmentId: finalExam.id,
          imageUrls: JSON.stringify(["/uploads/dummy-submission.jpg"]),
          status: "PENDING" as const,
          score: undefined,
          feedback: undefined,
        })),
        skipDuplicates: true,
      });
      console.log(`Created "Final Exam" (${finalExam.id}) with 5 pending submissions.`);

      console.log("\nSeed completed successfully!");
    },
    { timeout: 120000 }
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
