const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/desktop', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'desktop.html'));
});

app.get('/phone', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

app.get('/api/session', (_req, res) => {
  const sessionId = uuidv4().slice(0, 8);
  res.json({ sessionId });
});

app.get('/api/qr', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const phoneUrl = `${protocol}://${host}/phone?session=${sessionId}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });
    res.json({ qrDataUrl, phoneUrl });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

const sessions = new Map();

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('join_session', ({ sessionId, role }) => {
    socket.join(sessionId);
    socket.data.sessionId = sessionId;
    socket.data.role = role;

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { desktop: null, phones: new Set() });
    }
    const session = sessions.get(sessionId);

    if (role === 'desktop') {
      session.desktop = socket.id;
    } else {
      session.phones.add(socket.id);
      io.to(sessionId).emit('phone_connected', {
        count: session.phones.size
      });
    }

    console.log(`[join] ${role} → session ${sessionId}`);
  });

  socket.on('intent', ({ sessionId, trigger, replyText }) => {
    console.log(`[intent] session=${sessionId} trigger="${trigger}" reply="${replyText}"`);
    io.to(sessionId).emit('intent_received', { trigger, replyText });
  });

  socket.on('disconnect', () => {
    const { sessionId, role } = socket.data;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      if (role === 'desktop') {
        session.desktop = null;
      } else {
        session.phones.delete(socket.id);
        io.to(sessionId).emit('phone_connected', {
          count: session.phones.size
        });
      }
      if (!session.desktop && session.phones.size === 0) {
        sessions.delete(sessionId);
      }
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ✦ SubSignal running at http://localhost:${PORT}`);
  console.log(`  → Desktop: http://localhost:${PORT}/desktop`);
  console.log(`  → Phone:   http://localhost:${PORT}/phone?session=SESSION_ID\n`);
});
