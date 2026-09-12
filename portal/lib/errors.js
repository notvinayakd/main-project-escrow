// One error shape for the whole API, so clients never have to guess.
// Every failure response is { error: <machine code>, message: <human sentence>, ...detail }

class ApiError extends Error {
  constructor(status, code, message, detail = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const badRequest = (msg, detail) => new ApiError(400, 'bad_request', msg, detail);
const unauthorized = (msg = 'Sign in to perform this action.') => new ApiError(401, 'unauthorized', msg);
const forbidden = (msg, detail) => new ApiError(403, 'forbidden', msg, detail);
const notFound = (msg) => new ApiError(404, 'not_found', msg);
const conflict = (code, msg, detail) => new ApiError(409, code, msg, detail);

/** Wraps an async route so a rejected promise reaches the error handler instead of hanging. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, wrap };
