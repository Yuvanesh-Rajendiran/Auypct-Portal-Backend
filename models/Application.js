const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  trackingId: { type: String, unique: true, required: true },
  applicantDetails: { type: Object, required: true },
  documents: [{ name: String, path: String }],
  status: { type: String, default: 'Submitted' },
  bankDetails: { type: Object },
  reviewedBy: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Application', applicationSchema);