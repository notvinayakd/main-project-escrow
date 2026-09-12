// One structured line per request. Enough to debug a demo, cheap enough to leave on.

function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Never log request bodies: they carry PINs on the sign-in route.
    const who = req.actor ? `${req.actor.role}:${req.actor.id}` : 'anon';
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number(ms.toFixed(1)),
      who
    }));
  });
  next();
}

module.exports = { requestLogger };
