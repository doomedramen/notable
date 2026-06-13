import type {
  PluginAPIError,
  PluginAPIErrorCode,
} from "../plugin-api";

/**
 * Create the stable error shape exposed by asynchronous plugin APIs.
 *
 * Keeping construction in one module prevents each facade from inventing
 * incompatible messages or ad-hoc status handling. The public contract is
 * structural, so plugins can safely inspect `error.code` without importing a
 * runtime class from the host bundle.
 */
export function pluginAPIError(
  code: PluginAPIErrorCode,
  message: string,
  status?: number,
): PluginAPIError {
  const error = new Error(message) as PluginAPIError;
  error.name = "PluginAPIError";
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

/** Convert a failed HTTP response into a documented plugin API error. */
export async function responseError(
  response: Response,
  fallback: string,
): Promise<PluginAPIError> {
  const message = (await response.text()).trim() || fallback;
  const code =
    response.status === 400
      ? "INVALID_ARGUMENT"
      : response.status === 404
        ? "NOT_FOUND"
        : response.status === 409
          ? "CONFLICT"
          : "REQUEST_FAILED";
  return pluginAPIError(code, message, response.status);
}

/** Normalize network failures without hiding programming errors. */
export function requestError(error: unknown, fallback: string): PluginAPIError {
  if (
    error instanceof Error &&
    (error as Partial<PluginAPIError>).code !== undefined
  ) {
    return error as PluginAPIError;
  }
  return pluginAPIError(
    error instanceof TypeError ? "OFFLINE" : "REQUEST_FAILED",
    error instanceof Error && error.message ? error.message : fallback,
  );
}
