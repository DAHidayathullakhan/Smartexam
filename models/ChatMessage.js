const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  class_id: { type: Number, required: true },
  sender_id: { type: Number, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);
