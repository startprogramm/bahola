---
title: "How AI Grading Works: From Photo to Feedback in Seconds"
date: "2026-03-17"
author: "TezTekshir Team"
language: "en"
slug: "how-ai-grading-works"
excerpt: "Curious about what happens when a student submits their work? Here's a simple explanation of how TezTekshir grades — from photo upload to detailed feedback."
coverImage: "/blog/cover-how-ai-grading-works.png"
theme: "indigo"
---

# From Photo to Feedback in Seconds

A student uploads a photo of their handwritten work. Three minutes later, they have a score and detailed feedback. Here's exactly what TezTekshir does in between.

## Step 1: Upload and Check

The student takes photos of their work — one page or several. TezTekshir accepts PNG, JPG, and WebP files. You can drag files in, paste from the clipboard, or click to upload.

Before grading starts, a quick AI scan checks each image. It makes sure the photo shows real work — not a blank page, a blurry shot, or an accident.

## Step 2: Reading the Handwriting

This is where the real work happens. TezTekshir sends each photo to **Google Gemini**, an AI that can "read" images.

Gemini reads the student's handwriting and turns it into text. It handles:

- Messy or cursive handwriting
- Math problems and equations
- Mixed languages (Uzbek and Russian in the same answer)
- Tables and labeled drawings

The result is a full text version of everything the student wrote.

## Step 3: Loading the Answer Key

TezTekshir needs to know what a correct answer looks like. When a teacher uploads an answer key — PDF, Word, Excel, or image — TezTekshir reads that too and saves it.

This saved answer key is used for every student in that test. It only needs to be read once.

## Step 4: Grading

Now the main step. TezTekshir sends both texts — the student's answers and the answer key — to **Gemini**. It also sends the question list and how many marks each question is worth.

Gemini acts like an experienced teacher marking papers. It:
- Matches each student answer to the right question
- Checks if the key points are covered
- Gives marks based on how correct and complete the answer is
- Writes feedback for each question — in Uzbek, Russian, or English

Gemini understands meaning, not just words. If a student explains the right idea in their own way, they still get full credit.

## Step 5: Results

The graded result is saved and shown to both the teacher and student right away:

- **Score per question** — how many marks earned and lost
- **Written feedback** — what was good, what was missing, and how to do better
- **Total score** — like 18 out of 25

Teachers see all submissions in one gradebook view. Students see their results the moment grading is done.

## Teachers Can Always Change the Score

AI grading works very well for tests with clear right or wrong answers. For open or creative questions, it gives a solid starting point.

Teachers can **change any question's score** — if the AI missed something, or the student deserves partial credit. Every change is saved so it's clear what was adjusted and why.

## Quick Technical Summary

| What it does | How it does it |
|---|---|
| Reads handwriting in photos | Google Gemini (reads images) |
| Grades answers | Gemini 3 Flash Preview |
| Checks if photos are valid | Gemini 2.0 Flash Lite |
| Processes image files | Sharp (server-side) |
| Handles multiple students | Grades 6 papers at a time |

The system can handle 30 students submitting at once. All results come back in 1–2 minutes.

---

*Want to see it in action? [Create a free account](/register) and try your first AI-graded test today.*
