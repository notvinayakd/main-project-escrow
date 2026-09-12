// In-memory bearer sessions. Lost on restart, which is correct: nothing sensitive
// persists, and a redeploy always starts signed out.

const crypto = require('crypto');
const { config } = require('../config');

const TTL_MS = config.sessionTtlMinutes * 60 * 1000;
const sessions = new Map();

function createSession(actor) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TTL_MS;
  sessions.set(token, { actor, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}

const destroySession = (token) => sessions.delete(token);
const activeCount = () => sessions.size;

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now > s.expiresAt) sessions.delete(t);
}, 5 * 60 * 1000);
sweeper.unref();

module.exports = { createSession, getSession, destroySession, activeCount, stopSweeper: () => clearInterval(sweeper) };
