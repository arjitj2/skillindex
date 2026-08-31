export interface SerializedIpcError {
  __skillIndexIpcError: true;
  message: string;
  trace: string;
}

export function serializeIpcError(error: unknown): SerializedIpcError {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : String(error);
  const trace = error instanceof Error && error.stack
    ? error.stack
    : typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string'
      ? error.stack
      : message;

  return {
    __skillIndexIpcError: true,
    message,
    trace,
  };
}

export function unwrapIpcResponse<T>(response: T | SerializedIpcError): T {
  if (!isSerializedIpcError(response)) {
    return response;
  }

  const error = new Error(response.message);
  error.stack = response.trace;
  throw error;
}

function isSerializedIpcError(value: unknown): value is SerializedIpcError {
  return typeof value === 'object'
    && value !== null
    && '__skillIndexIpcError' in value
    && value.__skillIndexIpcError === true
    && 'message' in value
    && typeof value.message === 'string'
    && 'trace' in value
    && typeof value.trace === 'string';
}
