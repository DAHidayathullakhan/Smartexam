-- =============================================================================
-- SMART EXAM PLATFORM - COMPLETE SUPABASE POSTGRESQL SCHEMA SCRIPT
-- Copy and run this script in your Supabase SQL Editor (SQL Editor -> New Query -> Run)
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. TEACHER PROFILES TABLE
CREATE TABLE IF NOT EXISTS teacher_profiles (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department VARCHAR(100) DEFAULT 'Computer Science',
    designation VARCHAR(100) DEFAULT 'Faculty Member'
);

-- 3. STUDENT PROFILES TABLE
CREATE TABLE IF NOT EXISTS student_profiles (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roll_number VARCHAR(50) UNIQUE NOT NULL,
    department VARCHAR(100) DEFAULT 'Computer Science'
);

-- 4. SUBJECTS TABLE
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    icon VARCHAR(50) DEFAULT 'fa-solid fa-book-open',
    color VARCHAR(30) DEFAULT 'primary',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. UNITS TABLE
CREATE TABLE IF NOT EXISTS units (
    id SERIAL PRIMARY KEY,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    unit_number INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT
);

-- 6. NOTES TABLE
CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    unit_id INT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    topic VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    file_url VARCHAR(300),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. EXAMS TABLE
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_code VARCHAR(20) UNIQUE NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 30,
    total_marks INT NOT NULL DEFAULT 100,
    passing_marks INT NOT NULL DEFAULT 40,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. QUESTIONS TABLE
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    option_a VARCHAR(255) NOT NULL,
    option_b VARCHAR(255) NOT NULL,
    option_c VARCHAR(255) NOT NULL,
    option_d VARCHAR(255) NOT NULL,
    correct_option VARCHAR(5) NOT NULL,
    marks INT NOT NULL DEFAULT 10
);

-- 9. EXAM ATTEMPTS TABLE
CREATE TABLE IF NOT EXISTS exam_attempts (
    id SERIAL PRIMARY KEY,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    score INT DEFAULT 0,
    total_marks INT DEFAULT 0,
    percentage FLOAT DEFAULT 0.0,
    grade VARCHAR(10) DEFAULT 'F',
    status VARCHAR(20) DEFAULT 'in_progress',
    tab_switch_count INT DEFAULT 0
);

-- 10. ANSWERS TABLE
CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    attempt_id INT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id INT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_option VARCHAR(5),
    is_correct BOOLEAN DEFAULT FALSE,
    marks_awarded INT DEFAULT 0
);

-- 11. RESULTS TABLE
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    attempt_id INT UNIQUE NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_id INT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    total_score INT NOT NULL,
    max_score INT NOT NULL,
    percentage FLOAT NOT NULL,
    grade VARCHAR(10) NOT NULL,
    is_passed BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. MONITORING EVENTS TABLE (Proctoring & Tab Switch Logger)
CREATE TABLE IF NOT EXISTS monitoring_events (
    id SERIAL PRIMARY KEY,
    attempt_id INT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    description TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. LIVE CLASSES TABLE
CREATE TABLE IF NOT EXISTS live_classes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_code VARCHAR(30) UNIQUE NOT NULL,
    is_live BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. CLASS PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS class_participants (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    camera_status VARCHAR(10) DEFAULT 'off',
    microphone_status VARCHAR(10) DEFAULT 'off',
    screen_status VARCHAR(10) DEFAULT 'off',
    hand_raised BOOLEAN DEFAULT FALSE,
    is_speaking BOOLEAN DEFAULT FALSE
);

-- 15. CLASS MESSAGES TABLE (Live Chat)
CREATE TABLE IF NOT EXISTS class_messages (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_name VARCHAR(120) NOT NULL,
    sender_role VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. CLASS INTERACTIONS TABLE (Ask to Answer Prompts)
CREATE TABLE IF NOT EXISTS class_interactions (
    id SERIAL PRIMARY KEY,
    class_id INT NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 17. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for maximum query performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_exams_code ON exams(exam_code);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_participants_class ON class_participants(class_id);
CREATE INDEX IF NOT EXISTS idx_messages_class ON class_messages(class_id);

-- Enable Row Level Security (RLS) policies on core tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

-- Allow public read access & authenticated write access
CREATE POLICY "Public Read Users" ON users FOR SELECT USING (true);
CREATE POLICY "Public Read Exams" ON exams FOR SELECT USING (true);
CREATE POLICY "Public Read Attempts" ON exam_attempts FOR SELECT USING (true);
CREATE POLICY "Public Read Results" ON results FOR SELECT USING (true);
