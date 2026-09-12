// Sign-in, sign-out, and "who am I". Shared by both roles.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, directory } = require('../lib/users');
const { createSession, getSession, destroySession } = require('../lib/sessions');
const { unauthorized, wrap, ApiError } = require('../lib/errors');
const { config } = require('../config');

const router = express.Router();

// Credential stuffing is the one attack a public demo actually invites.
const signInLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.signInLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many sign-in attempts. Try again in a few minutes.' }
});

/** Populates req.actor when a valid bearer token is present. Never rejects. */
function readSession(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token ? getSession(token) : null;
  if (session) { req.actor = session.actor; req.token = token; }
  next();
}

/** Rejects unless signed in — optionally in one of the given roles. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.actor) return next(unauthorized());
  if (roles.length && !roles.includes(req.actor.role)) {
    return next(new ApiError(403, 'forbidden',
      `This action requires ${roles.join(' or ')} access. You are signed in as ${req.actor.role}.`));
  }
  next();
};

// Who may sign in. Public so the picker can render; credentials are never exposed.
router.get('/directory', wrap((req, res) => res.json(directory())));

router.post('/session', signInLimiter, wrap((req, res) => {
  const actor = authenticate(req.body?.accountId, req.body?.pin);
  // One message for both failure modes: never reveal which half was wrong.
  if (!actor) throw new ApiError(401, 'invalid_credentials', 'Account id or PIN not recognised.');
  const { token, expiresAt } = createSession(actor);
  res.json({ token, expiresAt, actor });
}));

router.get('/session', requireRole(), wrap((req, res) => res.json({ actor: req.actor })));

router.delete('/session', requireRole(), wrap((req, res) => {
  destroySession(req.token);
  res.json({ ok: true });
}));

module.exports = { router, readSession, requireRole };
