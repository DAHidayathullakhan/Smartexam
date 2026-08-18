import os
import random
import string
import json
import socket
from datetime import datetime, timedelta
from functools import wraps
from flask import (
    Flask, render_template, request, redirect, url_for, flash, session, jsonify, abort
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'edtech_super_secret_production_key_2026_antigravity')

# Supabase PostgreSQL or fallback local database setup
db_url = os.getenv('DATABASE_URL') or os.getenv('SUPABASE_DB_URL')
if db_url and not db_url.startswith('postgresql://postgres:your-db-password'):
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    print("[Database] Connected to Supabase PostgreSQL database!")
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(app.root_path, 'database.db')
    print("[Database] Using SQLite fallback (Configure .env with your Supabase credentials to switch).")

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Supabase SDK Client Initialization
supabase = None
supabase_url = os.getenv('SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_KEY')

if supabase_url and supabase_key and 'your-supabase-project' not in supabase_url:
    try:
        from supabase import create_client
        supabase = create_client(supabase_url, supabase_key)
        print("[Supabase] Supabase Python Client SDK initialized successfully!")
    except Exception as e:
        print(f"[Supabase] Client SDK notice: {e}")


# -----------------------------------------------------------------------------
# DYNAMIC LOCAL NETWORK IP DETECTION
# -----------------------------------------------------------------------------

def get_local_ip():
    """Dynamically detects active local network IPv4 address (e.g. 192.168.1.100)"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

# -----------------------------------------------------------------------------
# DATABASE MODELS
# -----------------------------------------------------------------------------

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='student')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    student_profile = db.relationship('StudentProfile', backref='user', uselist=False, cascade="all, delete-orphan")
    teacher_profile = db.relationship('TeacherProfile', backref='user', uselist=False, cascade="all, delete-orphan")
    attempts = db.relationship('ExamAttempt', backref='student', lazy=True)
    created_exams = db.relationship('Exam', backref='creator', lazy=True)
    notifications = db.relationship('Notification', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class StudentProfile(db.Model):
    __tablename__ = 'students'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    roll_number = db.Column(db.String(50), unique=True, nullable=False)
    grade_level = db.Column(db.String(50), default='B.Tech CSE Year 3')
    department = db.Column(db.String(100), default='Computer Science & Engineering')


class TeacherProfile(db.Model):
    __tablename__ = 'teachers'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    department = db.Column(db.String(100), default='Computer Science')
    designation = db.Column(db.String(100), default='Senior Assistant Professor')


class Subject(db.Model):
    __tablename__ = 'subjects'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(20), unique=True, nullable=False)
    description = db.Column(db.Text, nullable=True)
    icon = db.Column(db.String(50), default='fa-book')
    color = db.Column(db.String(30), default='primary')
    
    units = db.relationship('Unit', backref='subject', lazy=True, cascade="all, delete-orphan")
    exams = db.relationship('Exam', backref='subject', lazy=True)
    online_classes = db.relationship('OnlineClass', backref='subject', lazy=True)


class Unit(db.Model):
    __tablename__ = 'units'
    id = db.Column(db.Integer, primary_key=True)
    subject_id = db.Column(db.Integer, db.ForeignKey('subjects.id'), nullable=False)
    unit_number = db.Column(db.Integer, nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)

    notes = db.relationship('Note', backref='unit', lazy=True, cascade="all, delete-orphan")


class Note(db.Model):
    __tablename__ = 'notes'
    id = db.Column(db.Integer, primary_key=True)
    unit_id = db.Column(db.Integer, db.ForeignKey('units.id'), nullable=False)
    topic = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    author = db.relationship('User', foreign_keys=[author_id])


# -----------------------------------------------------------------------------
# EXAM & QUESTION MODELS
# -----------------------------------------------------------------------------

class Exam(db.Model):
    __tablename__ = 'exams'
    id = db.Column(db.Integer, primary_key=True)
    exam_code = db.Column(db.String(20), unique=True, nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    subject_id = db.Column(db.Integer, db.ForeignKey('subjects.id'), nullable=False)
    description = db.Column(db.Text, nullable=True)
    duration_minutes = db.Column(db.Integer, default=60)
    total_marks = db.Column(db.Integer, default=50)
    passing_marks = db.Column(db.Integer, default=20)
    instructions = db.Column(db.Text, default='1. Mandatory camera monitoring active.\n2. Screen sharing is optional.\n3. Do not switch browser window.')
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(20), default='active')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    questions = db.relationship('Question', backref='exam', lazy=True, cascade="all, delete-orphan")
    attempts = db.relationship('ExamAttempt', backref='exam', lazy=True, cascade="all, delete-orphan")
    warnings = db.relationship('ExamWarning', backref='exam', lazy=True, cascade="all, delete-orphan")


class Question(db.Model):
    __tablename__ = 'questions'
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey('exams.id'), nullable=False)
    question_type = db.Column(db.String(30), default='mcq')
    question_text = db.Column(db.Text, nullable=False)
    option_a = db.Column(db.String(255), nullable=True)
    option_b = db.Column(db.String(255), nullable=True)
    option_c = db.Column(db.String(255), nullable=True)
    option_d = db.Column(db.String(255), nullable=True)
    correct_option = db.Column(db.String(255), nullable=False)
    marks = db.Column(db.Integer, default=1)


class ExamAttempt(db.Model):
    __tablename__ = 'exam_attempts'
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey('exams.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=True)
    score = db.Column(db.Float, default=0.0)
    status = db.Column(db.String(20), default='in_progress')
    tab_switches = db.Column(db.Integer, default=0)
    camera_status = db.Column(db.String(20), default='active')
    screen_status = db.Column(db.String(20), default='off')

    answers = db.relationship('Answer', backref='attempt', lazy=True, cascade="all, delete-orphan")
    monitoring_events = db.relationship('MonitoringEvent', backref='attempt', lazy=True, cascade="all, delete-orphan")


class Answer(db.Model):
    __tablename__ = 'answers'
    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.Integer, db.ForeignKey('exam_attempts.id'), nullable=False)
    question_id = db.Column(db.Integer, db.ForeignKey('questions.id'), nullable=False)
    selected_option = db.Column(db.String(255), nullable=True)
    is_correct = db.Column(db.Boolean, default=False)


class MonitoringEvent(db.Model):
    __tablename__ = 'monitoring_events'
    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.Integer, db.ForeignKey('exam_attempts.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    exam_id = db.Column(db.Integer, db.ForeignKey('exams.id'), nullable=False)
    event_type = db.Column(db.String(50), nullable=False)
    details = db.Column(db.String(255), nullable=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)


class ExamWarning(db.Model):
    __tablename__ = 'warnings'
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey('exams.id'), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='pending')

    student = db.relationship('User', foreign_keys=[student_id])
    teacher = db.relationship('User', foreign_keys=[teacher_id])


# -----------------------------------------------------------------------------
# WEBRTC SIGNALING MODEL
# -----------------------------------------------------------------------------

class WebRTCSignal(db.Model):
    __tablename__ = 'webrtc_signals'
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey('exams.id'), nullable=True)
    class_id = db.Column(db.Integer, db.ForeignKey('online_classes.id'), nullable=True)
    from_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    to_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    stream_type = db.Column(db.String(30), default='camera')
    sdp_offer = db.Column(db.Text, nullable=True)
    sdp_answer = db.Column(db.Text, nullable=True)
    ice_candidates = db.Column(db.Text, default='[]')
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# -----------------------------------------------------------------------------
# LIVE CLASSROOM MODELS & INTERACTIONS
# -----------------------------------------------------------------------------

class OnlineClass(db.Model):
    __tablename__ = 'online_classes'
    id = db.Column(db.Integer, primary_key=True)
    subject_id = db.Column(db.Integer, db.ForeignKey('subjects.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    teacher_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    scheduled_at = db.Column(db.DateTime, nullable=False)
    duration_minutes = db.Column(db.Integer, default=60)
    status = db.Column(db.String(20), default='live')
    meeting_link = db.Column(db.String(255), default='#')

    teacher = db.relationship('User', foreign_keys=[teacher_id])
    participants = db.relationship('ClassParticipant', backref='online_class', lazy=True, cascade="all, delete-orphan")
    chat_messages = db.relationship('ChatMessage', backref='online_class', lazy=True, cascade="all, delete-orphan")
    interactions = db.relationship('ClassInteraction', backref='online_class', lazy=True, cascade="all, delete-orphan")


class ClassParticipant(db.Model):
    __tablename__ = 'class_participants'
    id = db.Column(db.Integer, primary_key=True)
    class_id = db.Column(db.Integer, db.ForeignKey('online_classes.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_activity = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default='active')  # 'active' or 'inactive'
    camera_status = db.Column(db.String(20), default='off')
    microphone_status = db.Column(db.String(20), default='off')
    screen_status = db.Column(db.String(20), default='off')
    hand_raised = db.Column(db.Boolean, default=False)
    is_speaking = db.Column(db.Boolean, default=False)

    student = db.relationship('User', foreign_keys=[student_id])


class ClassInteraction(db.Model):
    __tablename__ = 'class_interactions'
    id = db.Column(db.Integer, primary_key=True)
    class_id = db.Column(db.Integer, db.ForeignKey('online_classes.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    interaction_type = db.Column(db.String(50), nullable=False)  # 'asked_to_answer', 'hand_raised', 'chat_message', etc.
    status = db.Column(db.String(20), default='pending')  # 'pending', 'accepted', 'declined', 'acknowledged'
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    student = db.relationship('User', foreign_keys=[student_id])


class ChatMessage(db.Model):
    __tablename__ = 'chat_messages'
    id = db.Column(db.Integer, primary_key=True)
    class_id = db.Column(db.Integer, db.ForeignKey('online_classes.id'), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    message = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    sender = db.relationship('User', foreign_keys=[sender_id])


class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    title = db.Column(db.String(150), nullable=False)
    message = db.Column(db.Text, nullable=False)
    type = db.Column(db.String(30), default='info')
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# -----------------------------------------------------------------------------
# HELPER FUNCTIONS & DECORATORS
# -----------------------------------------------------------------------------

def generate_exam_code(subject_code="PY"):
    clean_prefix = ''.join(c for c in subject_code if c.isalnum()).upper()[:2]
    if not clean_prefix:
        clean_prefix = "EX"
    
    while True:
        rand_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))
        code = f"{clean_prefix}{rand_part}"
        existing = Exam.query.filter_by(exam_code=code).first()
        if not existing:
            return code

def get_current_user():
    user_id = session.get('user_id')
    if user_id:
        return db.session.get(User, user_id)
    return None

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def teacher_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user or user.role != 'teacher':
            flash('Access restricted to teachers only.', 'danger')
            return redirect(url_for('dashboard'))
        return f(*args, **kwargs)
    return decorated_function

def student_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user or user.role != 'student':
            flash('Access restricted to students only.', 'danger')
            return redirect(url_for('dashboard'))
        return f(*args, **kwargs)
    return decorated_function

@app.context_processor
def inject_globals():
    current_user = get_current_user()
    unread_notifications = []
    if current_user:
        unread_notifications = Notification.query.filter_by(user_id=current_user.id, is_read=False).order_by(Notification.created_at.desc()).limit(5).all()
    
    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:5000"
    return dict(current_user=current_user, unread_notifications=unread_notifications, local_ip=local_ip, local_url=local_url)


# -----------------------------------------------------------------------------
# VIEWS & AUTHENTICATION ROUTES
# -----------------------------------------------------------------------------

@app.route('/')
def index():
    subjects = Subject.query.all()
    total_students = User.query.filter_by(role='student').count()
    total_exams = Exam.query.count()
    total_classes = OnlineClass.query.count()
    return render_template('index.html', subjects=subjects, stats={
        'students': total_students,
        'exams': total_exams,
        'classes': total_classes
    })

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')

        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            session['user_id'] = user.id
            session['user_role'] = user.role
            session['user_name'] = user.name
            flash(f'Welcome back, {user.name}!', 'success')
            next_page = request.args.get('next')
            return redirect(next_page or url_for('dashboard'))
        else:
            flash('Invalid email or password. Please check your credentials.', 'danger')

    return render_template('login.html')



@app.route('/register', methods=['GET', 'POST'])
def register():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        password = request.form.get('password')
        role = request.form.get('role', 'student')
        roll_number = request.form.get('roll_number')
        department = request.form.get('department', 'Computer Science')

        existing_user = User.query.filter_by(email=email).first()
        if existing_user:
            flash('Email address is already registered.', 'danger')
            return redirect(url_for('register'))

        new_user = User(name=name, email=email, role=role)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.flush()

        if role == 'student':
            roll = roll_number or f"STU{new_user.id:04d}"
            profile = StudentProfile(user_id=new_user.id, roll_number=roll, department=department)
            db.session.add(profile)
        else:
            profile = TeacherProfile(user_id=new_user.id, department=department, designation='Faculty Member')
            db.session.add(profile)

        db.session.commit()
        flash('Registration successful! You can now log in.', 'success')
        return redirect(url_for('login'))

    return render_template('register.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('You have been logged out successfully.', 'info')
    return redirect(url_for('index'))

@app.route('/dashboard')
@login_required
def dashboard():
    user = get_current_user()
    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:5000"

    if user.role == 'teacher':
        total_students = User.query.filter_by(role='student').count()
        my_exams = Exam.query.filter_by(created_by=user.id).order_by(Exam.created_at.desc()).all()
        completed_attempts = ExamAttempt.query.join(Exam).filter(Exam.created_by == user.id, ExamAttempt.status == 'completed').count()
        active_alerts = MonitoringEvent.query.join(ExamAttempt).join(Exam).filter(Exam.created_by == user.id).count()
        
        recent_attempts = ExamAttempt.query.join(Exam).filter(Exam.created_by == user.id).order_by(ExamAttempt.start_time.desc()).limit(8).all()
        upcoming_classes = OnlineClass.query.filter_by(teacher_id=user.id).order_by(OnlineClass.scheduled_at.asc()).all()
        
        return render_template('teacher_dashboard.html',
                               total_students=total_students,
                               my_exams=my_exams,
                               completed_attempts=completed_attempts,
                               active_alerts=active_alerts,
                               recent_attempts=recent_attempts,
                               upcoming_classes=upcoming_classes,
                               local_ip=local_ip,
                               local_url=local_url)
    else:
        attempts = ExamAttempt.query.filter_by(student_id=user.id, status='completed').all()
        total_exams_taken = len(attempts)
        pending_exams = Exam.query.filter_by(status='active').count() - total_exams_taken
        if pending_exams < 0:
            pending_exams = 0
            
        avg_score = round(sum([a.score for a in attempts]) / len(attempts), 1) if attempts else 0.0
        
        upcoming_exams = Exam.query.filter_by(status='active').order_by(Exam.created_at.desc()).limit(5).all()
        recent_results = ExamAttempt.query.filter_by(student_id=user.id, status='completed').order_by(ExamAttempt.end_time.desc()).limit(5).all()
        upcoming_classes = OnlineClass.query.filter(OnlineClass.scheduled_at >= datetime.utcnow() - timedelta(hours=2)).order_by(OnlineClass.scheduled_at.asc()).limit(4).all()
        subjects = Subject.query.all()

        return render_template('student_dashboard.html',
                               total_exams_taken=total_exams_taken,
                               pending_exams=pending_exams,
                               avg_score=avg_score,
                               upcoming_exams=upcoming_exams,
                               recent_results=recent_results,
                               upcoming_classes=upcoming_classes,
                               subjects=subjects,
                               local_ip=local_ip,
                               local_url=local_url)


# -----------------------------------------------------------------------------
# SUBJECTS & NOTES ROUTES
# -----------------------------------------------------------------------------

@app.route('/subjects')
def subjects():
    query = request.args.get('search', '')
    if query:
        all_subjects = Subject.query.filter(
            (Subject.name.ilike(f'%{query}%')) | 
            (Subject.code.ilike(f'%{query}%')) | 
            (Subject.description.ilike(f'%{query}%'))
        ).all()
    else:
        all_subjects = Subject.query.all()
    return render_template('subjects.html', subjects=all_subjects, search_query=query)

@app.route('/notes')
def notes():
    selected_subject_id = request.args.get('subject_id', type=int)
    selected_unit_id = request.args.get('unit_id', type=int)
    search_query = request.args.get('search', '')

    subjects_list = Subject.query.all()
    notes_query = Note.query.join(Unit).join(Subject)

    if selected_subject_id:
        notes_query = notes_query.filter(Subject.id == selected_subject_id)
    if selected_unit_id:
        notes_query = notes_query.filter(Unit.id == selected_unit_id)
    if search_query:
        notes_query = notes_query.filter(
            (Note.topic.ilike(f'%{search_query}%')) | 
            (Note.content.ilike(f'%{search_query}%')) |
            (Unit.title.ilike(f'%{search_query}%'))
        )

    all_notes = notes_query.order_by(Subject.name.asc(), Unit.unit_number.asc()).all()
    return render_template('notes.html', subjects=subjects_list, notes=all_notes,
                           selected_subject_id=selected_subject_id,
                           selected_unit_id=selected_unit_id,
                           search_query=search_query)

@app.route('/api/subjects/create', methods=['POST'])

@login_required
@teacher_required
def create_subject_api():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    code = data.get('code', '').strip().upper()
    description = data.get('description', '').strip()

    if not name or not code:
        return jsonify({'success': False, 'message': 'Subject Name and Code are required.'}), 400

    existing = Subject.query.filter((Subject.name == name) | (Subject.code == code)).first()
    if existing:
        return jsonify({'success': False, 'message': f'Subject "{name}" or Code "{code}" already exists.'}), 400

    new_subject = Subject(
        name=name,
        code=code,
        description=description,
        icon='fa-solid fa-book-open',
        color='primary'
    )
    db.session.add(new_subject)
    db.session.commit()

    return jsonify({
        'success': True,
        'subject': {
            'id': new_subject.id,
            'name': new_subject.name,
            'code': new_subject.code
        }
    })


# -----------------------------------------------------------------------------
# TEACHER CREATE EXAM & DIRECT QUESTIONS
# -----------------------------------------------------------------------------

@app.route('/create-exam', methods=['GET', 'POST'])
@login_required
@teacher_required
def create_exam():
    user = get_current_user()
    subjects = Subject.query.all()
    created_exam = None

    if request.method == 'POST':
        title = request.form.get('title')
        subject_id = request.form.get('subject_id')
        description = request.form.get('description', '')
        duration_minutes = request.form.get('duration_minutes', 60, type=int)
        total_marks = request.form.get('total_marks', 50, type=int)
        passing_marks = request.form.get('passing_marks', 20, type=int)
        instructions = request.form.get('instructions', '')

        subj = db.session.get(Subject, subject_id)
        prefix = subj.code if subj else "PY"
        exam_code = generate_exam_code(prefix)

        new_exam = Exam(
            exam_code=exam_code,
            title=title,
            subject_id=subject_id,
            description=description,
            duration_minutes=duration_minutes,
            total_marks=total_marks,
            passing_marks=passing_marks,
            instructions=instructions,
            created_by=user.id,
            status='active'
        )
        db.session.add(new_exam)
        db.session.flush()

        q_count = request.form.get('q_count', 0, type=int)
        for i in range(1, q_count + 1):
            q_text = request.form.get(f'q_{i}_text')
            if not q_text:
                continue
            q_type = request.form.get(f'q_{i}_type', 'mcq')
            opt_a = request.form.get(f'q_{i}_opt_a', 'Option A')
            opt_b = request.form.get(f'q_{i}_opt_b', 'Option B')
            opt_c = request.form.get(f'q_{i}_opt_c', 'Option C')
            opt_d = request.form.get(f'q_{i}_opt_d', 'Option D')
            correct_ans = request.form.get(f'q_{i}_ans', 'A')
            marks = request.form.get(f'q_{i}_marks', 1, type=int)

            q = Question(
                exam_id=new_exam.id,
                question_type=q_type,
                question_text=q_text,
                option_a=opt_a,
                option_b=opt_b,
                option_c=opt_c,
                option_d=opt_d,
                correct_option=correct_ans,
                marks=marks
            )
            db.session.add(q)

        db.session.commit()
        created_exam = new_exam
        flash(f'Exam created successfully! Generated Exam Code: {exam_code}', 'success')

    return render_template('create_exam.html', subjects=subjects, created_exam=created_exam)


# -----------------------------------------------------------------------------
# STUDENT JOIN EXAM & VERIFY CODE
# -----------------------------------------------------------------------------

@app.route('/join-exam')
@login_required
@student_required
def join_exam():
    return render_template('join_exam.html')


@app.route('/api/exam/verify-code', methods=['POST'])
@login_required
@student_required
def verify_exam_code():
    data = request.get_json() or {}
    raw_code = data.get('exam_code', '').strip().upper()
    user = get_current_user()

    if not raw_code:
        return jsonify({'valid': False, 'message': 'Please enter a valid exam code.'}), 400

    exam = Exam.query.filter_by(exam_code=raw_code).first()
    if not exam:
        return jsonify({'valid': False, 'message': '❌ Invalid Exam Code: Please check the code and try again.'}), 404

    if exam.status != 'active':
        return jsonify({'valid': False, 'message': 'This examination is currently closed or not active.'}), 400

    existing_attempt = ExamAttempt.query.filter_by(exam_id=exam.id, student_id=user.id, status='completed').first()
    if existing_attempt:
        return jsonify({
            'valid': False,
            'message': 'You have already completed and submitted this examination.',
            'redirect_url': url_for('view_results', attempt_id=existing_attempt.id)
        }), 400

    return jsonify({
        'valid': True,
        'exam': {
            'id': exam.id,
            'exam_code': exam.exam_code,
            'title': exam.title,
            'subject_name': exam.subject.name,
            'duration_minutes': exam.duration_minutes,
            'total_marks': exam.total_marks,
            'questions_count': len(exam.questions),
            'teacher_name': exam.creator.name,
            'instructions': exam.instructions
        },
        'start_url': url_for('take_exam', exam_id=exam.id)
    })


@app.route('/api/exam/end/<int:exam_id>', methods=['POST'])
@login_required
@teacher_required
def end_exam(exam_id):
    exam = db.session.get(Exam, exam_id)
    if not exam or exam.created_by != session['user_id']:
        return jsonify({'error': 'Unauthorized'}), 403

    exam.status = 'ended'
    db.session.commit()
    flash(f'Examination "{exam.title}" has been closed.', 'info')
    return redirect(url_for('dashboard'))


# -----------------------------------------------------------------------------
# EXAMS & PROCTORING ROUTES
# -----------------------------------------------------------------------------

@app.route('/exams')
def exams():
    all_exams = Exam.query.order_by(Exam.created_at.desc()).all()
    user = get_current_user()
    attempted_exam_ids = []
    if user and user.role == 'student':
        attempted_exam_ids = [a.exam_id for a in ExamAttempt.query.filter_by(student_id=user.id, status='completed').all()]

    return render_template('exams.html', exams=all_exams, attempted_exam_ids=attempted_exam_ids)

@app.route('/exam/<int:exam_id>')
@login_required
@student_required
def take_exam(exam_id):
    exam = db.session.get(Exam, exam_id)
    if not exam:
        abort(404)

    user = get_current_user()

    existing_attempt = ExamAttempt.query.filter_by(exam_id=exam.id, student_id=user.id).first()
    if existing_attempt and existing_attempt.status == 'completed':
        flash('You have already completed this examination.', 'info')
        return redirect(url_for('view_results', attempt_id=existing_attempt.id))

    if not existing_attempt:
        existing_attempt = ExamAttempt(
            exam_id=exam.id,
            student_id=user.id,
            start_time=datetime.utcnow(),
            status='in_progress',
            tab_switches=0
        )
        db.session.add(existing_attempt)
        db.session.commit()

    questions = Question.query.filter_by(exam_id=exam.id).all()
    return render_template('exam.html', exam=exam, attempt=existing_attempt, questions=questions)

@app.route('/api/exam/submit/<int:attempt_id>', methods=['POST'])
@login_required
@student_required
def submit_exam(attempt_id):
    attempt = db.session.get(ExamAttempt, attempt_id)
    if not attempt or attempt.student_id != session['user_id']:
        return jsonify({'error': 'Unauthorized'}), 403

    if attempt.status == 'completed':
        return jsonify({'success': True, 'redirect_url': url_for('view_results', attempt_id=attempt.id)})

    data = request.get_json() or {}
    answers_dict = data.get('answers', {})

    total_score = 0.0
    questions = Question.query.filter_by(exam_id=attempt.exam_id).all()

    for q in questions:
        selected = answers_dict.get(str(q.id))
        is_correct = (selected == q.correct_option) if selected else False
        if is_correct:
            total_score += q.marks

        ans = Answer(
            attempt_id=attempt.id,
            question_id=q.id,
            selected_option=selected,
            is_correct=is_correct
        )
        db.session.add(ans)

    attempt.score = total_score
    attempt.end_time = datetime.utcnow()
    attempt.status = 'completed'

    notif = Notification(
        user_id=session['user_id'],
        title='Exam Result Available',
        message=f'Your results for "{attempt.exam.title}" are ready. Score: {total_score}/{attempt.exam.total_marks}',
        type='result'
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify({'success': True, 'redirect_url': url_for('view_results', attempt_id=attempt.id)})


@app.route('/api/monitoring/warning', methods=['POST'])
@login_required
@teacher_required
def send_teacher_warning():
    data = request.get_json() or {}
    exam_id = data.get('exam_id')
    student_id = data.get('student_id')
    message = data.get('message', '').strip()

    if not exam_id or not student_id or not message:
        return jsonify({'success': False, 'message': 'Invalid warning parameters.'}), 400

    warning = ExamWarning(
        exam_id=exam_id,
        teacher_id=session['user_id'],
        student_id=student_id,
        message=message,
        status='pending',
        timestamp=datetime.utcnow()
    )
    db.session.add(warning)

    notif = Notification(
        user_id=student_id,
        title='⚠️ TEACHER WARNING',
        message=message,
        type='alert'
    )
    db.session.add(notif)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Warning sent to student successfully.'})


@app.route('/api/exam/student-warnings')
@login_required
@student_required
def check_student_warnings():
    user_id = session['user_id']
    pending_warnings = ExamWarning.query.filter_by(student_id=user_id, status='pending').all()
    results = []
    for w in pending_warnings:
        results.append({
            'id': w.id,
            'message': w.message,
            'teacher_name': w.teacher.name,
            'timestamp': w.timestamp.strftime('%I:%M %p')
        })
    return jsonify({'warnings': results})


@app.route('/api/exam/acknowledge-warning', methods=['POST'])
@login_required
@student_required
def acknowledge_warning():
    data = request.get_json() or {}
    warning_id = data.get('warning_id')
    warning = db.session.get(ExamWarning, warning_id)
    if warning and warning.student_id == session['user_id']:
        warning.status = 'acknowledged'
        db.session.commit()
        return jsonify({'success': True})
    return jsonify({'success': False}), 400


@app.route('/api/monitoring/event', methods=['POST'])
@login_required
def log_monitoring_event():
    data = request.get_json() or {}
    attempt_id = data.get('attempt_id')
    event_type = data.get('event_type', 'tab_switch')
    details = data.get('details', '')

    attempt = db.session.get(ExamAttempt, attempt_id)
    if not attempt:
        return jsonify({'error': 'Attempt not found'}), 404

    if event_type == 'tab_switch':
        attempt.tab_switches += 1
    elif event_type == 'camera_disconnected':
        attempt.camera_status = 'disconnected'
    elif event_type == 'screen_sharing_started':
        attempt.screen_status = 'sharing'
    elif event_type == 'screen_sharing_stopped':
        attempt.screen_status = 'off'

    event = MonitoringEvent(
        attempt_id=attempt.id,
        student_id=attempt.student_id,
        exam_id=attempt.exam_id,
        event_type=event_type,
        details=details,
        timestamp=datetime.utcnow()
    )
    db.session.add(event)

    if attempt.tab_switches >= 3:
        teacher_id = attempt.exam.created_by
        alert_notif = Notification(
            user_id=teacher_id,
            title='⚠️ Exam Proctoring Alert',
            message=f'Student {attempt.student.name} switched tabs {attempt.tab_switches} times in "{attempt.exam.title}".',
            type='alert'
        )
        db.session.add(alert_notif)

    db.session.commit()
    return jsonify({
        'success': True,
        'tab_switches': attempt.tab_switches,
        'warning_level': 'danger' if attempt.tab_switches >= 3 else ('warning' if attempt.tab_switches >= 1 else 'normal')
    })


@app.route('/results/<int:attempt_id>')
@login_required
def view_results(attempt_id):
    attempt = db.session.get(ExamAttempt, attempt_id)
    if not attempt:
        abort(404)

    user = get_current_user()

    if user.role == 'student' and attempt.student_id != user.id:
        flash('Unauthorized access to results.', 'danger')
        return redirect(url_for('dashboard'))

    exam = attempt.exam
    questions = Question.query.filter_by(exam_id=exam.id).all()
    answers = {ans.question_id: ans for ans in Answer.query.filter_by(attempt_id=attempt.id).all()}

    correct_count = sum(1 for a in answers.values() if a.is_correct)
    answered_count = sum(1 for a in answers.values() if a.selected_option is not None)
    wrong_count = answered_count - correct_count
    unanswered_count = len(questions) - answered_count
    percentage = round((attempt.score / exam.total_marks) * 100, 1) if exam.total_marks > 0 else 0

    if percentage >= 90:
        grade = 'A+'
    elif percentage >= 80:
        grade = 'A'
    elif percentage >= 70:
        grade = 'B'
    elif percentage >= 60:
        grade = 'C'
    elif percentage >= 40:
        grade = 'D'
    else:
        grade = 'F'

    subject_attempts = ExamAttempt.query.filter_by(student_id=attempt.student_id, status='completed').all()
    history_labels = [a.exam.title[:15] + '...' for a in subject_attempts[-5:]]
    history_scores = [round((a.score / a.exam.total_marks) * 100, 1) for a in subject_attempts[-5:]]

    return render_template('results.html',
                           attempt=attempt,
                           exam=exam,
                           questions=questions,
                           answers=answers,
                           correct_count=correct_count,
                           wrong_count=wrong_count,
                           unanswered_count=unanswered_count,
                           percentage=percentage,
                           grade=grade,
                           history_labels=history_labels,
                           history_scores=history_scores)


# -----------------------------------------------------------------------------
# TEACHER LIVE MONITORING & WEBRTC SIGNALING
# -----------------------------------------------------------------------------

@app.route('/monitoring')
@login_required
@teacher_required
def monitoring():
    teacher = get_current_user()
    active_attempts = ExamAttempt.query.join(Exam).filter(
        Exam.created_by == teacher.id,
        ExamAttempt.status == 'in_progress'
    ).order_by(ExamAttempt.start_time.desc()).all()

    recent_events = MonitoringEvent.query.join(Exam).filter(
        Exam.created_by == teacher.id
    ).order_by(MonitoringEvent.timestamp.desc()).limit(15).all()

    return render_template('monitoring.html', active_attempts=active_attempts, recent_events=recent_events)

@app.route('/api/monitoring/live-data')
@login_required
@teacher_required
def live_monitoring_data():
    teacher = get_current_user()
    active_attempts = ExamAttempt.query.join(Exam).filter(
        Exam.created_by == teacher.id,
        ExamAttempt.status == 'in_progress'
    ).all()

    results = []
    for a in active_attempts:
        elapsed = (datetime.utcnow() - a.start_time).seconds // 60
        remaining = max(0, a.exam.duration_minutes - elapsed)
        results.append({
            'attempt_id': a.id,
            'student_id': a.student_id,
            'student_name': a.student.name,
            'exam_id': a.exam_id,
            'exam_title': a.exam.title,
            'tab_switches': a.tab_switches,
            'camera_status': a.camera_status,
            'screen_status': a.screen_status,
            'time_remaining': f"{remaining}:00",
            'status': a.status,
            'warning_level': 'danger' if a.tab_switches >= 3 else ('warning' if a.tab_switches >= 1 else 'normal')
        })

    return jsonify({'active_sessions': results})


@app.route('/api/webrtc/signaling', methods=['GET', 'POST'])
@login_required
def webrtc_signaling():
    if request.method == 'GET':
        data = request.args.to_dict()
        if 'action' not in data:
            data['action'] = 'get_signals'
    else:
        data = request.get_json() or {}

    action = data.get('action')
    exam_id = data.get('exam_id')
    class_id = data.get('class_id')
    from_user_id = session['user_id']
    to_user_id = data.get('to_user_id') or data.get('target_user_id')
    stream_type = data.get('stream_type', 'camera')
    payload = data.get('data') or data.get('payload')

    if action in ['offer', 'post_offer']:
        sdp_offer = payload or data.get('sdp_offer')
        sdp_offer_str = json.dumps(sdp_offer) if isinstance(sdp_offer, dict) else str(sdp_offer)
        signal = WebRTCSignal(
            exam_id=exam_id,
            class_id=class_id,
            from_user_id=from_user_id,
            to_user_id=to_user_id,
            stream_type=stream_type,
            sdp_offer=sdp_offer_str,
            ice_candidates='[]'
        )
        db.session.add(signal)
        db.session.commit()
        return jsonify({'success': True, 'signal_id': signal.id})

    elif action in ['answer', 'post_answer']:
        signal_id = data.get('signal_id')
        sdp_answer = payload or data.get('sdp_answer')
        sdp_answer_str = json.dumps(sdp_answer) if isinstance(sdp_answer, dict) else str(sdp_answer)
        
        signal = None
        if signal_id:
            signal = db.session.get(WebRTCSignal, signal_id)
        if not signal:
            signal = WebRTCSignal.query.filter_by(
                class_id=class_id,
                from_user_id=to_user_id,
                to_user_id=from_user_id,
                stream_type=stream_type
            ).order_by(WebRTCSignal.updated_at.desc()).first()

        if not signal:
            signal = WebRTCSignal.query.filter_by(
                class_id=class_id,
                from_user_id=to_user_id,
                stream_type=stream_type
            ).order_by(WebRTCSignal.updated_at.desc()).first()

        if signal:
            signal.sdp_answer = sdp_answer_str
            db.session.commit()
            return jsonify({'success': True})
        return jsonify({'success': False, 'message': 'Signal not found for answer'}), 404

    elif action in ['candidate', 'post_candidate']:
        candidate = payload or data.get('candidate')
        cand_str = json.dumps(candidate) if isinstance(candidate, dict) else str(candidate)
        
        signal = WebRTCSignal.query.filter_by(
            class_id=class_id,
            from_user_id=from_user_id,
            stream_type=stream_type
        ).order_by(WebRTCSignal.updated_at.desc()).first()

        if signal:
            candidates_list = json.loads(signal.ice_candidates or '[]')
            candidates_list.append(cand_str)
            signal.ice_candidates = json.dumps(candidates_list)
            db.session.commit()
            return jsonify({'success': True})
        return jsonify({'success': False}), 404

    elif action == 'get_signals':
        query = WebRTCSignal.query
        if exam_id:
            query = query.filter_by(exam_id=exam_id)
        if class_id:
            query = query.filter_by(class_id=class_id)

        signals = query.filter(
            (WebRTCSignal.to_user_id == from_user_id) | (WebRTCSignal.to_user_id.is_(None))
        ).filter(WebRTCSignal.from_user_id != from_user_id).order_by(WebRTCSignal.updated_at.desc()).all()

        results = []
        for s in signals:
            try:
                offer_val = json.loads(s.sdp_offer) if s.sdp_offer and s.sdp_offer.startswith('{') else s.sdp_offer
            except Exception:
                offer_val = s.sdp_offer

            try:
                answer_val = json.loads(s.sdp_answer) if s.sdp_answer and s.sdp_answer.startswith('{') else s.sdp_answer
            except Exception:
                answer_val = s.sdp_answer

            raw_cands = json.loads(s.ice_candidates or '[]')
            parsed_cands = []
            for c in raw_cands:
                try:
                    parsed_cands.append(json.loads(c) if isinstance(c, str) and c.startswith('{') else c)
                except Exception:
                    parsed_cands.append(c)

            sig_type = 'offer' if (s.sdp_offer and not s.sdp_answer) else ('answer' if s.sdp_answer else 'candidate')
            payload_data = offer_val if sig_type == 'offer' else (answer_val if sig_type == 'answer' else parsed_cands)

            results.append({
                'signal_id': s.id,
                'from_user_id': s.from_user_id,
                'to_user_id': s.to_user_id,
                'stream_type': s.stream_type,
                'action': sig_type,
                'type': sig_type,
                'data': payload_data,
                'sdp_offer': offer_val,
                'sdp_answer': answer_val,
                'ice_candidates': parsed_cands
            })

        return jsonify({'has_stream': len(results) > 0, 'signals': results})

    return jsonify({'error': 'Invalid action'}), 400



# -----------------------------------------------------------------------------
# LIVE CLASSROOM SUITE & ASK-TO-ANSWER API
# -----------------------------------------------------------------------------

@app.route('/classes')
def online_classes():
    all_classes = OnlineClass.query.order_by(OnlineClass.scheduled_at.asc()).all()
    subjects = Subject.query.all()
    return render_template('online_class.html', classes=all_classes, subjects=subjects)

@app.route('/api/classes/create', methods=['POST'])
@login_required
@teacher_required
def create_online_class():
    subject_id = request.form.get('subject_id')
    title = request.form.get('title')
    scheduled_at_str = request.form.get('scheduled_at')
    duration = request.form.get('duration_minutes', 60, type=int)

    try:
        scheduled_at = datetime.strptime(scheduled_at_str, '%Y-%m-%dT%H:%M')
    except (ValueError, TypeError):
        scheduled_at = datetime.utcnow() + timedelta(hours=1)

    new_class = OnlineClass(
        subject_id=subject_id,
        title=title,
        teacher_id=session['user_id'],
        scheduled_at=scheduled_at,
        duration_minutes=duration,
        status='live'
    )
    db.session.add(new_class)
    db.session.commit()
    flash('Live Classroom session created successfully!', 'success')
    return redirect(url_for('live_classroom', class_id=new_class.id))


@app.route('/live-class/<int:class_id>')
@login_required
def live_classroom(class_id):
    classroom = db.session.get(OnlineClass, class_id)
    if not classroom:
        abort(404)

    user = get_current_user()

    participant = ClassParticipant.query.filter_by(class_id=classroom.id, student_id=user.id).first()
    if not participant:
        participant = ClassParticipant(class_id=classroom.id, student_id=user.id, camera_status='off', microphone_status='off', last_activity=datetime.utcnow())
        db.session.add(participant)
        db.session.commit()
    else:
        participant.last_activity = datetime.utcnow()
        db.session.commit()

    all_participants = ClassParticipant.query.filter_by(class_id=classroom.id).all()
    messages = ChatMessage.query.filter_by(class_id=classroom.id).order_by(ChatMessage.timestamp.asc()).all()

    return render_template('live_classroom.html', classroom=classroom, participant=participant, participants=all_participants, messages=messages)


@app.route('/api/live-class/ask-to-answer', methods=['POST'])
@login_required
@teacher_required
def teacher_ask_to_answer():
    data = request.get_json() or {}
    class_id = data.get('class_id')
    student_id = data.get('student_id')

    if not class_id or not student_id:
        return jsonify({'success': False, 'message': 'Missing parameters'}), 400

    interaction = ClassInteraction(
        class_id=class_id,
        student_id=student_id,
        interaction_type='asked_to_answer',
        status='pending',
        timestamp=datetime.utcnow()
    )
    db.session.add(interaction)

    p = ClassParticipant.query.filter_by(class_id=class_id, student_id=student_id).first()
    if p:
        p.last_activity = datetime.utcnow()

    db.session.commit()
    return jsonify({'success': True, 'message': 'Ask to Answer prompt sent to student.'})


@app.route('/api/live-class/check-requests')
@login_required
def student_check_requests():
    class_id = request.args.get('class_id', type=int)
    user_id = session['user_id']

    pending = ClassInteraction.query.filter_by(
        class_id=class_id,
        student_id=user_id,
        interaction_type='asked_to_answer',
        status='pending'
    ).order_by(ClassInteraction.timestamp.desc()).first()

    if pending:
        return jsonify({'has_request': True, 'request_id': pending.id, 'timestamp': pending.timestamp.strftime('%I:%M %p')})

    return jsonify({'has_request': False})


@app.route('/api/live-class/respond-request', methods=['POST'])
@login_required
def student_respond_request():
    data = request.get_json() or {}
    request_id = data.get('request_id')
    action = data.get('action')  # 'accept' or 'decline'

    req = db.session.get(ClassInteraction, request_id)
    if req and req.student_id == session['user_id']:
        req.status = 'accepted' if action == 'accept' else 'declined'
        p = ClassParticipant.query.filter_by(class_id=req.class_id, student_id=req.student_id).first()
        if p:
            p.last_activity = datetime.utcnow()
        db.session.commit()
        return jsonify({'success': True})

    return jsonify({'success': False}), 400


@app.route('/api/live-class/chat', methods=['POST'])
@login_required
def send_class_chat():
    data = request.get_json() or {}
    class_id = data.get('class_id')
    message_text = data.get('message', '').strip()

    if not class_id or not message_text:
        return jsonify({'success': False}), 400

    msg = ChatMessage(
        class_id=class_id,
        sender_id=session['user_id'],
        message=message_text,
        timestamp=datetime.utcnow()
    )
    db.session.add(msg)

    p = ClassParticipant.query.filter_by(class_id=class_id, student_id=session['user_id']).first()
    if p:
        p.last_activity = datetime.utcnow()

    db.session.commit()
    return jsonify({
        'success': True,
        'chat': {
            'sender_name': msg.sender.name,
            'message': msg.message,
            'timestamp': msg.timestamp.strftime('%I:%M %p')
        }
    })


@app.route('/api/live-class/hand-raise', methods=['POST'])
@login_required
def toggle_hand_raise():
    data = request.get_json() or {}
    class_id = data.get('class_id')
    action = data.get('action', 'toggle')
    target_student_id = data.get('student_id', session['user_id'])

    participant = ClassParticipant.query.filter_by(class_id=class_id, student_id=target_student_id).first()
    if not participant:
        return jsonify({'success': False}), 404

    if action == 'toggle':
        participant.hand_raised = not participant.hand_raised
    elif action == 'lower':
        participant.hand_raised = False
    elif action == 'acknowledge':
        participant.hand_raised = False

    participant.last_activity = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'hand_raised': participant.hand_raised})


@app.route('/api/live-class/status', methods=['POST'])
@login_required
def update_participant_status():
    data = request.get_json() or {}
    class_id = data.get('class_id')
    camera_status = data.get('camera_status')
    microphone_status = data.get('microphone_status')
    screen_status = data.get('screen_status')
    is_speaking = data.get('is_speaking')

    participant = ClassParticipant.query.filter_by(class_id=class_id, student_id=session['user_id']).first()
    if not participant:
        return jsonify({'success': False}), 404

    if camera_status:
        participant.camera_status = camera_status
    if microphone_status:
        participant.microphone_status = microphone_status
    if screen_status:
        participant.screen_status = screen_status
    if is_speaking is not None:
        participant.is_speaking = is_speaking

    participant.last_activity = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True})


@app.route('/api/live-class/state/<int:class_id>')
@login_required
def get_live_class_state(class_id):
    classroom = db.session.get(OnlineClass, class_id)
    if not classroom:
        return jsonify({'error': 'Class not found'}), 404

    participants = ClassParticipant.query.filter_by(class_id=class_id).all()
    messages = ChatMessage.query.filter_by(class_id=class_id).order_by(ChatMessage.timestamp.asc()).all()

    camera_on_count = sum(1 for p in participants if p.camera_status == 'on')
    mic_on_count = sum(1 for p in participants if p.microphone_status == 'on')
    speaking_count = sum(1 for p in participants if p.is_speaking or p.microphone_status == 'on')
    raised_hands_count = sum(1 for p in participants if p.hand_raised)
    screen_sharing_count = sum(1 for p in participants if p.screen_status == 'sharing')

    p_data = []
    raised_hands = []
    for p in participants:
        last_act_str = p.last_activity.strftime('%I:%M %p') if p.last_activity else 'Just now'
        p_data.append({
            'student_id': p.student_id,
            'student_name': p.student.name,
            'status': p.status,
            'camera_status': p.camera_status,
            'microphone_status': p.microphone_status,
            'screen_status': p.screen_status,
            'hand_raised': p.hand_raised,
            'is_speaking': p.is_speaking,
            'last_activity': last_act_str
        })
        if p.hand_raised:
            raised_hands.append({
                'student_id': p.student_id,
                'student_name': p.student.name
            })

    m_data = []
    for m in messages:
        m_data.append({
            'sender_name': m.sender.name,
            'message': m.message,
            'timestamp': m.timestamp.strftime('%I:%M %p')
        })

    return jsonify({
        'class_id': classroom.id,
        'title': classroom.title,
        'teacher_id': classroom.teacher_id,
        'teacher_name': classroom.teacher.name,
        'participant_count': len(participants),
        'camera_on_count': camera_on_count,
        'mic_on_count': mic_on_count,
        'speaking_count': speaking_count,
        'raised_hands_count': raised_hands_count,
        'screen_sharing_count': screen_sharing_count,
        'participants': p_data,
        'raised_hands': raised_hands,
        'messages': m_data
    })


@app.route('/viewboard')
def viewboard():
    return render_template('viewboard.html')


# -----------------------------------------------------------------------------
# DATABASE SEEDING & INITIALIZATION
# -----------------------------------------------------------------------------

def seed_database():
    db.create_all()
    if User.query.first():
        return

    print("Seeding database with Google Meet-style Ask-to-Answer classroom data...")

    teacher = User(name='Mr. Ahmed', email='teacher@platform.com', role='teacher')
    teacher.set_password('teacher123')
    db.session.add(teacher)

    student = User(name='Rahul Kumar', email='student@platform.com', role='student')
    student.set_password('student123')
    db.session.add(student)

    student2 = User(name='Aisha Khan', email='aisha@platform.com', role='student')
    student2.set_password('student123')
    db.session.add(student2)

    student3 = User(name='Mohammed Ali', email='ali@platform.com', role='student')
    student3.set_password('student123')
    db.session.add(student3)

    db.session.flush()

    db.session.add(TeacherProfile(user_id=teacher.id, department='Computer Science', designation='Senior Professor'))
    db.session.add(StudentProfile(user_id=student.id, roll_number='CS2026-101', grade_level='B.Tech CSE Year 3'))
    db.session.add(StudentProfile(user_id=student2.id, roll_number='CS2026-102', grade_level='B.Tech CSE Year 3'))
    db.session.add(StudentProfile(user_id=student3.id, roll_number='CS2026-103', grade_level='B.Tech CSE Year 3'))

    subjects_list = [
        ('Python Programming', 'CS301', 'Core Python, OOP, Flask, and Web APIs', 'fa-brands fa-python', 'primary'),
        ('Java Enterprise Edition', 'CS302', 'OOP, Spring Boot, and Enterprise Tech', 'fa-brands fa-java', 'danger'),
        ('Database Management Systems', 'CS303', 'SQL, Relational Modeling, and Indexing', 'fa-solid fa-database', 'info'),
        ('Computer Networks', 'CS304', 'TCP/IP Stack, Routing, and Protocols', 'fa-solid fa-network-wired', 'warning'),
        ('Web Development', 'CS305', 'HTML5, CSS3, JavaScript, and Frontend Frameworks', 'fa-solid fa-code', 'success'),
        ('Data Structures & Algorithms', 'CS306', 'Trees, Graphs, Sorting, and Dynamic Programming', 'fa-solid fa-diagram-project', 'secondary'),
        ('Artificial Intelligence', 'CS307', 'Machine Learning, Neural Networks, and NLP', 'fa-solid fa-brain', 'primary')
    ]

    db_subjs = []
    for name, code, desc, icon, color in subjects_list:
        s = Subject(name=name, code=code, description=desc, icon=icon, color=color)
        db.session.add(s)
        db_subjs.append(s)

    db.session.flush()

    unit_py1 = Unit(subject_id=db_subjs[0].id, unit_number=1, title='Unit 1: Python Basics & OOP', description='Syntax, classes, decorators')
    db.session.add(unit_py1)
    db.session.flush()

    note1 = Note(
        unit_id=unit_py1.id,
        topic='Python Decorators & Generators',
        content='Decorators modify functions. Generators yield values memory-efficiently.',
        author_id=teacher.id
    )
    db.session.add(note1)

    exam_py = Exam(
        exam_code='PY7K92X',
        title='Python Examination',
        subject_id=db_subjs[0].id,
        description='Comprehensive examination covering Python syntax and web programming.',
        duration_minutes=60,
        total_marks=50,
        passing_marks=20,
        created_by=teacher.id,
        status='active'
    )
    db.session.add(exam_py)
    db.session.flush()

    q1 = Question(
        exam_id=exam_py.id,
        question_type='mcq',
        question_text='What is Python?',
        option_a='Programming Language', option_b='Operating System', option_c='Database', option_d='Web Browser',
        correct_option='A', marks=10
    )
    db.session.add(q1)

    live_cls = OnlineClass(
        subject_id=db_subjs[0].id,
        title='Python Programming Live Lecture',
        teacher_id=teacher.id,
        scheduled_at=datetime.utcnow(),
        duration_minutes=60,
        status='live'
    )
    db.session.add(live_cls)
    db.session.flush()

    db.session.add(ClassParticipant(class_id=live_cls.id, student_id=student.id, camera_status='on', microphone_status='off', hand_raised=True, last_activity=datetime.utcnow()))
    db.session.add(ClassParticipant(class_id=live_cls.id, student_id=student2.id, camera_status='off', microphone_status='off', hand_raised=False, last_activity=datetime.utcnow()))
    
    db.session.add(ChatMessage(class_id=live_cls.id, sender_id=student.id, message='Sir, can you explain question 3?'))
    db.session.add(ChatMessage(class_id=live_cls.id, sender_id=teacher.id, message='Yes, I will explain it now.'))

    db.session.commit()
    print("Database successfully seeded!")


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)
