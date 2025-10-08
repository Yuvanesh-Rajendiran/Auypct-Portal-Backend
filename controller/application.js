// controller/application.js
const Application = require('../models/Application');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const fetch = require('node-fetch');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun } = require('docx');

console.log("🔑 Brevo API Key Loaded:", process.env.BREVO_API_KEY ? 'YES (redacted)' : 'NO - EMPTY!');

// Helper functions
function formatField(key, value) {
  const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return { key: formattedKey, value: value || '' };
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  } catch {
    return 'N/A';
  }
}

async function sendBrevoEmail(to, subject, html, attachments = [], senderEmail = process.env.EMAIL_FROM || 'yuvaneshr2002@gmail.com') {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.error("❌ Brevo API key missing!"); return; }

  const attachmentParams = attachments.map(att => ({
    name: att.filename,
    content: att.content.toString('base64')
  }));

  const emailPayload = {
    sender: { email: senderEmail, name: 'AUYPCT Portal' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    attachment: attachmentParams
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify(emailPayload)
  });

  if (!response.ok) {
    const err = await response.json();
    console.error(`❌ Failed to send to ${to}:`, err.message || response.statusText);
  } else {
    const info = await response.json();
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
  }
}

// ---------------- Controller Function ----------------
exports.submitApplication = async (req, res) => {
  try {
    // 1️⃣ Sanitize input data
    const applicantDetails = {};
    for (const key in req.body) {
      if (key === 'captcha-answer') continue;
      let value = sanitizeHtml(req.body[key], { allowedTags: [], allowedAttributes: {} });
      if (key === 'dob') value = formatDate(value);
      applicantDetails[key] = value;
    }

    // 2️⃣ Create unique tracking ID
    const trackingId = 'APP-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // 3️⃣ Handle uploaded files
    const files = req.files || {};
    const documents = [];
    let photoPath = null;
    for (const field in files) {
      if (field === 'passport_photo' && files[field].length > 0)
        photoPath = files[field][0].path;

      files[field].forEach(file => {
        documents.push({ name: field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), path: file.path });
      });
    }

    // 4️⃣ Save new application
    const newApp = new Application({ trackingId, applicantDetails, documents, photoPath, status: 'Submitted', createdAt: new Date() });
    await newApp.save();

    // 5️⃣ Create docx
    const formattedDetails = Object.fromEntries(Object.entries(applicantDetails).map(([key, value]) => {
      const { key: formattedKey } = formatField(key, value);
      return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
    }));

    let imageData = photoPath ? await fs.promises.readFile(photoPath) : null;
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun({ text: 'AUYPCT Scholarship Application', bold: true, size: 28, font: 'Arial' })] }),
          new Paragraph({ children: [new TextRun({ text: `Tracking ID: ${trackingId}`, size: 20, font: 'Arial' })] }),
          imageData ? new Paragraph({
            children: [new ImageRun({ data: imageData, transformation: { width: 100, height: 100 } })],
            alignment: 'center'
          }) : null
        ].filter(Boolean)
      }]
    });
    const buffer = await Packer.toBuffer(doc);

    // 6️⃣ Compose email
    const appUrl = process.env.APP_URL || 'https://auypct-portal-backend.onrender.com';
    const currentDateTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const applicantHtml = `<h2>Thank you for applying! Tracking ID: ${trackingId}</h2><p>Submitted on: ${currentDateTime}</p>`;
    const adminHtml = `<h2>New Scholarship Application ID: ${trackingId}</h2><p>Submitted on: ${currentDateTime}</p>`;

    await sendBrevoEmail(applicantDetails.email_id, `AUYPCT Application - ID: ${trackingId}`, applicantHtml, [{ filename: `app_${trackingId}.docx`, content: buffer }]);
    await sendBrevoEmail('yuvaneshr2002@gmail.com', 'New Scholarship Form Received', adminHtml, [{ filename: `app_${trackingId}.docx`, content: buffer }]);

    // 7️⃣ Final response
    res.status(200).json({ success: true, trackingId, message: 'Application submitted successfully' });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({ success: false, error: `Submission failed: ${err.message}` });
  }
};

// ---------------------------------------------------------------------------
// DASHBOARD - overview of all applications
// ---------------------------------------------------------------------------
exports.getDashboard = async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });
    console.log('Fetched applications count:', applications.length);

    if (!applications || applications.length === 0) {
      console.log('No applications found');
      return res.status(200).json({ success: true, overview: [] });
    }

    const formatDate = d => (d ? new Date(d).toLocaleDateString('en-GB').replace(/\//g, '-') : 'N/A');

    const overview = applications.map(app => {
      const d = app.applicantDetails || {};
      return {
        trackingId: app.trackingId,
        applicantName: d.applicant_name || 'Unknown',
        status: app.status || 'Pending',
        submittedDate: formatDate(app.createdAt),
        photo: app.photoPath || null,
        keyDetails: {
          applicantType: d.applicant_type || 'N/A',
          contactNumber: d.contact_number || 'N/A',
          requestCategory: d.request_category || 'N/A'
        }
      };
    });

    console.log('Dashboard retrieved');
    res.json({ success: true, overview });
  } catch (error) {
    console.error('Dashboard error:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ---------------------------------------------------------------------------
// APPLICATION DETAILS BY TRACKING ID
// ---------------------------------------------------------------------------
exports.getApplicationDetails = async (req, res) => {
  try {
    const trackingId = req.params.trackingId;

    if (!trackingId) {
      return res.status(400).json({ success: false, error: 'Missing tracking ID' });
    }

    console.log(`Fetching application with trackingId: ${trackingId}`);
    const application = await Application.findOne({ trackingId }).lean();

    if (!application) {
      console.log(`Application not found: ${trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // Safety conversion check
    let applicantDetails = application.applicantDetails || {};
    if (typeof applicantDetails !== 'object') applicantDetails = {};

    // Format for readability
    const formatField = (key, value) => ({ key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), value: value || '' });
    const formatDate = d => (d ? new Date(d).toLocaleDateString('en-GB').replace(/\//g, '-') : 'N/A');

    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
      })
    );

    const documents = Array.isArray(application.documents)
      ? application.documents.filter(doc => doc && doc.name && doc.path)
      : [];

    const details = {
      trackingId,
      applicantDetails: formattedDetails,
      documents,
      photo: application.photoPath || null,
      status: application.status || 'Pending',
      submittedDate: formatDate(application.createdAt)
    };

    console.log(`Returning details for ${trackingId}`);
    res.json({ success: true, details });
  } catch (error) {
    console.error(`Error fetching details for ${req.params.trackingId}:`, error.stack);
    res.status(500).json({ success: false, error: 'Failed to fetch details' });
  }
};

// ---------------------------------------------------------------------------
// TRACK APPLICATION STATUS
// ---------------------------------------------------------------------------
exports.trackApplication = async (req, res) => {
  try {
    const { trackingId } = req.params;
    console.log(`Tracking application: ${trackingId}`);

    // Find application
    const app = await Application.findOne({ trackingId }).lean();
    if (!app) {
      console.log(`Application not found for ${trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // Ensure applicant details are valid
    let applicantDetails = app.applicantDetails || {};
    if (typeof applicantDetails !== 'object' || applicantDetails === null) {
      applicantDetails = {};
    }

    // Format fields
    const formatField = (key, value) => ({ key: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), value: value || '' });
    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? value || 'N/A' : value || 'N/A'];
      })
    );

    // Compose response
    res.status(200).json({
      success: true,
      trackingId: app.trackingId,
      status: app.status || 'Pending',
      details: formattedDetails,
      documents: Array.isArray(app.documents) ? app.documents : []
    });
  } catch (err) {
    console.error(`Track application error for ${req.params.trackingId}:`, err.stack);
    res.status(500).json({ success: false, error: `Failed to track application: ${err.message}` });
  }
};

// ---------------------------------------------------------------------------
// UPDATE STATUS / BANK DETAILS / REVIEWER
// ---------------------------------------------------------------------------
exports.updateStatus = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { status = '', bankDetails, reviewedBy } = req.body;

    console.log(`Updating ${trackingId} → ${status}`);

    // Normalize to Title Case
    const normalized = status
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());

    const allowed = ['Submitted', 'Under Review', 'Eligible', 'Rejected', 'Funds Transferred'];

    if (!status || !allowed.includes(normalized)) {
      console.log(`Invalid status value: ${status}`);
      return res.status(400).json({ success: false, error: 'Invalid or missing status' });
    }

    const app = await Application.findOneAndUpdate(
      { trackingId },
      { status: normalized, bankDetails, reviewedBy },
      { new: true }
    );

    if (!app) {
      console.log(`Application not found for ${trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    console.log(`Status for ${trackingId} updated to ${normalized}`);
    res.status(200).json({ success: true, message: 'Status updated successfully' });
  } catch (err) {
    console.error(`Update status error for ${req.params.trackingId}:`, err.stack);
    res.status(500).json({ success: false, error: `Update failed: ${err.message}` });
  }
};