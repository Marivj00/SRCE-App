const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['principal', 'staff'], default: 'staff' },
  dept: { type: String }, // only for staff
});

module.exports = mongoose.model('Staff', staffSchema);
