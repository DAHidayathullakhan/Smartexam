const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  class_id: { type: Number, required: true },
  student_id: { type: Number, required: true },
  status: { type: String, default: 'active' },
  camera_status: { type: String, default: 'off' },
  microphone_status: { type: String, default: 'off' },
  screen_status: { type: String, default: 'off' },
  hand_raised: { type: Boolean, default: false },
  is_speaking: { type: Boolean, default: false },
  last_activity: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
