const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register (for initial setup)
router.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed, role });
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth middleware
const auth = (req, res, next) => {
  let token = req.header('Authorization');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  // Handle 'Bearer' prefix
  if (token.startsWith('Bearer ')) {
    token = token.slice(7); // Remove 'Bearer ' prefix
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, role }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get applications (protected)
router.get('/applications', auth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'trustee') {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const apps = await require('../models/Application').find({}).sort({ createdAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;