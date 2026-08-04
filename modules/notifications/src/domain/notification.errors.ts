export class InvalidEmailError extends Error {
  constructor(email: string) {
    super(`Invalid email address: ${email}`);
    this.name = "InvalidEmailError";
  }
}

export class InvalidTemplateIdError extends Error {
  constructor(templateId: string) {
    super(`Invalid template id: ${templateId}`);
    this.name = "InvalidTemplateIdError";
  }
}

export class TemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`Template not found: ${templateId}`);
    this.name = "TemplateNotFoundError";
  }
}

export class MailerUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MailerUnavailableError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
