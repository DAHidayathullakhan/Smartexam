const mongoose = require('mongoose');

const ExamAttemptSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  exam_id: { type: Number, required: true },
  student_id: { type: Number, required: true },
  start_time: { type: Date, default: Date.now },
  end_time: { type: Date },
  score: { type: Number, default: 0 },
  is_passed: { type: Boolean, default: false },
  status: { type: String, default: 'in_progress' }
});

module.exports = mongoose.models.ExamAttempt || mongoose.model('ExamAttempt', ExamAttemptSchema);
