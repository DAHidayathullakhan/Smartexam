const mongoose = require('mongoose');

const LiveClassSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  subject_id: { type: Number, required: true },
  title: { type: String, required: true },
  teacher_id: { type: Number, required: true },
  scheduled_at: { type: Date, default: Date.now },
  duration_minutes: { type: Number, default: 60 },
  status: { type: String, default: 'live' }
});

module.exports = mongoose.models.LiveClass || mongoose.model('LiveClass', LiveClassSchema);
