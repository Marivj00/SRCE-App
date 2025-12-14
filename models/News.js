const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    imageUrl: { type: String },
    dept: { type: String, required: true }, // backend fills this
  },
  { timestamps: true }
);

module.exports = mongoose.model('News', newsSchema);
