export class FileTooLargeError extends Error {
  constructor(sizeBytes: number, maxBytes: number) {
    super(`File exceeds the maximum allowed size: ${sizeBytes} bytes (max ${maxBytes})`);
    this.name = "FileTooLargeError";
  }
}

export class UnsupportedMimeTypeError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported MIME type: ${mimeType}`);
    this.name = "UnsupportedMimeTypeError";
  }
}

export class FileNotFoundError extends Error {
  constructor(idOrStorageKey: string) {
    super(`File not found: ${idOrStorageKey}`);
    this.name = "FileNotFoundError";
  }
}

export class InvalidFileNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileNameError";
  }
}

export class FileStorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("File storage is unavailable");
    this.name = "FileStorageUnavailableError";
    this.cause = cause;
  }
}
