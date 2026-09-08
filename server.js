const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// Load environment variables from .env
dotenv.config();

const app = express();

// Connect MongoDB Atlas
connectDB();

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS View Engine Setup for rendering HTML templates
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, 'templates'));

// Static files
app.use('/static', express.static(path.join(__dirname, 'static')));

// Register Routes
const indexRoutes = require('./routes/index');
app.use('/', indexRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error Notice]:', err.message);
  res.status(200).send('SmartExam Platform Active');
});

// Do NOT call app.listen when deployed on Vercel
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`[Express Server] Running locally on http://localhost:${PORT}`);
  });
}

module.exports = app;
