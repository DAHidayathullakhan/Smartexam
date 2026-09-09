import os
import random
import string
import json
import socket
from datetime import datetime, timedelta
from functools import wraps
from flask import (
    Flask, render_template, request, redirect, url_for, flash, session, jsonify, abort, send_from_directory
)
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

# Import MongoDB connection & collections module
import database as db_module
from database import (
    teachers as db_teachers,
    students as db_students,
    subjects as db_subjects,
    exam_codes as db_exam_codes,
    questions as db_questions,
    exam_attempts as db_exam_attempts,
    results as db_results,
    live_classes as db_live_classes,
    attendance as db_attendance,
    chat_messages as db_chat_messages,
    users as db_users,
    units as db_units,
    notes as db_notes,
    notifications as db_notifications,
    webrtc_signals as db_webrtc_signals
)

# Load environment variables from .env file
import mimetypes

# Ensure proper MIME types for static assets
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/svg+xml', '.svg')
mimetypes.add_type('image/png', '.png')
mimetypes.add_type('image/jpeg', '.jpg')

app = Flask(__name__, template_folder='templates', static_folder='static', static_url_path='/static')
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'edtech_super_secret_production_key_2026_antigravity')

@app.route('/static/<path:filename>')
def serve_static(filename):
    static_dir = os.path.join(app.root_path, 'static')
    mime_type, _ = mimetypes.guess_type(filename)
    return send_from_directory(static_dir, filename, mimetype=mime_type or 'text/plain')




# -----------------------------------------------------------------------------
# MONGO HELPERS & MODEL WRAPPERS
# -----------------------------------------------------------------------------

def get_next_id(collection):
    docs = collection.find()
    if not docs:
        return 1
    max_id = 0
    for d in docs:
        if isinstance(d, dict):
            i = d.get('id', d.get('_id', 0))
            if isinstance(i, int) and i > max_id:
                max_id = i
    return max_id + 1

class MongoDoc:
    def __init__(self, data=None):
        if data is None:
            data = {}
        if isinstance(data, MongoDoc):
            self.__dict__.update(data.__dict__)
            return
        self.__dict__.update(data)
        if '_id' in data and 'id' not in data:
            self.id = data['_id']
        elif 'id' not in self.__dict__:
            self.id = 1

    def get(self, key, default=None):
        return self.__dict__.get(key, default)

    def __getattr__(self, item):
        return self.__dict__.get(item, None)

class UserDoc(MongoDoc):
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        db_users.update_one({'id': self.id}, {'$set': {'password_hash': self.password_hash}})

    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    @property
    def student_profile(self):
        doc = db_students.find_one({'user_id': self.id})
        return MongoDoc(doc) if doc else None

    @property
    def teacher_profile(self):
        doc = db_teachers.find_one({'user_id': self.id})
        return MongoDoc(doc) if doc else None

    @property
    def attempts(self):
        docs = db_exam_attempts.find({'student_id': self.id})
        return [ExamAttemptDoc(d) for d in docs]

    @property
    def created_exams(self):
        docs = db_exam_codes.find({'created_by': self.id})
        return [ExamDoc(d) for d in docs]

    @property
    def notifications(self):
        docs = db_notifications.find({'user_id': self.id})
        return [MongoDoc(d) for d in docs]

class SubjectDoc(MongoDoc):
    @property
    def units(self):
        docs = db_units.find({'subject_id': self.id})
        return [UnitDoc(d) for d in docs]

    @property
    def exams(self):
        docs = db_exam_codes.find({'subject_id': self.id})
        return [ExamDoc(d) for d in docs]

    @property
    def online_classes(self):
        docs = db_live_classes.find({'subject_id': self.id})
        return [OnlineClassDoc(d) for d in docs]

class ExamDoc(MongoDoc):
    @property
    def subject(self):
        doc = db_subjects.find_one({'id': self.subject_id})
        return SubjectDoc(doc) if doc else None

    @property
    def creator(self):
        doc = db_users.find_one({'id': self.created_by})
        return UserDoc(doc) if doc else None

    @property
    def questions(self):
        docs = db_questions.find({'exam_id': self.id})
        return [MongoDoc(d) for d in docs]

    @property
    def attempts(self):
        docs = db_exam_attempts.find({'exam_id': self.id})
        return [ExamAttemptDoc(d) for d in docs]

class ExamAttemptDoc(MongoDoc):
    @property
    def student(self):
        doc = db_users.find_one({'id': self.student_id})
        return UserDoc(doc) if doc else None

    @property
    def exam(self):
        doc = db_exam_codes.find_one({'id': self.exam_id})
        return ExamDoc(doc) if doc else None

class UnitDoc(MongoDoc):
    @property
    def subject(self):
        doc = db_subjects.find_one({'id': self.subject_id})
        return SubjectDoc(doc) if doc else None

    @property
    def notes(self):
        docs = db_notes.find({'unit_id': self.id})
        return [NoteDoc(d) for d in docs]

class NoteDoc(MongoDoc):
    @property
    def unit(self):
        doc = db_units.find_one({'id': self.unit_id})
        return UnitDoc(doc) if doc else None

    @property
    def author(self):
        doc = db_users.find_one({'id': self.author_id})
        return UserDoc(doc) if doc else None

class OnlineClassDoc(MongoDoc):
    @property
    def subject(self):
        doc = db_subjects.find_one({'id': self.subject_id})
        return SubjectDoc(doc) if doc else None

    @property
    def teacher(self):
        doc = db_users.find_one({'id': self.teacher_id})
        return UserDoc(doc) if doc else None

class ClassParticipantDoc(MongoDoc):
    @property
    def student(self):
        doc = db_users.find_one({'id': self.student_id})
        return UserDoc(doc) if doc else None

class ChatMessageDoc(MongoDoc):
    @property
    def sender(self):
        doc = db_users.find_one({'id': self.sender_id})
        return UserDoc(doc) if doc else None

# -----------------------------------------------------------------------------
# DYNAMIC LOCAL NETWORK IP DETECTION
# -----------------------------------------------------------------------------

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

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
        existing = db_exam_codes.find_one({'exam_code': code})
        if not existing:
            return code

def get_current_user():
    user_id = session.get('user_id')
    if user_id:
        doc = db_users.find_one({'id': user_id})
        return UserDoc(doc) if doc else None
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
        n_docs = db_notifications.find({'user_id': current_user.id, 'is_read': False})
        unread_notifications = [MongoDoc(n) for n in n_docs][:5]
    
    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:5000"
    return dict(current_user=current_user, unread_notifications=unread_notifications, local_ip=local_ip, local_url=local_url)

# -----------------------------------------------------------------------------
# VIEWS & AUTHENTICATION ROUTES
# -----------------------------------------------------------------------------

@app.route('/')
def index():
    subjects_list = [SubjectDoc(d) for d in db_subjects.find()]
    total_students = db_users.count_documents({'role': 'student'})
    total_exams = db_exam_codes.count_documents()
    total_classes = db_live_classes.count_documents()
    return render_template('index.html', subjects=subjects_list, stats={
        'students': total_students,
        'exams': total_exams,
        'classes': total_classes
    })

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('user_id'):
        return redirect(url_for('dashboard'))

    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')

        user_data = db_users.find_one({'email': email})
        user = UserDoc(user_data) if user_data else None

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
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        role = request.form.get('role', 'student')
        roll_number = request.form.get('roll_number')
        department = request.form.get('department', 'Computer Science')

        if db_users.find_one({'email': email}):
            flash('Email address is already registered.', 'danger')
            return redirect(url_for('register'))

        user_id = get_next_id(db_users)
        password_hash = generate_password_hash(password)
        user_doc = {
            'id': user_id,
            'name': name,
            'email': email,
            'password_hash': password_hash,
            'role': role,
            'created_at': datetime.utcnow()
        }
        db_users.insert_one(user_doc)

        if role == 'student':
            roll = roll_number or f"STU{user_id:04d}"
            prof_id = get_next_id(db_students)
            db_students.insert_one({
                'id': prof_id,
                'user_id': user_id,
                'roll_number': roll,
                'grade_level': 'B.Tech CSE Year 3',
                'department': department
            })
        else:
            prof_id = get_next_id(db_teachers)
            db_teachers.insert_one({
                'id': prof_id,
                'user_id': user_id,
                'department': department,
                'designation': 'Faculty Member'
            })

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
        total_students = db_users.count_documents({'role': 'student'})
        my_exams_data = db_exam_codes.find({'created_by': user.id})
        my_exams = [ExamDoc(d) for d in my_exams_data]
        
        all_attempts = [ExamAttemptDoc(d) for d in db_exam_attempts.find({'status': 'completed'})]
        my_exam_ids = [e.id for e in my_exams]
        completed_attempts = [a for a in all_attempts if a.exam_id in my_exam_ids]
        
        recent_attempts = sorted(completed_attempts, key=lambda x: x.start_time or datetime.utcnow(), reverse=True)[:8]
        upcoming_classes = [OnlineClassDoc(d) for d in db_live_classes.find({'teacher_id': user.id})]
        
        return render_template('teacher_dashboard.html',
                               total_students=total_students,
                               my_exams=my_exams,
                               completed_attempts=len(completed_attempts),
                               active_alerts=0,
                               recent_attempts=recent_attempts,
                               upcoming_classes=upcoming_classes,
                               local_ip=local_ip,
                               local_url=local_url)
    else:
        attempts_data = db_exam_attempts.find({'student_id': user.id, 'status': 'completed'})
        attempts = [ExamAttemptDoc(d) for d in attempts_data]
        total_exams_taken = len(attempts)
        total_active_exams = db_exam_codes.count_documents({'status': 'active'})
        pending_exams = max(0, total_active_exams - total_exams_taken)
        
        scores = [a.score for a in attempts if a.score is not None]
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0.0
        
        upcoming_exams = [ExamDoc(d) for d in db_exam_codes.find({'status': 'active'})][:5]
        recent_results = sorted(attempts, key=lambda x: x.end_time or datetime.utcnow(), reverse=True)[:5]
        upcoming_classes = [OnlineClassDoc(d) for d in db_live_classes.find()][:4]
        subjects_list = [SubjectDoc(d) for d in db_subjects.find()]

        return render_template('student_dashboard.html',
                               total_exams_taken=total_exams_taken,
                               pending_exams=pending_exams,
                               avg_score=avg_score,
                               upcoming_exams=upcoming_exams,
                               recent_results=recent_results,
                               upcoming_classes=upcoming_classes,
                               subjects=subjects_list,
                               local_ip=local_ip,
                               local_url=local_url)

# -----------------------------------------------------------------------------
# SUBJECTS & NOTES ROUTES
# -----------------------------------------------------------------------------

@app.route('/subjects')
def subjects():
    query = request.args.get('search', '').strip().lower()
    all_docs = db_subjects.find()
    if query:
        filtered = [d for d in all_docs if query in d.get('name', '').lower() or query in d.get('code', '').lower() or query in d.get('description', '').lower()]
        all_subjects = [SubjectDoc(d) for d in filtered]
    else:
        all_subjects = [SubjectDoc(d) for d in all_docs]
    return render_template('subjects.html', subjects=all_subjects, search_query=query)

@app.route('/notes')
def notes():
    selected_subject_id = request.args.get('subject_id', type=int)
    selected_unit_id = request.args.get('unit_id', type=int)
    search_query = request.args.get('search', '').strip().lower()

    subjects_list = [SubjectDoc(d) for d in db_subjects.find()]
    note_docs = db_notes.find()

    results_notes = []
    for nd in note_docs:
        note_obj = NoteDoc(nd)
        if selected_subject_id and note_obj.unit and note_obj.unit.subject_id != selected_subject_id:
            continue
        if selected_unit_id and note_obj.unit_id != selected_unit_id:
            continue
        if search_query:
            t = (note_obj.topic or '').lower()
            c = (note_obj.content or '').lower()
            if search_query not in t and search_query not in c:
                continue
        results_notes.append(note_obj)

    return render_template('notes.html', subjects=subjects_list, notes=results_notes,
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
    desc = data.get('description', '').strip()
    icon = data.get('icon', 'fa-book')
    color = data.get('color', 'primary')

    if not name or not code:
        return jsonify({'success': False, 'message': 'Subject name and code are required.'}), 400

    if db_subjects.find_one({'code': code}):
        return jsonify({'success': False, 'message': 'Subject code already exists.'}), 400

    sub_id = get_next_id(db_subjects)
    sub_doc = {
        'id': sub_id,
        'name': name,
        'code': code,
        'description': desc,
        'icon': icon,
        'color': color
    }
    db_subjects.insert_one(sub_doc)
    return jsonify({'success': True, 'subject_id': sub_id, 'message': 'Subject created successfully.'})

@app.route('/api/notes/create', methods=['POST'])
@login_required
@teacher_required
def create_note_api():
    data = request.get_json() or {}
    subject_id = data.get('subject_id')
    unit_number = data.get('unit_number', 1)
    topic = data.get('topic', '').strip()
    content = data.get('content', '').strip()

    if not subject_id or not topic or not content:
        return jsonify({'success': False, 'message': 'Subject, topic, and content are required.'}), 400

    unit_doc = db_units.find_one({'subject_id': int(subject_id), 'unit_number': int(unit_number)})
    if not unit_doc:
        unit_id = get_next_id(db_units)
        unit_doc = {
            'id': unit_id,
            'subject_id': int(subject_id),
            'unit_number': int(unit_number),
            'title': f'Unit {unit_number}: Subject Module',
            'description': 'Course content module'
        }
        db_units.insert_one(unit_doc)
    else:
        unit_id = unit_doc.get('id', unit_doc.get('_id'))

    note_id = get_next_id(db_notes)
    user = get_current_user()
    note_doc = {
        'id': note_id,
        'unit_id': unit_id,
        'topic': topic,
        'content': content,
        'author_id': user.id,
        'created_at': datetime.utcnow()
    }
    db_notes.insert_one(note_doc)
    return jsonify({'success': True, 'note_id': note_id, 'message': 'Study note uploaded successfully.'})

# -----------------------------------------------------------------------------
# EXAM MANAGEMENT & PROCTORING ROUTES
# -----------------------------------------------------------------------------

@app.route('/exams')
@login_required
def exams():
    user = get_current_user()
    subjects_list = [SubjectDoc(d) for d in db_subjects.find()]

    if user.role == 'teacher':
        exam_docs = db_exam_codes.find({'created_by': user.id})
        exams_list = [ExamDoc(d) for d in exam_docs]
    else:
        exam_docs = db_exam_codes.find({'status': 'active'})
        exams_list = [ExamDoc(d) for d in exam_docs]

    return render_template('exams.html', exams=exams_list, subjects=subjects_list)

@app.route('/join-exam')
@app.route('/join_exam')
@login_required
def join_exam():
    return redirect(url_for('exams'))


@app.route('/exams/create', methods=['GET', 'POST'])
@login_required
@teacher_required
def create_exam():
    subjects_list = [SubjectDoc(d) for d in db_subjects.find()]
    
    if request.method == 'POST':
        title = request.form.get('title')
        subject_id = int(request.form.get('subject_id'))
        description = request.form.get('description')
        duration_minutes = int(request.form.get('duration_minutes', 60))
        total_marks = int(request.form.get('total_marks', 50))
        passing_marks = int(request.form.get('passing_marks', 20))
        instructions = request.form.get('instructions')

        subj = db_subjects.find_one({'id': subject_id})
        subject_code = subj.get('code', 'PY') if subj else 'PY'
        exam_code = generate_exam_code(subject_code)

        user = get_current_user()
        exam_id = get_next_id(db_exam_codes)
        exam_doc = {
            'id': exam_id,
            'exam_code': exam_code,
            'title': title,
            'subject_id': subject_id,
            'description': description,
            'duration_minutes': duration_minutes,
            'total_marks': total_marks,
            'passing_marks': passing_marks,
            'instructions': instructions or '1. Mandatory camera monitoring active.\n2. Screen sharing is optional.',
            'created_by': user.id,
            'status': 'active',
            'created_at': datetime.utcnow()
        }
        db_exam_codes.insert_one(exam_doc)

        # Questions
        question_texts = request.form.getlist('question_text[]')
        option_as = request.form.getlist('option_a[]')
        option_bs = request.form.getlist('option_b[]')
        option_cs = request.form.getlist('option_c[]')
        option_ds = request.form.getlist('option_d[]')
        correct_options = request.form.getlist('correct_option[]')
        marks_list = request.form.getlist('marks[]')

        for i in range(len(question_texts)):
            if question_texts[i].strip():
                qid = get_next_id(db_questions)
                db_questions.insert_one({
                    'id': qid,
                    'exam_id': exam_id,
                    'question_type': 'mcq',
                    'question_text': question_texts[i].strip(),
                    'option_a': option_as[i] if i < len(option_as) else '',
                    'option_b': option_bs[i] if i < len(option_bs) else '',
                    'option_c': option_cs[i] if i < len(option_cs) else '',
                    'option_d': option_ds[i] if i < len(option_ds) else '',
                    'correct_option': correct_options[i] if i < len(correct_options) else 'A',
                    'marks': int(marks_list[i]) if i < len(marks_list) and marks_list[i] else 5
                })

        flash(f'Exam created successfully! Share Code: {exam_code}', 'success')
        return redirect(url_for('exams'))

    return render_template('create_exam.html', subjects=subjects_list)

@app.route('/exams/<int:exam_id>/end', methods=['POST'])
@login_required
@teacher_required
def end_exam(exam_id):
    db_exam_codes.update_one({'id': exam_id}, {'$set': {'status': 'completed'}})
    flash('Exam status updated to completed.', 'success')
    return redirect(url_for('dashboard'))

@app.route('/api/exams/enter_code', methods=['POST'])
@login_required
def enter_exam_code_api():
    data = request.get_json() or {}
    code = data.get('exam_code', '').strip().upper()
    if not code:
        return jsonify({'success': False, 'message': 'Exam code is required.'}), 400

    exam_data = db_exam_codes.find_one({'exam_code': code})
    if not exam_data:
        return jsonify({'success': False, 'message': 'Invalid exam code.'}), 404

    exam = ExamDoc(exam_data)
    if exam.status != 'active':
        return jsonify({'success': False, 'message': 'This exam is not active.'}), 400

    return jsonify({
        'success': True,
        'redirect_url': url_for('take_exam', exam_id=exam.id),
        'exam': {
            'id': exam.id,
            'exam_code': exam.exam_code,
            'title': exam.title,
            'duration_minutes': exam.duration_minutes,
            'total_marks': exam.total_marks
        }
    })

@app.route('/exam/<int:exam_id>')
@login_required
def take_exam(exam_id):
    exam_data = db_exam_codes.find_one({'id': exam_id})
    if not exam_data:
        flash('Exam not found.', 'danger')
        return redirect(url_for('dashboard'))

    exam = ExamDoc(exam_data)
    user = get_current_user()

    existing_attempt = db_exam_attempts.find_one({'exam_id': exam.id, 'student_id': user.id, 'status': 'completed'})
    if existing_attempt:
        flash('You have already completed this exam.', 'warning')
        return redirect(url_for('exam_results', attempt_id=existing_attempt.get('id', 1)))

    q_docs = db_questions.find({'exam_id': exam.id})
    questions_list = [MongoDoc(q) for q in q_docs]

    attempt_id = get_next_id(db_exam_attempts)
    new_attempt = {
        'id': attempt_id,
        'exam_id': exam.id,
        'student_id': user.id,
        'start_time': datetime.utcnow(),
        'status': 'in_progress'
    }
    db_exam_attempts.insert_one(new_attempt)

    return render_template('take_exam.html', exam=exam, questions=questions_list, attempt=MongoDoc(new_attempt))

@app.route('/api/exams/submit', methods=['POST'])
@login_required
def submit_exam():
    data = request.get_json() or {}
    exam_id = data.get('exam_id')
    answers_data = data.get('answers', {})

    user = get_current_user()
    exam_data = db_exam_codes.find_one({'id': int(exam_id)}) if exam_id else None
    if not exam_data:
        return jsonify({'success': False, 'message': 'Exam not found'}), 404

    exam = ExamDoc(exam_data)
    q_docs = db_questions.find({'exam_id': exam.id})
    questions_list = [MongoDoc(q) for q in q_docs]

    total_obtained = 0
    for q in questions_list:
        qid_str = str(q.id)
        selected_opt = answers_data.get(qid_str, '').upper()
        if selected_opt == (q.correct_option or '').upper():
            total_obtained += (q.marks or 1)

    is_passed = total_obtained >= (exam.passing_marks or 0)
    percentage = round((total_obtained / (exam.total_marks or 1)) * 100, 1)

    attempt_id = get_next_id(db_exam_attempts)
    attempt_doc = {
        'id': attempt_id,
        'exam_id': exam.id,
        'student_id': user.id,
        'start_time': datetime.utcnow() - timedelta(minutes=10),
        'end_time': datetime.utcnow(),
        'score': total_obtained,
        'is_passed': is_passed,
        'status': 'completed'
    }
    db_exam_attempts.insert_one(attempt_doc)

    result_id = get_next_id(db_results)
    result_doc = {
        'id': result_id,
        'attempt_id': attempt_id,
        'exam_id': exam.id,
        'student_id': user.id,
        'score': total_obtained,
        'total_marks': exam.total_marks,
        'percentage': percentage,
        'is_passed': is_passed,
        'created_at': datetime.utcnow()
    }
    db_results.insert_one(result_doc)

    return jsonify({
        'success': True,
        'attempt_id': attempt_id,
        'score': total_obtained,
        'total_marks': exam.total_marks,
        'percentage': percentage,
        'is_passed': is_passed,
        'redirect_url': url_for('exam_results', attempt_id=attempt_id)
    })

@app.route('/results/<int:attempt_id>')
@login_required
def exam_results(attempt_id):
    att_data = db_exam_attempts.find_one({'id': attempt_id})
    if not att_data:
        flash('Attempt results not found.', 'danger')
        return redirect(url_for('dashboard'))

    attempt = ExamAttemptDoc(att_data)
    exam = attempt.exam
    q_docs = db_questions.find({'exam_id': exam.id}) if exam else []
    questions_list = [MongoDoc(q) for q in q_docs]

    return render_template('results.html', attempt=attempt, exam=exam, questions=questions_list)

@app.route('/monitoring')
@login_required
@teacher_required
def monitoring():
    user = get_current_user()
    my_exams = [ExamDoc(d) for d in db_exam_codes.find({'created_by': user.id})]
    attempts = [ExamAttemptDoc(d) for d in db_exam_attempts.find()]
    return render_template('monitoring.html', my_exams=my_exams, attempts=attempts)

# -----------------------------------------------------------------------------
# GOOGLE MEET-STYLE LIVE CLASSROOM ROUTES
# -----------------------------------------------------------------------------

@app.route('/classes')
@login_required
def online_classes():
    user = get_current_user()
    subjects_list = [SubjectDoc(d) for d in db_subjects.find()]

    if user.role == 'teacher':
        class_docs = db_live_classes.find({'teacher_id': user.id})
    else:
        class_docs = db_live_classes.find()

    classes_list = [OnlineClassDoc(d) for d in class_docs]
    return render_template('online_class.html', classes=classes_list, subjects=subjects_list)

@app.route('/classes/create', methods=['POST'])
@app.route('/api/classes/create', methods=['POST'])
@login_required
@teacher_required
def create_online_class():
    data = request.get_json() if request.is_json else request.form
    subject_id = data.get('subject_id')
    title = data.get('title', '').strip()
    duration_minutes = data.get('duration_minutes', 60)

    if not subject_id or not title:
        if request.is_json:
            return jsonify({'success': False, 'message': 'Subject and Title are required.'}), 400
        flash('Subject and Title are required.', 'danger')
        return redirect(url_for('online_classes'))

    user = get_current_user()
    cls_id = get_next_id(db_live_classes)
    cls_doc = {
        'id': cls_id,
        'subject_id': int(subject_id),
        'title': title,
        'teacher_id': user.id,
        'scheduled_at': datetime.utcnow(),
        'duration_minutes': int(duration_minutes),
        'status': 'live'
    }
    db_live_classes.insert_one(cls_doc)

    if request.is_json:
        return jsonify({
            'success': True,
            'class_id': cls_id,
            'redirect_url': url_for('live_classroom', class_id=cls_id),
            'message': 'Live Classroom launched successfully!'
        })

    flash('Live Classroom launched successfully!', 'success')
    return redirect(url_for('live_classroom', class_id=cls_id))


@app.route('/live-class/<int:class_id>')
@login_required
def live_classroom(class_id):
    cls_data = db_live_classes.find_one({'id': class_id})
    if not cls_data:
        flash('Live Classroom session not found.', 'danger')
        return redirect(url_for('online_classes'))

    classroom = OnlineClassDoc(cls_data)
    user = get_current_user()

    # Create attendance / participant record if student joins
    if user.role == 'student':
        att = db_attendance.find_one({'class_id': class_id, 'student_id': user.id})
        if not att:
            db_attendance.insert_one({
                'id': get_next_id(db_attendance),
                'class_id': class_id,
                'student_id': user.id,
                'status': 'active',
                'camera_status': 'off',
                'microphone_status': 'off',
                'screen_status': 'off',
                'hand_raised': False,
                'is_speaking': False,
                'last_activity': datetime.utcnow()
            })

    p_docs = db_attendance.find({'class_id': class_id})
    participants = [ClassParticipantDoc(p) for p in p_docs]
    m_docs = db_chat_messages.find({'class_id': class_id})
    messages = [ChatMessageDoc(m) for m in m_docs]

    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:5000"

    return render_template('live_classroom.html',
                           classroom=classroom,
                           participants=participants,
                           messages=messages,
                           local_ip=local_ip,
                           local_url=local_url)

@app.route('/api/live-class/<int:class_id>/status')
def live_class_status_api(class_id):
    cls_data = db_live_classes.find_one({'id': class_id})
    if not cls_data:
        return jsonify({'error': 'Classroom not found'}), 404

    classroom = OnlineClassDoc(cls_data)
    p_docs = db_attendance.find({'class_id': class_id})
    participants = [ClassParticipantDoc(p) for p in p_docs]
    m_docs = db_chat_messages.find({'class_id': class_id})
    messages = [ChatMessageDoc(m) for m in m_docs]

    p_data = []
    camera_on_count = 0
    mic_on_count = 0
    speaking_count = 0
    raised_hands_count = 0
    screen_sharing_count = 0
    raised_hands = []

    for p in participants:
        if p.camera_status == 'on': camera_on_count += 1
        if p.microphone_status == 'on': mic_on_count += 1
        if p.is_speaking: speaking_count += 1
        if p.hand_raised: raised_hands_count += 1
        if p.screen_status == 'on': screen_sharing_count += 1

        st = p.student
        sname = st.name if st else f"Student #{p.student_id}"

        p_data.append({
            'student_id': p.student_id,
            'student_name': sname,
            'status': p.status or 'active',
            'camera_status': p.camera_status or 'off',
            'microphone_status': p.microphone_status or 'off',
            'screen_status': p.screen_status or 'off',
            'hand_raised': bool(p.hand_raised),
            'is_speaking': bool(p.is_speaking),
            'last_activity': p.last_activity.strftime('%I:%M %p') if isinstance(p.last_activity, datetime) else ''
        })
        if p.hand_raised:
            raised_hands.append({'student_id': p.student_id, 'student_name': sname})

    m_data = []
    for m in messages:
        snd = m.sender
        sname = snd.name if snd else f"User #{m.sender_id}"
        ts = m.timestamp.strftime('%I:%M %p') if isinstance(m.timestamp, datetime) else ''
        m_data.append({'sender_name': sname, 'message': m.message, 'timestamp': ts})

    teacher = classroom.teacher
    tname = teacher.name if teacher else 'Teacher'

    return jsonify({
        'class_id': classroom.id,
        'title': classroom.title,
        'teacher_id': classroom.teacher_id,
        'teacher_name': tname,
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

@app.route('/api/live-class/<int:class_id>/update-status', methods=['POST'])
@login_required
def live_class_update_status_api(class_id):
    data = request.get_json() or {}
    user = get_current_user()

    camera_status = data.get('camera_status')
    mic_status = data.get('microphone_status')
    screen_status = data.get('screen_status')
    hand_raised = data.get('hand_raised')
    is_speaking = data.get('is_speaking')
    chat_msg = data.get('chat_message')

    att = db_attendance.find_one({'class_id': class_id, 'student_id': user.id})
    if not att:
        att_id = get_next_id(db_attendance)
        att = {
            'id': att_id,
            'class_id': class_id,
            'student_id': user.id,
            'status': 'active',
            'camera_status': 'off',
            'microphone_status': 'off',
            'screen_status': 'off',
            'hand_raised': False,
            'is_speaking': False,
            'last_activity': datetime.utcnow()
        }
        db_attendance.insert_one(att)

    updates = {'last_activity': datetime.utcnow()}
    if camera_status is not None: updates['camera_status'] = camera_status
    if mic_status is not None: updates['microphone_status'] = mic_status
    if screen_status is not None: updates['screen_status'] = screen_status
    if hand_raised is not None: updates['hand_raised'] = bool(hand_raised)
    if is_speaking is not None: updates['is_speaking'] = bool(is_speaking)

    db_attendance.update_one({'class_id': class_id, 'student_id': user.id}, {'$set': updates})

    if chat_msg and chat_msg.strip():
        msg_id = get_next_id(db_chat_messages)
        db_chat_messages.insert_one({
            'id': msg_id,
            'class_id': class_id,
            'sender_id': user.id,
            'message': chat_msg.strip(),
            'timestamp': datetime.utcnow()
        })

    return jsonify({'success': True, 'message': 'Status updated successfully'})

# -----------------------------------------------------------------------------
# WEBRTC SIGNALING ENDPOINTS
# -----------------------------------------------------------------------------

@app.route('/api/webrtc/signaling', methods=['GET', 'POST'])
@login_required
def webrtc_signaling():
    user = get_current_user()
    if request.method == 'POST':
        data = request.get_json() or {}
        action = data.get('action')
        class_id = data.get('class_id')
        to_user_id = data.get('to_user_id') or data.get('target_user_id')
        payload = data.get('data') or data.get('payload') or data

        sig_id = get_next_id(db_webrtc_signals)
        sig_doc = {
            'id': sig_id,
            'class_id': int(class_id) if class_id else 1,
            'from_user_id': user.id,
            'to_user_id': int(to_user_id) if to_user_id else None,
            'action': action,
            'payload': json.dumps(payload),
            'timestamp': datetime.utcnow()
        }
        db_webrtc_signals.insert_one(sig_doc)
        return jsonify({'success': True, 'signal_id': sig_id})
    else:
        class_id = request.args.get('class_id', type=int, default=1)
        signals_data = db_webrtc_signals.find({'class_id': class_id})
        my_signals = []
        for s in signals_data:
            if s.get('to_user_id') == user.id or s.get('to_user_id') is None:
                if s.get('from_user_id') != user.id:
                    my_signals.append({
                        'id': s.get('id'),
                        'from_user_id': s.get('from_user_id'),
                        'to_user_id': s.get('to_user_id'),
                        'action': s.get('action'),
                        'payload': s.get('payload'),
                        'timestamp': s.get('timestamp').strftime('%H:%M:%S') if isinstance(s.get('timestamp'), datetime) else ''
                    })
        return jsonify({'success': True, 'signals': my_signals})

@app.route('/viewboard')
def viewboard():
    return render_template('viewboard.html')

# -----------------------------------------------------------------------------
# MONODB DATABASE SEEDING & INITIALIZATION
# -----------------------------------------------------------------------------

def seed_database():
    if db_users.count_documents() > 0:
        return

    print("[MongoDB] Seeding database with initial users, subjects, exam codes, and live classes...")

    # Teacher user
    t_id = get_next_id(db_users)
    t_hash = generate_password_hash('teacher123')
    db_users.insert_one({
        'id': t_id,
        'name': 'Mr. Ahmed',
        'email': 'teacher@platform.com',
        'password_hash': t_hash,
        'role': 'teacher',
        'created_at': datetime.utcnow()
    })
    db_teachers.insert_one({
        'id': get_next_id(db_teachers),
        'user_id': t_id,
        'department': 'Computer Science',
        'designation': 'Senior Professor'
    })

    # Student 1
    s1_id = get_next_id(db_users)
    s1_hash = generate_password_hash('student123')
    db_users.insert_one({
        'id': s1_id,
        'name': 'Rahul Kumar',
        'email': 'student@platform.com',
        'password_hash': s1_hash,
        'role': 'student',
        'created_at': datetime.utcnow()
    })
    db_students.insert_one({
        'id': get_next_id(db_students),
        'user_id': s1_id,
        'roll_number': 'CS2026-101',
        'grade_level': 'B.Tech CSE Year 3',
        'department': 'Computer Science & Engineering'
    })

    # Student 2
    s2_id = get_next_id(db_users)
    s2_hash = generate_password_hash('student123')
    db_users.insert_one({
        'id': s2_id,
        'name': 'Aisha Khan',
        'email': 'aisha@platform.com',
        'password_hash': s2_hash,
        'role': 'student',
        'created_at': datetime.utcnow()
    })
    db_students.insert_one({
        'id': get_next_id(db_students),
        'user_id': s2_id,
        'roll_number': 'CS2026-102',
        'grade_level': 'B.Tech CSE Year 3',
        'department': 'Computer Science & Engineering'
    })

    # Student 3
    s3_id = get_next_id(db_users)
    s3_hash = generate_password_hash('student123')
    db_users.insert_one({
        'id': s3_id,
        'name': 'Mohammed Ali',
        'email': 'ali@platform.com',
        'password_hash': s3_hash,
        'role': 'student',
        'created_at': datetime.utcnow()
    })
    db_students.insert_one({
        'id': get_next_id(db_students),
        'user_id': s3_id,
        'roll_number': 'CS2026-103',
        'grade_level': 'B.Tech CSE Year 3',
        'department': 'Computer Science & Engineering'
    })

    # Subjects
    subjects_list = [
        ('Python Programming', 'CS301', 'Core Python, OOP, Flask, and Web APIs', 'fa-brands fa-python', 'primary'),
        ('Java Enterprise Edition', 'CS302', 'OOP, Spring Boot, and Enterprise Tech', 'fa-brands fa-java', 'danger'),
        ('Database Management Systems', 'CS303', 'SQL, Relational Modeling, and Indexing', 'fa-solid fa-database', 'info'),
        ('Computer Networks', 'CS304', 'TCP/IP Stack, Routing, and Protocols', 'fa-solid fa-network-wired', 'warning'),
        ('Web Development', 'CS305', 'HTML5, CSS3, JavaScript, and Frontend Frameworks', 'fa-solid fa-code', 'success'),
        ('Data Structures & Algorithms', 'CS306', 'Trees, Graphs, Sorting, and Dynamic Programming', 'fa-solid fa-diagram-project', 'secondary'),
        ('Artificial Intelligence', 'CS307', 'Machine Learning, Neural Networks, and NLP', 'fa-solid fa-brain', 'primary')
    ]

    inserted_subjs = []
    for name, code, desc, icon, color in subjects_list:
        sub_id = get_next_id(db_subjects)
        sdoc = {'id': sub_id, 'name': name, 'code': code, 'description': desc, 'icon': icon, 'color': color}
        db_subjects.insert_one(sdoc)
        inserted_subjs.append(sdoc)

    # Units & Notes
    u_id = get_next_id(db_units)
    db_units.insert_one({
        'id': u_id,
        'subject_id': inserted_subjs[0]['id'],
        'unit_number': 1,
        'title': 'Unit 1: Python Basics & OOP',
        'description': 'Syntax, classes, decorators'
    })

    n_id = get_next_id(db_notes)
    db_notes.insert_one({
        'id': n_id,
        'unit_id': u_id,
        'topic': 'Python Decorators & Generators',
        'content': 'Decorators modify functions. Generators yield values memory-efficiently.',
        'author_id': t_id,
        'created_at': datetime.utcnow()
    })

    # Exam Code & Exam
    e_id = get_next_id(db_exam_codes)
    exam_doc = {
        'id': e_id,
        'exam_code': 'PY7K92X',
        'title': 'Python Examination',
        'subject_id': inserted_subjs[0]['id'],
        'description': 'Comprehensive examination covering Python syntax and web programming.',
        'duration_minutes': 60,
        'total_marks': 50,
        'passing_marks': 20,
        'instructions': '1. Mandatory camera monitoring active.\n2. Screen sharing is optional.',
        'created_by': t_id,
        'status': 'active',
        'created_at': datetime.utcnow()
    }
    db_exam_codes.insert_one(exam_doc)

    q_id = get_next_id(db_questions)
    db_questions.insert_one({
        'id': q_id,
        'exam_id': e_id,
        'question_type': 'mcq',
        'question_text': 'What is Python?',
        'option_a': 'Programming Language',
        'option_b': 'Operating System',
        'option_c': 'Database',
        'option_d': 'Web Browser',
        'correct_option': 'A',
        'marks': 10
    })

    # Live Class
    cls_id = get_next_id(db_live_classes)
    cls_doc = {
        'id': cls_id,
        'subject_id': inserted_subjs[0]['id'],
        'title': 'Python Programming Live Lecture',
        'teacher_id': t_id,
        'scheduled_at': datetime.utcnow(),
        'duration_minutes': 60,
        'status': 'live'
    }
    db_live_classes.insert_one(cls_doc)

    # Attendance
    db_attendance.insert_one({
        'id': get_next_id(db_attendance),
        'class_id': cls_id,
        'student_id': s1_id,
        'status': 'active',
        'camera_status': 'on',
        'microphone_status': 'off',
        'screen_status': 'off',
        'hand_raised': True,
        'is_speaking': False,
        'last_activity': datetime.utcnow()
    })
    db_attendance.insert_one({
        'id': get_next_id(db_attendance),
        'class_id': cls_id,
        'student_id': s2_id,
        'status': 'active',
        'camera_status': 'off',
        'microphone_status': 'off',
        'screen_status': 'off',
        'hand_raised': False,
        'is_speaking': False,
        'last_activity': datetime.utcnow()
    })

    # Chat Messages
    db_chat_messages.insert_one({
        'id': get_next_id(db_chat_messages),
        'class_id': cls_id,
        'sender_id': s1_id,
        'message': 'Sir, can you explain question 3?',
        'timestamp': datetime.utcnow()
    })
    db_chat_messages.insert_one({
        'id': get_next_id(db_chat_messages),
        'class_id': cls_id,
        'sender_id': t_id,
        'message': 'Yes, I will explain it now.',
        'timestamp': datetime.utcnow()
    })

    print("[MongoDB] Seeding completed successfully!")

# Auto-seed database if empty
seed_database()

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5000, debug=True)
