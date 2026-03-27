export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class LLMError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'LLM_ERROR', 502, details);
  }
}

export class EmbeddingError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EMBEDDING_ERROR', 502, details);
  }
}
