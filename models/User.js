const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['principal', 'staff'], required: true },
  dept: { type: String }, // e.g. 'CSE', 'ECE' for staff
});

module.exports = mongoose.model('User', userSchema);
