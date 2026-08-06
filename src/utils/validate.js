import { ApiError } from "../middleware/errors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function required(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new ApiError(400, `"${field}" is required`, "validation_error");
  }
  return value;
}

export function email(body, field = "email") {
  const value = required(body, field);
  if (!EMAIL_RE.test(value)) {
    throw new ApiError(400, `"${field}" must be a valid email address`, "validation_error");
  }
  return value.toLowerCase();
}

export function stringOf(body, field, { min = 1, max = 255 } = {}) {
  const value = required(body, field);
  if (typeof value !== "string") {
    throw new ApiError(400, `"${field}" must be a string`, "validation_error");
  }
  if (value.length < min || value.length > max) {
    throw new ApiError(
      400,
      `"${field}" must be between ${min} and ${max} characters`,
      "validation_error",
    );
  }
  return value;
}
