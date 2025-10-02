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

/* COMMENTED: Nodemailer setup for fallback
// Nodemailer setup
const transporter = nodemailer.createTransporter({
  // host: "smtp.gmail.com",
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // true for port 465, false for 587
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
    // user: process.env.EMAIL_USER,
    // pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 50000,
  logger: true,   // log everything to console
  debug: true     // include SMTP traffic in logs
});
console.log("🔑 Brevo SMTP User Loaded:", process.env.BREVO_SMTP_USER ? 'YES' : 'NO');
console.log("🔑 Brevo SMTP Pass Loaded:", process.env.BREVO_SMTP_PASS ? 'YES (redacted)' : 'NO - EMPTY!');

// Verify SMTP connection at startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Brevo connection error:", error);  // Fixed typo
  } else {
    console.log("✅ Brevo server is ready to send messages");
  }
});
*/

// Brevo API key check (for logging)
console.log("🔑 Brevo API Key Loaded:", process.env.BREVO_API_KEY ? 'YES (redacted)' : 'NO - EMPTY!');

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
router.post('/submit', upload.fields([
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
]), async (req, res) => {
  try {
    // ---------- 1. Required field validation ----------
    // (Your commented validation code remains as-is)

    // ---------- 2. Input sanitization ----------
    const applicantDetails = {};
    for (const key in req.body) {
      if (key === 'captcha-answer') continue;
      let formattedValue = sanitizeHtml(req.body[key], { allowedTags: [], allowedAttributes: {} });
      if (key === 'dob') formattedValue = formatDate(formattedValue);
      applicantDetails[key] = formattedValue;
    }

    // ---------- 3. Format & validate email, phone, Aadhaar ----------
    // (Your commented validation code remains as-is)

    // ---------- 4. Tracking ID ----------
    const trackingId = 'APP-' + crypto.randomBytes(4).toString('hex').toUpperCase();

    // ---------- 5. File handling ----------
    const files = req.files || {};
    const documents = [];
    let photoPath = null;
    for (const field in files) {
      if (field === 'passport_photo' && files[field].length > 0) {
        photoPath = files[field][0].path;
      }
      files[field].forEach(file => {
        documents.push({
          name: field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          path: file.path
        });
      });
    }

    // ---------- 6. Required document validation ----------
    // (Your commented validation code remains as-is)

    // ---------- 7. Save application ----------
    const newApp = new Application({
      trackingId,
      applicantDetails,
      documents,
      photoPath,
      status: 'Submitted',
      createdAt: new Date()
    });
    await newApp.save();

    // ---------- 8. Generate docx ----------
    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
      })
    );

    let imageData = null;
    if (photoPath) {
      imageData = await fs.promises.readFile(photoPath);
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: 'AUYPCT Scholarship Application', bold: true, size: 28, font: 'Arial' })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: `Tracking ID: ${trackingId}`, size: 20, font: 'Arial' })], spacing: { after: 200 } }),
          imageData ? new Paragraph({
            children: [new ImageRun({ data: imageData, transformation: { width: 100, height: 100 } })],
            alignment: 'center',
            spacing: { after: 200 }
          }) : null,
          new Paragraph({ children: [new TextRun({ text: 'Applicant Details:', bold: true, size: 22, font: 'Arial' })], spacing: { after: 100 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Field', bold: true })] })], width: { size: 30, type: WidthType.PERCENTAGE } }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Value', bold: true })] })], width: { size: 70, type: WidthType.PERCENTAGE } })
                ]
              }),
              ...Object.entries(formattedDetails).map(([key, value]) => new TableRow({
                children: [new TableCell({ children: [new Paragraph({ text: key })] }), new TableCell({ children: [new Paragraph({ text: value.toString() })] })]
              }))
            ]
          }),
          new Paragraph({ children: [new TextRun({ text: 'Documents:', bold: true, size: 22, font: 'Arial' })], spacing: { before: 200, after: 100 } }),
          ...documents.map(doc => new Paragraph({ children: [new TextRun(`${doc.name}: ${doc.path}`)], spacing: { after: 100 } }))
        ].filter(child => child !== null)
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    // ---------- 9. Prepare email HTML ----------
    const appUrl = process.env.APP_URL || 'https://auypct-portal-backend.onrender.com';
    const currentDateTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Dynamic HTML for applicant (customize as needed)
    const applicantHtmlTable = `
      <html>
        <body>
          <h2>Thank you for applying! Your Tracking ID: ${trackingId}</h2>
          <p>Submitted on: ${currentDateTime}</p>
          <table border="1">
            ${Object.entries(formattedDetails).map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('')}
          </table>
          <p>Track status: <a href="${appUrl}/track/${trackingId}">${appUrl}/track/${trackingId}</a></p>
        </body>
      </html>
    `;

    // Dynamic HTML for admin/trustee
    const adminTrusteeHtmlTable = `
      <html>
        <body>
          <h2>New Scholarship Application - ID: ${trackingId}</h2>
          <p>Submitted on: ${currentDateTime}</p>
          <table border="1">
            ${Object.entries(formattedDetails).map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('')}
          </table>
          <h3>Documents:</h3>
          <ul>${documents.map(doc => `<li>${doc.name}: ${doc.path}</li>`).join('')}</ul>
        </body>
      </html>
    `;

    // ---------- 10. Send emails safely (via Brevo API) ----------
/* COMMENTED: SMTP verify for fallback
try {
  await transporter.verify();
  console.log("✅ Brevo SMTP verified successfully before sending email");
} catch (err) {
  console.error("❌ Brevo SMTP verification failed inside /submit:", err);
}
*/
    const emailFrom = process.env.EMAIL_FROM || 'yuvaneshr2002@gmail.com';

    try {
      // Send to applicant (API)
      try {
        await sendBrevoEmail(
          applicantDetails.email_id,
          `AUYPCT Application - ID: ${trackingId}`,
          applicantHtmlTable,
          [{ filename: `app_${trackingId}.docx`, content: buffer }]
        );
      } catch (err) {
        console.error("❌ Failed to send applicant email:", err);
      }

      // Send to admin (API)
      try {
        await sendBrevoEmail(
          'yuvaneshr2002@gmail.com',
          'New Scholarship Form Received - ID: ' + trackingId,
          adminTrusteeHtmlTable,
          [{ filename: `app_${trackingId}.docx`, content: buffer }]
        );
      } catch (err) {
        console.error("❌ Failed to send admin email:", err);
      }

      // Send to trustee (API)
      try {
        await sendBrevoEmail(
          // 'salhinasan@gmail.com',
          'New Scholarship Form Received - ID: ' + trackingId,
          adminTrusteeHtmlTable,
          [{ filename: `app_${trackingId}.docx`, content: buffer }]
        );
      } catch (err) {
        console.error("❌ Failed to send trustee email:", err);
      }

    } catch (emailErr) {
      console.error("❌ General email sending error:", emailErr.stack);
    }

    // ---------- 11. Final response ----------
    res.status(200).json({ success: true, trackingId, message: 'Application submitted successfully' });

  } catch (err) {
    console.error('Submission error:', err.stack);
    res.status(500).json({ success: false, error: `Submission failed: ${err.message}` });
  }
});

// Dashboard endpoint
router.get('/dashboard', async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });
    console.log('Fetched applications count:', applications.length);
    if (!applications || applications.length === 0) {
      console.log('No applications found');
      return res.status(200).json({ success: true, overview: [] });
    }
    const overview = applications.map(app => {
      const applicantDetails = app.applicantDetails || {};
      const applicantName = applicantDetails.applicant_name || 'Unknown';
      return {
        trackingId: app.trackingId,
        applicantName,
        status: app.status || 'Pending',
        submittedDate: formatDate(app.createdAt),
        photo: app.photoPath || null,
        keyDetails: {
          applicantType: applicantDetails.applicant_type || 'N/A',
          contactNumber: applicantDetails.contact_number || 'N/A',
          requestCategory: applicantDetails.request_category || 'N/A'
        }
      };
    });
    console.log('Dashboard overview:', overview);
    res.json({ success: true, overview });
  } catch (error) {
    console.error('Dashboard error:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detailed application endpoint
router.get('/application/:trackingId', async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    if (!trackingId || !/APP-[0-9A-F]{8}/i.test(trackingId)) {
      console.log(`Invalid trackingId format: ${trackingId}`);
      return res.status(400).json({ success: false, error: 'Invalid tracking ID format' });
    }

    console.log(`Fetching application with trackingId: ${trackingId}`);
    const application = await Application.findOne({ trackingId }).lean();
    if (!application) {
      console.log(`Application not found for trackingId: ${trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    console.log(`Raw application data:`, application);

    let applicantDetails = application.applicantDetails || {};
    if (typeof applicantDetails !== 'object' || applicantDetails === null) {
      console.warn(`Invalid applicantDetails for ${trackingId}:`, applicantDetails);
      applicantDetails = {};
    }

    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
      })
    );

    const documents = Array.isArray(application.documents) ? application.documents : [];
    const processedDocuments = documents.map(doc => {
      try {
        if (!doc || typeof doc !== 'object' || !doc.name || !doc.path) {
          console.warn(`Invalid document entry for ${trackingId}:`, doc);
          return null;
        }
        return { name: doc.name, path: doc.path };
      } catch (err) {
        console.error(`Error processing document for ${trackingId}:`, err);
        return null;
      }
    }).filter(doc => doc !== null);

    const details = {
      trackingId,
      applicantDetails: formattedDetails,
      documents: processedDocuments,
      photo: application.photoPath || null,
      status: application.status || 'Pending',
      submittedDate: formatDate(application.createdAt) || 'N/A',
      rawApplicantDetails: applicantDetails
    };
    console.log(`Returning details for ${trackingId}:`, details);
    res.json({ success: true, details });
  } catch (error) {
    console.error(`Critical error fetching application ${req.params.trackingId}:`, error.stack);
    res.status(500).json({ success: false, error: `Failed to fetch application: ${error.message}` });
  }
});

// Track application
router.get('/track/:trackingId', async (req, res) => {
  try {
    console.log(`Tracking application with trackingId: ${req.params.trackingId}`);
    const app = await Application.findOne({ trackingId: req.params.trackingId }).lean();
    console.log(`Found application:`, app);
    if (!app) {
      console.log(`Application not found for trackingId: ${req.params.trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    let applicantDetails = app.applicantDetails || {};
    if (typeof applicantDetails !== 'object' || applicantDetails === null) {
      console.warn(`Invalid applicantDetails for ${req.params.trackingId}:`, applicantDetails);
      applicantDetails = {};
    }

    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
      })
    );

    const documents = Array.isArray(app.documents) ? app.documents : [];
    console.log(`Documents:`, documents);

    res.status(200).json({
      success: true,
      trackingId: app.trackingId,
      status: app.status || 'Pending',
      details: formattedDetails,
      documents: documents
    });
  } catch (err) {
    console.error(`Track application error for ${req.params.trackingId}:`, err.stack);
    res.status(500).json({ success: false, error: `Failed to track application: ${err.message}` });
  }
});

// Status update endpoint
router.put('/application/:trackingId/status', async (req, res) => {
  try {
    const { status = '', bankDetails, reviewedBy } = req.body;
    console.log(`Received request body for ${req.params.trackingId}:`, req.body);

    // Normalize status to title case for consistent comparison
    const normalizedStatus = status
      .toLowerCase()
      .replace(/\b\w/g, char => char.toUpperCase());

    // Define allowed statuses
    const allowedStatuses = ['Submitted', 'Under Review', 'Eligible', 'Rejected', 'Funds Transferred'];
    if (!status || !allowedStatuses.includes(normalizedStatus)) {
      console.log(`Invalid status value: ${status} (normalized: ${normalizedStatus})`);
      return res.status(400).json({ success: false, error: 'Invalid or missing status' });
    }

    const app = await Application.findOne({ trackingId: req.params.trackingId });
    if (!app) {
      console.log(`Application not found for trackingId: ${req.params.trackingId}`);
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    // Update with normalized status
    await Application.findOneAndUpdate(
      { trackingId: req.params.trackingId },
      { status: normalizedStatus, bankDetails, reviewedBy }
    );

    console.log(`Status updated for ${req.params.trackingId} to ${normalizedStatus}`);
    res.status(200).json({ success: true, message: 'Status updated successfully' });
  } catch (err) {
    console.error(`Update status error for ${req.params.trackingId}:`, err.stack);
    res.status(500).json({ success: false, error: `Update failed: ${err.message}` });
  }
});

module.exports = router;