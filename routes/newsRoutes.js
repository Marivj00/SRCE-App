const express = require('express');
const path = require('path');
const multer = require('multer');
const News = require('../models/News');
const auth = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `news-${Date.now()}${ext || '.jpg'}`);
  },
});

const upload = multer({ storage });

router.post(
  '/staff/news',
  auth,
  upload.single('image'),
  async (req, res) => {
    try {
      const { title, content } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: 'Title and content required' });
      }

      let dept;
      if (req.user.role === 'principal') {
        dept = 'News';
      } else {
        if (!req.user.dept) {
          return res.status(400).json({ error: 'User department not set' });
        }
        dept = req.user.dept;
      }

      const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

      const created = await News.create({
        title,
        content,
        dept,
        imageUrl,
      });

      return res.json(created);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error creating news' });
    }
  }
);

router.get('/public/news', async (req, res) => {
  try {
    const { dept } = req.query;
    const filter = dept ? { dept } : {};
    const list = await News.find(filter).sort({ createdAt: -1 });
    return res.json(list);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error getting news' });
  }
});

module.exports = router;
