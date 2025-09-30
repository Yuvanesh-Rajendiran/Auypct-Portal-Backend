const express = require('express'); 
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

/* ******************** comment when local host ******************** */

//Middleware

const corsOptions = {
  origin: 'https://auypct-portal-frontend.vercel.app',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // If you need cookies/auth
};
app.use(cors(corsOptions));

/* ******************** comment when local host ******************** */

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For form data parsing

// Serve uploads for file viewing (local storage)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ******************** for local host ******************** */

// Serve frontend static files (fallback for assets like CSS/JS if added later)
// app.use(express.static(path.join(__dirname, '../Auypct-Portal-Frontend')));

// // Explicit routes for HTML pages (ensures navigation works)
// app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/index.html')));
// app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/index.html')));
// app.get('/track.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/track.html')));
// app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/admin.html')));
// app.get('/trustee.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/trustee.html')));
// app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '../Auypct-Portal-Frontend/login.html')));

/* ******************** for local host ******************** */


// API routes (focus on backend functionality)
app.use('/api/users', require('./routes/users'));
app.use('/api/applications', require('./routes/applications'));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Custom 404 handler for API routes
app.use((err, req, res, next) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, error: 'API endpoint not found' });
    } else {
        res.status(404).send('Page not found');
    }
});

// Bind to Render's PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
  console.log('API endpoints: /api/users, /api/applications');
  console.log('File uploads: /uploads');
});

// Export app for Render compatibility (though listen is now included)
module.exports = app;