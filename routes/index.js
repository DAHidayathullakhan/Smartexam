const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const connectDB = require('../config/db');

router.get('/', async (req, res) => {
  try {
    await connectDB();

    const Subject = require('../models/Subject');
    const User = require('../models/User');
    const ExamCode = require('../models/ExamCode');
    const LiveClass = require('../models/LiveClass');

    const subjects = await Subject.find().lean().catch(() => []);
    const total_students = await User.countDocuments({ role: 'student' }).catch(() => 0);
    const total_exams = await ExamCode.countDocuments().catch(() => 0);
    const total_classes = await LiveClass.countDocuments().catch(() => 0);

    const indexPath = path.join(__dirname, '..', 'templates', 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.render('index.html', {
        subjects: subjects || [],
        stats: {
          students: total_students || 0,
          exams: total_exams || 0,
          classes: total_classes || 0
        },
        current_user: null,
        unread_notifications: [],
        local_ip: '127.0.0.1',
        local_url: 'http://127.0.0.1:5000'
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'SmartExam Platform API Active',
      stats: {
        students: total_students,
        exams: total_exams,
        classes: total_classes
      }
    });
  } catch (error) {
    console.error('[Homepage Route Error]:', error);
    res.status(200).send('SmartExam Platform Running');
  }
});

module.exports = router;
