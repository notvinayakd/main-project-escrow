// Express app assembly, exported without listening so tests can drive it directly.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { config } = require('./config');
const { requestLogger } = require('./lib/logger');
const { ApiError } = require('./lib/errors');
const publicRoutes = require('./routes/public');
const { router: authRouter, readSession } = require('./routes/auth');
const traderRoutes = require('./routes/trader');
const officerRoutes = require('./routes/officer');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render terminates TLS upstream; without this, rate limiting sees one proxy IP.
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    // The API is meant to be read cross-origin by attestors.
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors({ origin: config.corsOrigins === '*' ? true : config.corsOrigins.split(',') }));
  app.use(express.json({ limit: '64kb' }));
  app.use(readSession);
  app.use(requestLogger);

  // Generous ceiling: stops a runaway script, never a demo or an attestor.
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many requests. Slow down and try again shortly.' }
  }));

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, service: 'ctccs', version: '2.4.1', env: config.env, time: new Date().toISOString() });
  });

  app.use('/ctccs/api/v2', publicRoutes);
  app.use('/ctccs/auth', authRouter);
  app.use('/ctccs/trader', traderRoutes);
  app.use('/ctccs/officer', officerRoutes);

  // Cache hard in production, not at all in development. A stale cached app.js during
  // development looks exactly like "the fix didn't work", and costs an hour of confusion.
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: config.env === 'production' ? '1h' : 0,
    etag: true
  }));

  // Deep links resolve to the single-page app, which reads the reference from the URL.
  for (const route of ['/ctccs/consignment/:id', '/ctccs/track', '/ctccs']) {
    app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` });
  });

  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...err.detail });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large.' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'bad_request', message: 'Request body is not valid JSON.' });
    }
    console.error('[ctccs] unhandled error:', err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong handling that request.' });
  });

  return app;
}

module.exports = { createApp };
