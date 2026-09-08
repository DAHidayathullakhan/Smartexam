const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  description: { type: String },
  icon: { type: String, default: 'fa-book' },
  color: { type: String, default: 'primary' }
});

module.exports = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);
