require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!API_KEY) {
  console.error('ERROR: API_KEY not set in .env — refusing to start.');
  process.exit(1);
}

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

app.use(cors());
app.use(express.json());

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const metadataFile = path.join(__dirname, 'metadata.json');
let metadata = fs.existsSync(metadataFile)
  ? JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
  : {};

function saveMetadata() {
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Cloud File API is running' });
});

app.post('/upload', requireApiKey, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (use field name "file")' });
  }
  const id = path.parse(req.file.filename).name;
  metadata[id] = {
    originalName: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };
  saveMetadata();
  res.json({ id, ...metadata[id] });
});

app.get('/files', requireApiKey, (req, res) => {
  res.json(metadata);
});

app.get('/files/:id', requireApiKey, (req, res) => {
  const entry = metadata[req.params.id];
  if (!entry) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(UPLOAD_DIR, entry.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(filePath, entry.originalName);
});

app.delete('/files/:id', requireApiKey, (req, res) => {
  const entry = metadata[req.params.id];
  if (!entry) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(UPLOAD_DIR, entry.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  delete metadata[req.params.id];
  saveMetadata();
  res.json({ deleted: req.params.id });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Cloud File API listening on port ${PORT}`);
});
