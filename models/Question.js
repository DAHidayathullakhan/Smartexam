const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  exam_id: { type: Number, required: true },
  question_type: { type: String, default: 'mcq' },
  question_text: { type: String, required: true },
  option_a: { type: String },
  option_b: { type: String },
  option_c: { type: String },
  option_d: { type: String },
  correct_option: { type: String, required: true },
  marks: { type: Number, default: 5 }
});

module.exports = mongoose.models.Question || mongoose.model('Question', QuestionSchema);
