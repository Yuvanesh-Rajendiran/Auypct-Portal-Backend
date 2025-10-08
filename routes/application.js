const express = require('express');
const router = express.Router();
const Application = require('../models/Application');
/* COMMENTED: Nodemailer for fallback
const nodemailer = require('nodemailer');
*/
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun } = require('docx');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const fetch = require('node-fetch');
const {
  submitApplication,
  getDashboard,
  getApplicationDetails,
  trackApplication,
  updateStatus
} = require('../controller/application');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config for local disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Brevo API send function (async, with attachments)
async function sendBrevoEmail(to, subject, html, attachments = [], senderEmail = process.env.EMAIL_FROM || 'yuvaneshr2002@gmail.com') {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("❌ Brevo API key missing!");
    return;
  }

  // Build attachment params (base64 for DOCX buffer)
  const attachmentParams = attachments.map(att => ({
    name: att.filename,
    content: att.content.toString('base64')  // Your buffer
  }));

  const emailPayload = {
    sender: { email: senderEmail, name: 'AUYPCT Portal' },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    attachment: attachmentParams
  };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(emailPayload)
    });

    if (response.ok) {
      const info = await response.json();
      console.log(`✅ Email sent to ${to}: ${info.messageId}`);
      return info;
    } else {
      const err = await response.json();
      console.error(`❌ Failed to send to ${to}: ${err.message || response.statusText}`);
      throw new Error(err.message);
    }
  } catch (err) {
    console.error(`❌ Brevo API error for ${to}:`, err.message);
    throw err;
  }
}

// Helper function to format field names and values
function formatField(key, value) {
  const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const formattedValue = value || '';
  return { key: formattedKey, value: formattedValue };
}

// Helper function to format dates
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).replace(/\//g, '-');
  } catch (err) {
    return 'N/A';
  }
}

// Helper function to reorder fields (optional, for display purposes only)
function reorderFields(applicantDetails) {
  const order = [
    'applicant_name', 'applicant_type', 'dob', 'gender', 'contact_number',
    'email_id', 'aadhaar_number', 'referral', 'scheme_awareness',
    'family_income_source', 'father_occupation', 'mother_occupation',
    'scholarship_justification', 'fee_breakup', 'requested_amount',
    'confirmed_amount', 'request_category'
  ];
  const reordered = { ...applicantDetails };
  return reordered;
}

// -------------------- Routes -------------------- //

// Submit route
router.post(
  '/submit',
  upload.fields([
    { name: 'passport_photo', maxCount: 1 },
    { name: 'educational_aadhaar', maxCount: 1 },
    { name: 'educational_passbook', maxCount: 1 },
    { name: 'educational_marksheet', maxCount: 1 },
    { name: 'educational_fee_receipt', maxCount: 1 },
    { name: 'educational_school_id', maxCount: 1 },
    { name: 'women_aadhaar', maxCount: 1 },
    { name: 'women_passbook', maxCount: 1 },
    { name: 'women_business_docs', maxCount: 10 },
    { name: 'entrepreneur_aadhaar', maxCount: 1 },
    { name: 'entrepreneur_passbook', maxCount: 1 },
    { name: 'entrepreneur_business_docs', maxCount: 10 },
    { name: 'medical_aadhaar', maxCount: 1 },
    { name: 'medical_passbook', maxCount: 1 },
    { name: 'medical_letter', maxCount: 1 },
    { name: 'medical_receipt', maxCount: 1 }
  ]),
  submitApplication
);

// Dashboard endpoint
router.get('/dashboard', getDashboard);

// Detailed application endpoint
router.get('/application/:trackingId', getApplicationDetails);

// Track application
router.get('/track/:trackingId', trackApplication);

// Status update endpoint
router.put('/application/:trackingId/status', updateStatus);

module.exports = router;