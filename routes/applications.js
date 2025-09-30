const express = require('express');
const router = express.Router();
const Application = require('../models/Application');
const nodemailer = require('nodemailer');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ImageRun } = require('docx');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');

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

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

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
    const requiredFields = [
      { display: 'Applicant Name', key: 'applicant_name' },
      { display: 'Applicant Type', key: 'applicant_type' },
      { display: 'DOB', key: 'dob' },
      { display: 'Gender', key: 'gender' },
      { display: 'Contact Number', key: 'contact_number' },
      { display: 'Email Id', key: 'email_id' },
      { display: 'Aadhaar Number', key: 'aadhaar_number' },
      { display: 'Referral', key: 'referral' },
      { display: 'Scheme Awareness', key: 'scheme_awareness' },
      { display: 'Family Income Source', key: 'family_income_source' },
      { display: "Father's Occupation", key: 'father_occupation' },
      { display: "Mother's Occupation", key: 'mother_occupation' },
      { display: 'Scholarship Justification', key: 'scholarship_justification' },
      { display: 'Fee Breakup', key: 'fee_breakup' },
      // { display: 'Requested Amount', key: 'requested_amount' },
      { display: 'Confirmed Amount', key: 'confirmed_amount' },
      { display: 'Request Category', key: 'request_category' }
    ];

    const missingFields = requiredFields.filter(field => !req.body[field.key] || req.body[field.key].trim() === '');
    if (missingFields.length > 0) {
      return res.status(400).json({ success: false, error: `Missing required fields: ${missingFields.map(f => f.display).join(', ')}` });
    }

    const applicantDetails = {};
    for (const key in req.body) {
      if (key === 'captcha-answer') continue;
      let formattedValue = sanitizeHtml(req.body[key], { allowedTags: [], allowedAttributes: {} });
      if (key === 'dob') formattedValue = formatDate(formattedValue);
      applicantDetails[key] = formattedValue;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(applicantDetails.email_id)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(applicantDetails.contact_number)) {
      return res.status(400).json({ success: false, error: 'Invalid phone number format (must be 10 digits)' });
    }

    const aadhaarRegex = /^[0-9]{12}$/;
    if (!aadhaarRegex.test(applicantDetails.aadhaar_number)) {
      return res.status(400).json({ success: false, error: 'Invalid Aadhaar number format (must be 12 digits)' });
    }

    const trackingId = 'APP-' + crypto.randomBytes(4).toString('hex').toUpperCase();

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

    const category = applicantDetails.request_category;
    // const requiredDocs = {
    //   educational: ['educational_aadhaar', 'educational_passbook', 'educational_marksheet', 'educational_fee_receipt', 'educational_school_id'],
    //   women: ['women_aadhaar', 'women_passbook', 'women_business_docs'],
    //   entrepreneur: ['entrepreneur_aadhaar', 'entrepreneur_passbook', 'entrepreneur_business_docs'],
    //   medical: ['medical_aadhaar', 'medical_passbook', 'medical_letter', 'medical_receipt']
    // };

    // if (category && requiredDocs[category]) {
    //   const missingDocs = requiredDocs[category].filter(doc => !files[doc] || files[doc].length === 0);
    //   if (missingDocs.length > 0) {
    //     return res.status(400).json({ success: false, error: `Missing required documents: ${missingDocs.join(', ')}` });
    //   }
    // }

    const newApp = new Application({
      trackingId,
      applicantDetails,
      documents,
      photoPath,
      status: 'Submitted',
      createdAt: new Date()
    });
    await newApp.save();

    // Generate docx for email attachment
    const formattedDetails = Object.fromEntries(
      Object.entries(applicantDetails).map(([key, value]) => {
        const { key: formattedKey } = formatField(key, value);
        return [formattedKey, key === 'dob' ? formatDate(value) || 'N/A' : value || 'N/A'];
      })
    );

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: 'AUYPCT Scholarship Application', bold: true, size: 28, font: 'Arial' })], spacing: { after: 200 } }),
          new Paragraph({ children: [new TextRun({ text: `Tracking ID: ${trackingId}`, size: 20, font: 'Arial' })], spacing: { after: 200 } }),
          photoPath
            ? new Paragraph({
                children: [new ImageRun({ data: fs.readFileSync(photoPath), transformation: { width: 100, height: 100 } })],
                alignment: 'center',
                spacing: { after: 200 }
              })
            : null,
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

    // Email content
    const appUrl = process.env.APP_URL || 'https://auypct-portal-backend.onrender.com';
    const currentDateTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const applicantHtmlTable = `
      <html><head><style>body { font-family: Arial, sans-serif; color: #333; } .container { max-width: 600px; margin: 0 auto; padding: 20px; } h2 { color: #1e3c72; } table { border-collapse: collapse; width: 100%; margin: 20px 0; } th, td { border: 1px solid #ddd; padding: 12px; text-align: left; } th { background-color: #f2f2f2; } ul { padding-left: 20px; } .footer { margin-top: 20px; font-size: 0.9em; color: #666; } a { color: #667eea; text-decoration: none; } a:hover { text-decoration: underline; }</style></head><body><div class="container"><h2>AUYPCT Scholarship Application</h2><p><strong>Tracking ID:</strong> ${trackingId}</p><table><tr><th>Field</th><th>Value</th></tr>${Object.entries(formattedDetails).map(([key, value]) => `<tr><td>${sanitizeHtml(key)}</td><td>${sanitizeHtml(value)}</td></tr>`).join('')}</table><h3>Documents:</h3><ul>${documents.map(doc => `<li>${sanitizeHtml(doc.name)}</li>`).join('')}</ul><div class="footer"><p>Please send hard copies to:</p><p>INK CENTER, C/O AU YOUNG PROFESSIONALS CHARITABLE TRUST<br>34-23/810, ATTUMANTHAI Anjal Kara Street, EASTGATE<br>Thanjavur - 613001<br>Contact: 84283 66631</p><p>Submission Date: ${currentDateTime}</p></div></div></body></html>
    `;

    const adminTrusteeHtmlTable = `
      <html><head><style>body { font-family: Arial, sans-serif; color: #333; } .container { max-width: 600px; margin: 0 auto; padding: 20px; } h2 { color: #1e3c72; } table { border-collapse: collapse; width: 100%; margin: 20px 0; } th, td { border: 1px solid #ddd; padding: 12px; text-align: left; } th { background-color: #f2f2f2; } ul { padding-left: 20px; } .footer { margin-top: 20px; font-size: 0.9em; color: #666; } a { color: #667eea; text-decoration: none; } a:hover { text-decoration: underline; }</style></head><body><div class="container"><h2>New Scholarship Form Received</h2><p><strong>Tracking ID:</strong> ${trackingId}</p><table><tr><th>Field</th><th>Value</th></tr>${Object.entries(formattedDetails).map(([key, value]) => `<tr><td>${sanitizeHtml(key)}</td><td>${sanitizeHtml(value)}</td></tr>`).join('')}</table><h3>Documents:</h3><ul>${documents.map(doc => `<li>${sanitizeHtml(doc.name)}</li>`).join('')}</ul><div class="footer"><p>Please send hard copies to:</p><p>INK CENTER, C/O AU YOUNG PROFESSIONALS CHARITABLE TRUST<br>34-23/810, ATTUMANTHAI Anjal Kara Street, EASTGATE<br>Thanjavur - 613001<br>Contact: 84283 66631</p><p>Received Date: ${currentDateTime}</p></div></div></body></html>
    `;

    // Send emails
    await Promise.all([
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: applicantDetails.email_id,
        subject: `AUYPCT Application - ID: ${trackingId}`,
        html: applicantHtmlTable,
        attachments: [{ filename: `app_${trackingId}.docx`, content: buffer }]
      }),
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: 'yuvaneshr2002@gmail.com',
        subject: 'New Scholarship Form Received - ID: ' + trackingId,
        html: adminTrusteeHtmlTable,
        attachments: [{ filename: `app_${trackingId}.docx`, content: buffer }]
      }),
      transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: 'rdmvyfamily@gmail.com',
        subject: 'New Scholarship Form Received - ID: ' + trackingId,
        html: adminTrusteeHtmlTable,
        attachments: [{ filename: `app_${trackingId}.docx`, content: buffer }]
      })
    ]);

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