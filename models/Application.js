const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema(
  {
    trackingId: { type: String, unique: true, required: true, trim: true },
    applicantDetails: { type: Object, required: true },
    documents: [{ name: String, path: String }],
    status: {
      type: String,
      default: 'Submitted',
      enum: ['Submitted', 'Under Review', 'Eligible', 'Rejected', 'Funds Transferred']
    },
    bankDetails: { type: Object, default: {} },
    reviewedBy: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Application', applicationSchema);