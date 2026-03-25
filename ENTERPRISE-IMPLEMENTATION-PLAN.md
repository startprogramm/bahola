# Bahola Enterprise School Management — Implementation Plan

**Date:** February 19, 2026 (overnight build)
**Deadline:** February 20, 2026 — 11:00 AM Tashkent
**Purpose:** Enable school-wide deployment for 10-school government pilot

---

## 🎯 Executive Summary

Transform Bahola from a class-based system (like Google Classroom) to a school-based enterprise system where:
- Schools have unique codes
- Users join schools via code and auto-enroll in all classes
- Directors have a dashboard to monitor entire school
- Teachers create classes under their school
- Students join once, access all relevant classes

---

## 📊 Current vs Target Architecture

### Current (Class-Based)
```
User → joins → Class (via class code)
User → joins → Another Class (via different code)
(No connection between classes)
```

### Target (School-Based)
```
School (code: "GULISTAN-11")
    ├── Director (admin view of everything)
    ├── Teachers
    │   ├── Teacher A → Class 1, Class 2
    │   └── Teacher B → Class 3, Class 4
    └── Students (auto-enrolled to all classes)
```

---

## 🗄️ Database Schema Changes

### New Table: `schools`

```sql
CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,  -- e.g., "GULISTAN-11", "SCHOOL-001"
    director_id UUID REFERENCES users(id),
    address VARCHAR(500),
    phone VARCHAR(50),
    email VARCHAR(255),
    logo_url VARCHAR(500),
    settings JSONB DEFAULT '{}',  -- For future extensibility
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast code lookup
CREATE UNIQUE INDEX idx_schools_code ON schools(code);
CREATE INDEX idx_schools_director ON schools(director_id);
```

### Modify Table: `users`

```sql
ALTER TABLE users ADD COLUMN school_id UUID REFERENCES schools(id);
ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'student';
-- role: 'student', 'teacher', 'director', 'admin'

CREATE INDEX idx_users_school ON users(school_id);
CREATE INDEX idx_users_role ON users(role);
```

### Modify Table: `classes`

```sql
ALTER TABLE classes ADD COLUMN school_id UUID REFERENCES schools(id);

CREATE INDEX idx_classes_school ON classes(school_id);
```

### New Table: `school_memberships` (for tracking join history)

```sql
CREATE TABLE school_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    school_id UUID REFERENCES schools(id) NOT NULL,
    role VARCHAR(20) NOT NULL,  -- role at time of joining
    joined_at TIMESTAMP DEFAULT NOW(),
    invited_by UUID REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'active',  -- 'active', 'inactive', 'removed'
    UNIQUE(user_id, school_id)
);

CREATE INDEX idx_memberships_school ON school_memberships(school_id);
CREATE INDEX idx_memberships_user ON school_memberships(user_id);
```

---

## 🔌 API Endpoints

### School Management

#### `POST /api/schools`
Create a new school (directors only)

**Request:**
```json
{
    "name": "Guliston 11-maktab",
    "address": "Gulistan, Sirdaryo",
    "phone": "+998901234567",
    "email": "school11@edu.uz"
}
```

**Response:**
```json
{
    "id": "uuid",
    "name": "Guliston 11-maktab",
    "code": "GULISTON-11",  // Auto-generated
    "director_id": "current_user_id",
    "created_at": "2026-02-19T21:00:00Z"
}
```

**Logic:**
1. Generate unique school code (format: CITY-NUMBER or custom)
2. Set current user as director
3. Update user's role to 'director'
4. Update user's school_id

---

#### `GET /api/schools/:id`
Get school details

**Response:**
```json
{
    "id": "uuid",
    "name": "Guliston 11-maktab",
    "code": "GULISTON-11",
    "director": {
        "id": "uuid",
        "name": "Director Name",
        "email": "director@school.uz"
    },
    "stats": {
        "teacher_count": 25,
        "student_count": 450,
        "class_count": 30,
        "active_assignments": 12
    },
    "created_at": "2026-02-19T21:00:00Z"
}
```

---

#### `GET /api/schools/:id/dashboard`
Director dashboard data

**Response:**
```json
{
    "school": { /* school details */ },
    "classes": [
        {
            "id": "uuid",
            "name": "10-A Mathematics",
            "teacher": { "id": "uuid", "name": "Teacher Name" },
            "student_count": 28,
            "assignment_count": 5,
            "avg_grade": 78.5,
            "pending_submissions": 12
        }
    ],
    "recent_activity": [
        {
            "type": "submission",
            "class": "10-A Mathematics",
            "student": "Student Name",
            "assignment": "Homework 5",
            "timestamp": "2026-02-19T20:30:00Z"
        }
    ],
    "stats": {
        "total_submissions_today": 156,
        "avg_school_grade": 75.2,
        "most_active_class": "10-B Physics",
        "teachers_online": 8
    }
}
```

---

#### `POST /api/schools/join`
Join a school with code

**Request:**
```json
{
    "code": "GULISTON-11",
    "role": "teacher"  // or "student"
}
```

**Response:**
```json
{
    "success": true,
    "school": {
        "id": "uuid",
        "name": "Guliston 11-maktab"
    },
    "enrolled_classes": [
        { "id": "uuid", "name": "10-A Mathematics" },
        { "id": "uuid", "name": "10-B Physics" }
    ],
    "message": "Successfully joined school and enrolled in 15 classes"
}
```

**Logic:**
1. Validate school code exists
2. Update user's school_id and role
3. Create school_membership record
4. **If student:** Auto-enroll in ALL classes of the school
5. **If teacher:** Just join school, create classes manually

---

#### `GET /api/schools/:id/members`
List all school members

**Query params:** `?role=teacher&page=1&limit=20`

**Response:**
```json
{
    "members": [
        {
            "id": "uuid",
            "name": "Teacher Name",
            "email": "teacher@email.com",
            "role": "teacher",
            "joined_at": "2026-02-19T21:00:00Z",
            "classes": ["10-A Math", "10-B Math"]
        }
    ],
    "pagination": {
        "page": 1,
        "limit": 20,
        "total": 475
    }
}
```

---

#### `GET /api/schools/:id/classes`
List all classes in school

**Response:**
```json
{
    "classes": [
        {
            "id": "uuid",
            "name": "10-A Mathematics",
            "teacher": { "id": "uuid", "name": "Teacher Name" },
            "student_count": 28,
            "created_at": "2026-02-19T21:00:00Z"
        }
    ]
}
```

---

#### `GET /api/schools/:id/grades`
All grades across school (director view)

**Query params:** `?class_id=uuid&student_id=uuid&from_date=2026-02-01`

**Response:**
```json
{
    "grades": [
        {
            "student": { "id": "uuid", "name": "Student Name" },
            "class": { "id": "uuid", "name": "10-A Math" },
            "assignment": { "id": "uuid", "title": "Homework 5" },
            "grade": 85,
            "graded_at": "2026-02-19T20:00:00Z",
            "graded_by": "AI"
        }
    ],
    "summary": {
        "avg_grade": 76.5,
        "total_graded": 1250,
        "grade_distribution": {
            "A": 150,
            "B": 380,
            "C": 520,
            "D": 150,
            "F": 50
        }
    }
}
```

---

### Modified Existing Endpoints

#### `POST /api/auth/register`
Add school code to registration

**Request:**
```json
{
    "name": "User Name",
    "email": "user@email.com",
    "password": "password123",
    "school_code": "GULISTON-11",  // NEW - optional
    "role": "student"  // NEW - if school_code provided
}
```

**Logic:**
1. Create user as normal
2. If school_code provided:
   - Validate code
   - Set user's school_id and role
   - If student, auto-enroll in all school classes

---

#### `POST /api/classes`
Link class to school

**Request:**
```json
{
    "name": "10-A Mathematics",
    "description": "Grade 10 Section A",
    "school_id": "uuid"  // NEW - auto-filled if teacher has school
}
```

**Logic:**
1. Create class as normal
2. Set school_id (from teacher's school if not provided)
3. Auto-enroll all students of the school into this class

---

## 🖥️ UI Components

### 1. School Registration Flow

**Route:** `/school/create`

**Components:**
- Form: school name, address, phone, email
- Auto-generate code preview
- Submit → become director

**Wireframe:**
```
┌─────────────────────────────────────┐
│  Create Your School                 │
├─────────────────────────────────────┤
│  School Name: [________________]    │
│  Address:     [________________]    │
│  Phone:       [________________]    │
│  Email:       [________________]    │
│                                     │
│  Your School Code: GULISTON-11      │
│  (Share this with teachers/students)│
│                                     │
│  [Create School]                    │
└─────────────────────────────────────┘
```

---

### 2. Join School Flow

**Route:** `/school/join`

**Components:**
- Input: school code
- Role selector: Teacher / Student
- Preview: school name after code validation
- Submit → join and auto-enroll

**Wireframe:**
```
┌─────────────────────────────────────┐
│  Join Your School                   │
├─────────────────────────────────────┤
│  School Code: [GULISTON-11    ]     │
│                                     │
│  ✓ School Found: Guliston 11-maktab │
│                                     │
│  I am a:  ○ Teacher  ● Student      │
│                                     │
│  [Join School]                      │
│                                     │
│  You'll be enrolled in 15 classes   │
└─────────────────────────────────────┘
```

---

### 3. Director Dashboard

**Route:** `/school/dashboard`

**Components:**
- School header (name, code, copy button)
- Stats cards (teachers, students, classes, submissions)
- Classes table with grades overview
- Recent activity feed
- Quick actions (invite teachers, view reports)

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────┐
│  🏫 Guliston 11-maktab                    Code: GULISTON-11 │
│                                           [Copy Code]       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ 25      │ │ 450     │ │ 30      │ │ 78.5%   │           │
│  │ Teachers│ │ Students│ │ Classes │ │ Avg Grade│          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────────────────┤
│  Classes                                    [+ New Class]   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ Class          │ Teacher    │ Students │ Avg Grade   │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │ 10-A Math      │ A. Karimov │ 28       │ 82%         │ │
│  │ 10-B Physics   │ B. Yusupov │ 30       │ 75%         │ │
│  │ 11-A Chemistry │ C. Alimova │ 25       │ 79%         │ │
│  └───────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Recent Activity                                            │
│  • Student X submitted Homework 5 in 10-A Math (2 min ago)  │
│  • Teacher Y graded 15 submissions in 10-B Physics (5m ago) │
│  • New student joined: Student Z (10 min ago)               │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. Modified Registration Page

**Route:** `/register`

**Add:**
- "Join a School?" toggle/section
- School code input field
- Role selector (if joining school)

**Wireframe:**
```
┌─────────────────────────────────────┐
│  Create Account                     │
├─────────────────────────────────────┤
│  Name:     [________________]       │
│  Email:    [________________]       │
│  Password: [________________]       │
│                                     │
│  ☑ I have a school code            │
│  ┌─────────────────────────────┐   │
│  │ School Code: [GULISTON-11]  │   │
│  │ I am a: ○ Teacher ● Student │   │
│  └─────────────────────────────┘   │
│                                     │
│  [Create Account]                   │
└─────────────────────────────────────┘
```

---

### 5. School Members Page

**Route:** `/school/members`

**Components:**
- Tabs: All / Teachers / Students
- Search bar
- Member list with role badges
- Invite button

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────┐
│  School Members                              [Invite +]     │
├─────────────────────────────────────────────────────────────┤
│  [All] [Teachers (25)] [Students (450)]                     │
│  Search: [____________________]                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 👤 Abdulaziz Karimov        [Teacher]   Joined Feb 1 │   │
│  │    Classes: 10-A Math, 10-B Math                     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 👤 Bobur Yusupov            [Teacher]   Joined Feb 2 │   │
│  │    Classes: 10-A Physics, 11-A Physics               │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 👤 Student Name             [Student]   Joined Feb 5 │   │
│  │    Enrolled in: 15 classes                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

### 6. School Grades Overview

**Route:** `/school/grades`

**Components:**
- Filters: by class, by date range, by student
- Grades table
- Export button (future)

---

## 🔄 Auto-Enrollment Logic

### When Student Joins School:

```javascript
async function enrollStudentInSchool(userId, schoolId) {
    // 1. Update user's school
    await db.users.update({
        where: { id: userId },
        data: { school_id: schoolId, role: 'student' }
    });
    
    // 2. Get all classes in school
    const classes = await db.classes.findMany({
        where: { school_id: schoolId }
    });
    
    // 3. Enroll student in all classes
    const enrollments = classes.map(cls => ({
        user_id: userId,
        class_id: cls.id,
        enrolled_at: new Date(),
        enrolled_via: 'school_code'
    }));
    
    await db.class_enrollments.createMany({ data: enrollments });
    
    // 4. Create membership record
    await db.school_memberships.create({
        data: {
            user_id: userId,
            school_id: schoolId,
            role: 'student',
            status: 'active'
        }
    });
    
    return { enrolled_classes: classes.length };
}
```

### When Teacher Creates New Class:

```javascript
async function createClassInSchool(teacherId, classData) {
    // 1. Get teacher's school
    const teacher = await db.users.findUnique({
        where: { id: teacherId },
        select: { school_id: true }
    });
    
    // 2. Create class linked to school
    const newClass = await db.classes.create({
        data: {
            ...classData,
            school_id: teacher.school_id,
            teacher_id: teacherId
        }
    });
    
    // 3. Auto-enroll all school students
    const students = await db.users.findMany({
        where: { school_id: teacher.school_id, role: 'student' }
    });
    
    const enrollments = students.map(student => ({
        user_id: student.id,
        class_id: newClass.id,
        enrolled_at: new Date(),
        enrolled_via: 'auto_school'
    }));
    
    await db.class_enrollments.createMany({ data: enrollments });
    
    return newClass;
}
```

---

## 🔐 Permissions Matrix

| Action | Student | Teacher | Director | Admin |
|--------|---------|---------|----------|-------|
| View own classes | ✅ | ✅ | ✅ | ✅ |
| View school classes | ❌ | Own only | ✅ All | ✅ All |
| Create class | ❌ | ✅ | ✅ | ✅ |
| View school members | ❌ | ❌ | ✅ | ✅ |
| View all grades | ❌ | Own classes | ✅ All | ✅ All |
| Manage school settings | ❌ | ❌ | ✅ | ✅ |
| Remove members | ❌ | ❌ | ✅ | ✅ |
| Create school | ❌ | ✅* | ✅ | ✅ |

*Teacher can create school and become director

---

## 📱 Navigation Updates

### Add to Sidebar (for Directors):
```
🏫 School Dashboard
👥 Members
📊 School Grades
⚙️ School Settings
```

### Add to Header:
```
School: Guliston 11-maktab | Code: GULISTON-11 [Copy]
```

---

## ✅ Implementation Checklist

### Phase 1: Database (30 min)
- [ ] Create `schools` table migration
- [ ] Add `school_id` to `users` table
- [ ] Add `role` to `users` table
- [ ] Add `school_id` to `classes` table
- [ ] Create `school_memberships` table
- [ ] Run migrations

### Phase 2: School CRUD (1.5 hrs)
- [ ] `POST /api/schools` - Create school
- [ ] `GET /api/schools/:id` - Get school
- [ ] `POST /api/schools/join` - Join with code
- [ ] School code generation utility

### Phase 3: Auto-Enrollment (2 hrs)
- [ ] Student joins school → enroll in all classes
- [ ] New class created → enroll all school students
- [ ] Update registration flow with school code

### Phase 4: Director Dashboard (3 hrs)
- [ ] Dashboard API endpoint
- [ ] Dashboard UI page
- [ ] Classes list with stats
- [ ] Members list
- [ ] Basic activity feed

### Phase 5: UI Updates (1.5 hrs)
- [ ] School creation page
- [ ] Join school page
- [ ] Update registration page
- [ ] Sidebar navigation for directors

### Phase 6: Testing (1 hr)
- [ ] Create test school
- [ ] Test teacher join flow
- [ ] Test student join + auto-enroll
- [ ] Test director dashboard
- [ ] Test new class → auto-enroll

---

## 🚀 Quick Start Commands

```bash
# 1. Create migration
npx prisma migrate dev --name add_schools

# 2. Generate client
npx prisma generate

# 3. Seed test school (create a seed script)
npx prisma db seed

# 4. Start dev server
npm run dev
```

---

## 📋 Test Data for Tomorrow

Create these 10 schools before training:

| # | School Name | Code |
|---|-------------|------|
| 1 | Guliston 1-maktab | GULISTON-01 |
| 2 | Guliston 2-maktab | GULISTON-02 |
| 3 | Guliston 3-maktab | GULISTON-03 |
| 4 | Guliston 4-maktab | GULISTON-04 |
| 5 | Guliston 5-maktab | GULISTON-05 |
| 6 | Guliston 6-maktab | GULISTON-06 |
| 7 | Guliston 7-maktab | GULISTON-07 |
| 8 | Guliston 8-maktab | GULISTON-08 |
| 9 | Guliston 9-maktab | GULISTON-09 |
| 10 | Guliston 10-maktab | GULISTON-10 |

---

## ⚠️ Known Limitations (V1)

1. **Single director per school** - multi-director support later
2. **No partial enrollment** - students join ALL classes (no grade filtering yet)
3. **No class categories** - all classes are equal
4. **No school settings** - minimal config
5. **Basic permissions** - role-based, not granular

These are acceptable for pilot. Will enhance post-launch.

---

## 🎯 Success Criteria for Tomorrow

1. ✅ Can create a school and get a code
2. ✅ Teachers can join with code
3. ✅ Students can join and auto-enroll in all classes
4. ✅ Director can see all classes and grades
5. ✅ 10 schools created and ready for training

---

**LET'S BUILD. 🚀**
