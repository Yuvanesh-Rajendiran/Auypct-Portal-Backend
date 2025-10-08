const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/connectionDB');

dotenv.config();

const app = express();

// Determine environment (default = development)
const isProduction = process.env.NODE_ENV === 'production';

// Middleware for CORS
if (isProduction) {
  // Production CORS (Frontend hosted remotely)
  app.use(cors({
    origin: 'https://auypct-portal-frontend.vercel.app',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  }));
} else {
  // Local development CORS
  app.use(cors({
    origin: 'http://localhost:5173',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ************************************
// ENV: DEVELOPMENT (local frontend support)
// ************************************
if (!isProduction) {
  // Serve frontend files if you run both locally
  app.use(express.static(path.join(__dirname, '../Auypct-Portal-Frontend')));

  // Explicit HTML routes for navigation fallback
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/html/index.html')));
  app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/index.html')));
  app.get('/track.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/track.html')));
  app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/admin.html')));
  app.get('/trustee.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/trustee.html')));
  app.get('/app.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/app.html')));
}

// Connect to MongoDB
connectDB();

// ******** API Routes ********
app.use('/api/users', require('./routes/user'));
app.use('/api/applications', require('./routes/application'));

// ******** Error + 404 Handling ********
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
  } else {
    res.status(404).send('Page not found');
  }
});

// Server startup
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running in ${isProduction ? 'production' : 'development'} mode`);
  console.log(`🌐 Listening at: http://localhost:${PORT}`);
  console.log('📍 API endpoints: /api/users, /api/applications');
  console.log('📂 File uploads: /uploads');
});

module.exports = app;