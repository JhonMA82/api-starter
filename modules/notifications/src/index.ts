export type {
  Mailer,
  NotificationChannel,
  SentMailRepository,
  TemplateRenderer,
} from "./application/ports";
export {
  createNotificationWorker,
  createSendNotificationService,
  type JobHandler,
  NOTIFICATION_JOB_TYPE,
  type NotificationJobPayload,
  type NotificationWorkerDeps,
  type SendNotificationDeps,
  type SendNotificationInput,
  type SendNotificationResult,
  type SendNotificationService,
} from "./application/send-notification";
export {
  createTemplateRenderer,
  substituteVariables,
  TEMPLATES,
  type TemplateDefinition,
} from "./application/templates";
export type { EmailMessage, Locale, TemplateContext } from "./domain/notification.entity";
export {
  assertValidEmailAddress,
  assertValidTemplateId,
} from "./domain/notification.entity";
export {
  InvalidEmailError,
  InvalidTemplateIdError,
  MailerUnavailableError,
  TemplateNotFoundError,
} from "./domain/notification.errors";
export {
  createClient,
  createDb,
  createLogMailer,
  createNoopMailer,
  createSentMailRepository,
  createSmtpMailer,
  notificationSchema,
} from "./infrastructure";
