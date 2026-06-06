const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'submissions.json');

const NOTIFY_EMAILS = (process.env.NOTIFY_EMAILS || '').split(',').filter(Boolean);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function loadSubmissions() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSubmissions(submissions) {
  fs.writeFileSync(DB_FILE, JSON.stringify(submissions, null, 2));
}

async function sendEmailNotification(submission) {
  if (!RESEND_API_KEY || NOTIFY_EMAILS.length === 0) return;

  const typeLabel = {
    question: 'Question',
    concern: 'Concern',
    request: 'Request',
    suggestion: 'Suggestion',
  }[submission.type] || submission.type;

  const urgencyLabel = {
    routine: 'Routine',
    soon: 'Needs Attention Soon',
    urgent: 'Urgent',
  }[submission.urgency] || submission.urgency;

  const fromLabel = submission.anonymous
    ? 'Anonymous'
    : `${submission.name || 'Unknown'}${submission.role ? ` (${submission.role})` : ''}`;

  const body = [
    `Type: ${typeLabel}`,
    `Urgency: ${urgencyLabel}`,
    `From: ${fromLabel}`,
    `Submitted: ${new Date(submission.createdAt).toLocaleString()}`,
    '',
    submission.message,
  ].join('\n');

  const res = await fetch('<https://api.resend.com/emails>', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Staff Voice Portal <onboarding@resend.dev>',
      to: NOTIFY_EMAILS,
      subject: `[${urgencyLabel}] New Staff ${typeLabel}`,
      text: body,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

app.post('/api/submit', async (req, res) => {
  const { type, urgency, message, name, role, anonymous } = req.body;

  if (!type || !message || !message.trim()) {
    return res.status(400).json({ error: 'Type and message are required.' });
  }

  const submission = {
    id: uuidv4(),
    type,
    urgency: urgency || 'routine',
    message: message.trim(),
    anonymous: anonymous === 'true' || anonymous === true,
    name: (anonymous === 'true' || anonymous === true) ? null : (name || '').trim() || null,
    role: (anonymous === 'true' || anonymous === true) ? null : (role || '').trim() || null,
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const submissions = loadSubmissions();
  submissions.unshift(submission);
  saveSubmissions(submissions);

  try {
    await sendEmailNotification(submission);
  } catch (err) {
    console.error('Email notification failed:', err.message);
  }

  res.json({ success: true, id: <submission.id> });
});

app.get('/api/admin/submissions', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(loadSubmissions());
});

app.patch('/api/admin/submissions/:id', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const submissions = loadSubmissions();
  const idx = submissions.findIndex(s => <s.id> === <req.params.id>);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const allowed = ['new', 'in-progress', 'resolved'];
  if (req.body.status && allowed.includes(req.body.status)) {
    submissions[idx].status = req.body.status;
    submissions[idx].updatedAt = new Date().toISOString();
    if (req.body.note !== undefined) submissions[idx].adminNote = req.body.note;
    saveSubmissions(submissions);
  }
  res.json(submissions[idx]);
});

app.listen(PORT, () => {
  console.log(`Staff Voice Portal running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin.html?token=${ADMIN_TOKEN}`);
});
