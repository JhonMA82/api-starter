export class UnknownFeatureError extends Error {
  constructor(id: string) {
    super(`Unknown feature "${id}"`);
    this.name = "UnknownFeatureError";
  }
}

export class UnknownProfileError extends Error {
  constructor(id: string) {
    super(`Unknown profile "${id}"`);
    this.name = "UnknownProfileError";
  }
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}
