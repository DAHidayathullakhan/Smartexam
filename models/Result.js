const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  attempt_id: { type: Number, required: true },
  exam_id: { type: Number, required: true },
  student_id: { type: Number, required: true },
  score: { type: Number, default: 0 },
  total_marks: { type: Number, default: 50 },
  percentage: { type: Number, default: 0 },
  is_passed: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Result || mongoose.model('Result', ResultSchema);
