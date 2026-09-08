const mongoose = require('mongoose');

const ExamCodeSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  exam_code: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  subject_id: { type: Number, required: true },
  description: { type: String },
  duration_minutes: { type: Number, default: 60 },
  total_marks: { type: Number, default: 50 },
  passing_marks: { type: Number, default: 20 },
  instructions: { type: String },
  created_by: { type: Number, required: true },
  status: { type: String, default: 'active' },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ExamCode || mongoose.model('ExamCode', ExamCodeSchema);
