require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
const JWT_SECRET = process.env.JWT_SECRET || 'srce-secret';

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- MONGOOSE MODELS ----------
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/srce')
  .then(() => console.log('Mongo connected'))
  .catch(err => console.error('Mongo error', err));

const staffSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String, // plain password used for login
  role: { type: String, enum: ['principal', 'staff'], default: 'staff' },
  dept: { type: String, default: null },
});

const newsSchema = new mongoose.Schema(
  {
    title: String,
    content: String,
    dept: { type: String, default: 'News' },
    imageUrl: String,
  },
  { timestamps: true }
);

// ---------- ATTENDANCE MODELS ----------
const classSchema = new mongoose.Schema({
  dept: String,          // e.g. 'CSE'
  classCode: String,     // e.g. 'CSE-I'
  name: String,          // display name
  students: [
    {
      roll: String,
      name: String,
    },
  ],
});

const attendanceSchema = new mongoose.Schema(
  {
    dept: String,        // 'CSE'
    classCode: String,   // 'CSE-I'
    date: String,        // '2025-12-12'
    records: [
      {
        roll: String,
        name: String,
        status: { type: String, enum: ['P', 'A'] }, // Present / Absent
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true }
);

const Staff = mongoose.model('Staff', staffSchema);
const News = mongoose.model('News', newsSchema);
const Class = mongoose.model('Class', classSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);


// ---------- FILE UPLOAD (IMAGES) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '')),
});
const upload = multer({ storage });

// ---------- AUTH MIDDLEWARE ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    console.error('Auth error', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ---------- AUTH ROUTES ----------
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('LOGIN BODY:', req.body);

    const staff = await Staff.findOne({ email, password });
    if (!staff) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: staff._id, role: staff.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      token,
      staff: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        dept: staff.dept,
      },
    });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: CREATE STAFF ----------
app.post('/admin/create-staff', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal can create staff' });
    }
    const { name, email, password, dept } = req.body;
    if (!name || !email || !password || !dept) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const existing = await Staff.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const staff = await Staff.create({
      name,
      email,
      password,
      role: 'staff',
      dept,
    });
    res.json({
      id: staff._id,
      name: staff.name,
      email: staff.email,
      dept: staff.dept,
      role: staff.role,
    });
  } catch (err) {
    console.error('Create staff error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PUBLIC NEWS (LIST FOR APP HOME) ----------
app.get('/public/news', async (req, res) => {
  try {
    const dept = req.query.dept;
    const filter = dept ? { dept } : {};
    const list = await News.find(filter).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error('Public news error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- STAFF: GET CLASSES FOR OWN DEPARTMENT ----------
app.get('/staff/classes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can view classes' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(400).json({ error: 'No department set' });
    }

    const classes = await Class.find({ dept: staff.dept }).sort({ classCode: 1 });
    res.json(classes);
  } catch (err) {
    console.error('Staff classes error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- STAFF: UPDATE STUDENTS FOR OWN DEPARTMENT CLASS ----------
app.post('/staff/class-students', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can edit students' });
    }

    const { classCode, students } = req.body;
    if (!classCode || !Array.isArray(students)) {
      return res
        .status(400)
        .json({ error: 'classCode and students array are required' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(400).json({ error: 'No department set' });
    }

    const cls = await Class.findOneAndUpdate(
      { dept: staff.dept, classCode },
      {
        dept: staff.dept,
        classCode,
        name: classCode,
        students,
      },
      { new: true, upsert: true }
    );

    res.json(cls);
  } catch (err) {
    console.error('Staff class-students error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- STAFF: GET STUDENTS FOR ONE CLASS ----------
app.get('/staff/class-students', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can view students' });
    }

    const { classCode } = req.query;
    if (!classCode) {
      return res.status(400).json({ error: 'classCode is required' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(400).json({ error: 'No department set' });
    }

    // find the class in this staff's department
    const cls = await Class.findOne({ dept: staff.dept, classCode });
    if (!cls) {
      return res.json({ students: [] });
    }

    res.json({ students: cls.students || [] });
  } catch (err) {
    console.error('Staff get class-students error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---------- STAFF: GET OR CREATE ATTENDANCE FOR A CLASS+DATE ----------
app.get('/staff/attendance', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can view attendance' });
    }

    const { classCode, date } = req.query;
    if (!classCode || !date) {
      return res.status(400).json({ error: 'classCode and date are required' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(400).json({ error: 'No department set' });
    }

    // ensure class belongs to this dept
    const cls = await Class.findOne({ dept: staff.dept, classCode });
    if (!cls) {
      return res.status(404).json({ error: 'Class not found for your department' });
    }

    // try to find existing attendance
    let att = await Attendance.findOne({
      dept: staff.dept,
      classCode,
      date,
    });

    if (!att) {
      // create default records: all present
      att = new Attendance({
        dept: staff.dept,
        classCode,
        date,
        records: cls.students.map(s => ({
          roll: s.roll,
          name: s.name,
          status: 'P',
        })),
        createdBy: staff._id,
      });
    }

    res.json(att);
  } catch (err) {
    console.error('Staff get attendance error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- STAFF: SAVE ATTENDANCE FOR A CLASS+DATE ----------
app.post('/staff/attendance', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can save attendance' });
    }

    const { classCode, date, records } = req.body;
    if (!classCode || !date || !Array.isArray(records)) {
      return res
        .status(400)
        .json({ error: 'classCode, date and records array are required' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(400).json({ error: 'No department set' });
    }

    // lock past dates
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (date < todayStr) {
      return res.status(400).json({ error: 'Cannot modify past attendance' });
    }

    // ensure class belongs to this dept
    const cls = await Class.findOne({ dept: staff.dept, classCode });
    if (!cls) {
      return res.status(404).json({ error: 'Class not found for your department' });
    }

    // upsert attendance
    const att = await Attendance.findOneAndUpdate(
      { dept: staff.dept, classCode, date },
      {
        dept: staff.dept,
        classCode,
        date,
        records,
        createdBy: staff._id,
      },
      { new: true, upsert: true }
    );

    res.json(att);
  } catch (err) {
    console.error('Staff save attendance error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---------- STAFF: LIST ONLY OWN DEPARTMENT NEWS ----------
app.get('/staff/my-news', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      console.log('my-news forbidden role', req.user.role);
      return res.status(403).json({ error: 'Only staff can view this' });
    }

    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      console.log('my-news no dept for staff', req.user.id, staff && staff.dept);
      return res.status(400).json({ error: 'No department set' });
    }

    const list = await News.find({ dept: staff.dept }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error('My news error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---------- STAFF / PRINCIPAL: CREATE NEWS ----------
app.post(
  '/staff/news',
  authMiddleware,
  upload.single('image'),
  async (req, res) => {
    try {
      let dept = 'News';

      if (req.user.role === 'staff') {
        const staff = await Staff.findById(req.user.id);
        dept = staff && staff.dept ? staff.dept : 'News';
      } else if (req.user.role === 'principal') {
        dept = 'News'; // common news
      }

      const imageUrl = req.file ? '/uploads/' + req.file.filename : null;

      const news = await News.create({
        title: req.body.title,
        content: req.body.content,
        dept,
        imageUrl,
      });

      res.json(news);
    } catch (err) {
      console.error('Create news error', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ---------- STAFF / PRINCIPAL: DELETE NEWS ----------
app.delete('/staff/news/:id', authMiddleware, async (req, res) => {
  try {
    const newsId = req.params.id;
    const news = await News.findById(newsId);
    if (!news) {
      return res.status(404).json({ error: 'News not found' });
    }

    // principal can delete any post
    if (req.user.role === 'principal') {
      await news.deleteOne();
      return res.json({ ok: true });
    }

    // staff: only delete own dept posts
    const staff = await Staff.findById(req.user.id);
    if (!staff || !staff.dept) {
      return res.status(403).json({ error: 'No department set' });
    }
    if (news.dept !== staff.dept) {
      return res
        .status(403)
        .json({ error: 'Cannot delete other department posts' });
    }

    await news.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete news error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: LIST STAFF ----------
app.get('/admin/staff', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal' });
    }
    const staffList = await Staff.find({}, 'name email dept role');
    res.json(staffList);
  } catch (err) {
    console.error('List staff error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: DELETE STAFF ----------
app.delete('/admin/staff/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal' });
    }
    const staffId = req.params.id;
    const staff = await Staff.findById(staffId);
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    await staff.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete staff error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: VIEW ATTENDANCE ----------
app.get('/admin/attendance', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal can view attendance' });
    }

    const { dept, classCode, date } = req.query;
    if (!dept || !classCode || !date) {
      return res
        .status(400)
        .json({ error: 'dept, classCode and date are required' });
    }

    const att = await Attendance.findOne({ dept, classCode, date });
    if (!att) {
      return res.status(404).json({ error: 'No attendance found' });
    }

    res.json(att);
  } catch (err) {
    console.error('Admin attendance error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: ATTENDANCE SUMMARY BY DEPT ----------
app.get('/admin/attendance-summary-by-dept', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal can view summary' });
    }

    const { dept, date } = req.query;
    if (!dept || !date) {
      return res
        .status(400)
        .json({ error: 'dept and date are required' });
    }

    const list = await Attendance.find({ dept, date });
    if (!list.length) {
      return res.status(404).json({ error: 'No attendance found' });
    }

    const classes = list.map(att => {
      const total = att.records.length;
      const presentCount = att.records.filter(r => r.status === 'P').length;
      const absentCount = total - presentCount;
      const presentPercent = total ? Math.round((presentCount / total) * 100) : 0;
      const absentPercent = total ? Math.round((absentCount / total) * 100) : 0;
      return {
        classCode: att.classCode,
        total,
        presentCount,
        absentCount,
        presentPercent,
        absentPercent,
      };
    });

    res.json({ dept, date, classes });
  } catch (err) {
    console.error('Admin dept summary error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------- PRINCIPAL: ATTENDANCE SUMMARY ----------
app.get('/admin/attendance-summary', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal can view summary' });
    }

    const { dept, classCode, date } = req.query;
    if (!dept || !classCode || !date) {
      return res
        .status(400)
        .json({ error: 'dept, classCode and date are required' });
    }

    const att = await Attendance.findOne({ dept, classCode, date });
    if (!att) {
      return res.status(404).json({ error: 'No attendance found' });
    }

    const total = att.records.length;
    const presentCount = att.records.filter(r => r.status === 'P').length;
    const absentCount = total - presentCount;
    const presentPercent = total ? Math.round((presentCount / total) * 100) : 0;
    const absentPercent = total ? Math.round((absentCount / total) * 100) : 0;

    res.json({
      dept,
      classCode,
      date,
      total,
      presentCount,
      absentCount,
      presentPercent,
      absentPercent,
    });
  } catch (err) {
    console.error('Admin attendance summary error', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// ---------- PRINCIPAL: GET ALL DEPARTMENTS ----------
app.get('/admin/departments', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'principal') {
      return res.status(403).json({ error: 'Only principal can view departments' });
    }

    // get unique departments from Class collection
    const depts = await Class.distinct('dept');
    res.json({ departments: depts.sort() });
  } catch (err) {
    console.error('Admin departments error', err);
    res.status(500).json({ error: 'Server error' });
  }
});




// ---------- ROOT TEST ----------
app.get('/', (req, res) => {
  res.send('SRCE backend running');
});

// ---------- START SERVER ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
