export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code ?? "error";
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status ?? 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: {
      code: err.code ?? "internal_error",
      message: status >= 500 ? "Internal server error" : err.message,
    },
  });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
