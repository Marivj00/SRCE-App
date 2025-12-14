const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Staff = require('./models/Staff');

const MONGO_URI =
  'mongodb+srv://srceuser:Srce12345@cluster0.cugte4q.mongodb.net/srce_app?retryWrites=true&w=majority&appName=Cluster0';

async function run() {
  await mongoose.connect(MONGO_URI);

  const email = 'principal@srce.edu';
  const password = 'Principal123';

  const existing = await Staff.findOne({ email });
  if (existing) {
    console.log('Principal already exists');
    return process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await Staff.create({
    name: 'Principal',
    email,
    passwordHash,
    role: 'principal',
    dept: null,
  });

  console.log('Principal created with:');
  console.log('email:', email);
  console.log('password:', password);

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
