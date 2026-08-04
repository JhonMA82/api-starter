import { describe, expect, test } from "bun:test";

import {
  createNotificationWorker,
  createSendNotificationService,
  NOTIFICATION_JOB_TYPE,
  type NotificationJobPayload,
} from "../src/application/send-notification";
import { createTemplateRenderer, substituteVariables } from "../src/application/templates";
import {
  assertValidEmailAddress,
  assertValidTemplateId,
  type EmailMessage,
} from "../src/domain/notification.entity";
import {
  InvalidEmailError,
  InvalidTemplateIdError,
  MailerUnavailableError,
  TemplateNotFoundError,
} from "../src/domain/notification.errors";
import { createLogMailer } from "../src/infrastructure/log-mailer";
import { createNoopMailer } from "../src/infrastructure/noop-mailer";
import { createSmtpMailer } from "../src/infrastructure/smtp-mailer";
import {
  createFailingMailer,
  createFakeJobQueue,
  createFakeMailer,
  createFakeSentMailRepository,
  makeEmailMessage,
} from "./fakes";

function makeJobPayload(overrides: Partial<NotificationJobPayload> = {}): NotificationJobPayload {
  return {
    messageId: "message-1",
    to: "user@example.com",
    subject: "Invitación a Acme",
    text: "Has sido invitado a Acme. Token: tok-1",
    html: null,
    templateId: "invitation.v1",
    dedupeKey: "invitation:tok-1:user@example.com",
    ...overrides,
  };
}

describe("assertValidEmailAddress", () => {
  test("accepts a well-formed email", () => {
    expect(() => assertValidEmailAddress("user@example.com")).not.toThrow();
  });

  test("rejects a blank email", () => {
    expect(() => assertValidEmailAddress("")).toThrow(InvalidEmailError);
    expect(() => assertValidEmailAddress("   ")).toThrow(InvalidEmailError);
  });

  test("rejects an email without @", () => {
    expect(() => assertValidEmailAddress("no-at-sign")).toThrow(InvalidEmailError);
  });
});

describe("assertValidTemplateId", () => {
  test("accepts a versioned template id", () => {
    expect(() => assertValidTemplateId("invitation.es.v1")).not.toThrow();
  });

  test("rejects a blank template id", () => {
    expect(() => assertValidTemplateId("")).toThrow(InvalidTemplateIdError);
    expect(() => assertValidTemplateId("   ")).toThrow(InvalidTemplateIdError);
  });
});

describe("createTemplateRenderer", () => {
  const renderer = createTemplateRenderer();

  test("uses the exact locale when available", async () => {
    const rendered = await renderer.render({
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      locale: "en",
    });
    expect(rendered.subject).toBe("Invitation to Acme");
    expect(rendered.text).toBe("You have been invited to Acme. Token: tok-1");
    expect(rendered.html).toBeNull();
  });

  test("falls back to es when the exact locale is missing", async () => {
    const rendered = await renderer.render({
      templateId: "welcome.v1",
      variables: { organizationName: "Acme" },
      locale: "en",
    });
    expect(rendered.subject).toBe("Bienvenido a Acme");
    expect(rendered.text).toBe("Tu cuenta está lista.");
  });

  test("substitutes variables and leaves unknown placeholders as-is", async () => {
    const rendered = await renderer.render({
      templateId: "invitation.v1",
      variables: { organizationName: "Acme" },
      locale: "es",
    });
    expect(rendered.subject).toBe("Invitación a Acme");
    expect(rendered.text).toBe("Has sido invitado a Acme. Token: {token}");
  });

  test("throws TemplateNotFoundError for an unknown template id", async () => {
    await expect(
      renderer.render({ templateId: "missing.v1", variables: {}, locale: "es" }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  test("html is null when the template defines none", async () => {
    const rendered = await renderer.render({
      templateId: "welcome.v1",
      variables: {},
      locale: "es",
    });
    expect(rendered.html).toBeNull();
  });
});

describe("substituteVariables", () => {
  test("replaces known placeholders and keeps unknown ones verbatim", () => {
    expect(substituteVariables("Hola {name}, tu {token} es X", { name: "Ana" })).toBe(
      "Hola Ana, tu {token} es X",
    );
  });
});

describe("createLogMailer", () => {
  test("logs a redacted summary without body text or html", async () => {
    const lines: string[] = [];
    const mailer = createLogMailer((line) => lines.push(line));
    const message = makeEmailMessage({
      to: "user@example.com",
      subject: "Invitación a Acme",
      text: "SECRET-BODY-TOKEN",
      html: "<p>SECRET-HTML-TOKEN</p>",
      templateId: "invitation.v1",
      dedupeKey: "invitation:tok:user@example.com",
    });

    await mailer.send(message);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[mailer]");
    expect(lines[0]).toContain("to=user@example.com");
    expect(lines[0]).toContain("template=invitation.v1");
    expect(lines[0]).toContain("dedupe=invitation:tok:user@example.com");
    expect(lines[0]).toContain("subject=Invitación a Acme");
    expect(lines[0]).not.toContain("SECRET-BODY-TOKEN");
    expect(lines[0]).not.toContain("SECRET-HTML-TOKEN");
  });
});

describe("createNoopMailer", () => {
  test("resolves without delivering", async () => {
    const mailer = createNoopMailer();
    await expect(mailer.send(makeEmailMessage())).resolves.toBeUndefined();
  });
});

describe("createSmtpMailer", () => {
  test("rejects a non-smtp URL at construction", () => {
    expect(() => createSmtpMailer({ url: "http://localhost:2525" })).toThrow(
      MailerUnavailableError,
    );
    expect(() => createSmtpMailer({ url: "not a url" })).toThrow(MailerUnavailableError);
  });

  test("accepts an smtp URL but fails fast at send time (stub)", async () => {
    const mailer = createSmtpMailer({ url: "smtp://user:pass@mail.example.com:587" });
    await expect(mailer.send(makeEmailMessage())).rejects.toThrow(MailerUnavailableError);
  });
});

describe("createSendNotificationService", () => {
  test("returns duplicate and does not send when the dedupe key is already recorded", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository(["invitation:tok-1:user@example.com"]);
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent,
      queue: null,
    });

    const result = await service.send({
      to: "user@example.com",
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      dedupeKey: "invitation:tok-1:user@example.com",
    });

    expect(result.status).toBe("duplicate");
    expect(mailer.sent).toHaveLength(0);
  });

  test("queued path: renders first, enqueues the job, records the dedupe key", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository();
    const queue = createFakeJobQueue();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent,
      queue,
    });

    const result = await service.send({
      to: "user@example.com",
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      dedupeKey: "invitation:tok-1:user@example.com",
    });

    expect(result.status).toBe("queued");
    expect(result.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue.jobs).toHaveLength(1);
    const job = queue.jobs[0];
    expect(job?.type).toBe(NOTIFICATION_JOB_TYPE);
    expect(job?.payload).toMatchObject({
      messageId: result.messageId,
      to: "user@example.com",
      subject: "Invitación a Acme",
      text: "Has sido invitado a Acme. Token: tok-1",
      html: null,
      templateId: "invitation.v1",
      dedupeKey: "invitation:tok-1:user@example.com",
    });
    expect(mailer.sent).toHaveLength(0);
    expect(await sent.isDuplicated("invitation:tok-1:user@example.com")).toBe(true);
  });

  test("sync path: sends via the mailer and records the dedupe key", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent,
      queue: null,
    });

    const result = await service.send({
      to: "user@example.com",
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      dedupeKey: "invitation:tok-1:user@example.com",
    });

    expect(result.status).toBe("sent");
    expect(result.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: "user@example.com",
      subject: "Invitación a Acme",
      templateId: "invitation.v1",
      dedupeKey: "invitation:tok-1:user@example.com",
    });
    expect(await sent.isDuplicated("invitation:tok-1:user@example.com")).toBe(true);
  });

  test("defaults to the es locale", async () => {
    const mailer = createFakeMailer();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent: createFakeSentMailRepository(),
      queue: null,
    });

    await service.send({
      to: "user@example.com",
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      dedupeKey: "k1",
    });

    expect(mailer.sent[0]?.subject).toBe("Invitación a Acme");
  });

  test("honors an explicit per-user locale", async () => {
    const mailer = createFakeMailer();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent: createFakeSentMailRepository(),
      queue: null,
      locale: "en",
    });

    await service.send({
      to: "user@example.com",
      templateId: "invitation.v1",
      variables: { organizationName: "Acme", token: "tok-1" },
      dedupeKey: "k1",
    });

    expect(mailer.sent[0]?.subject).toBe("Invitation to Acme");
  });

  test("rejects an invalid email without sending or recording", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent,
      queue: null,
    });

    await expect(
      service.send({
        to: "not-an-email",
        templateId: "invitation.v1",
        variables: {},
        dedupeKey: "k1",
      }),
    ).rejects.toBeInstanceOf(InvalidEmailError);
    expect(mailer.sent).toHaveLength(0);
    expect(sent.rows.size).toBe(0);
  });

  test("rejects an invalid template id", async () => {
    const service = createSendNotificationService({
      mailer: createFakeMailer(),
      templates: createTemplateRenderer(),
      sent: createFakeSentMailRepository(),
      queue: null,
    });

    await expect(
      service.send({
        to: "user@example.com",
        templateId: "",
        variables: {},
        dedupeKey: "k1",
      }),
    ).rejects.toBeInstanceOf(InvalidTemplateIdError);
  });

  test("propagates TemplateNotFoundError without sending or recording", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository();
    const service = createSendNotificationService({
      mailer,
      templates: createTemplateRenderer(),
      sent,
      queue: null,
    });

    await expect(
      service.send({
        to: "user@example.com",
        templateId: "missing.v1",
        variables: {},
        dedupeKey: "k1",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
    expect(mailer.sent).toHaveLength(0);
    expect(sent.rows.size).toBe(0);
  });
});

describe("createNotificationWorker", () => {
  test("sends a non-duplicate job and records the dedupe key", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository();
    const handler = createNotificationWorker({ mailer, sent });

    await handler({ type: NOTIFICATION_JOB_TYPE, payload: makeJobPayload() });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual({
      to: "user@example.com",
      subject: "Invitación a Acme",
      text: "Has sido invitado a Acme. Token: tok-1",
      html: null,
      templateId: "invitation.v1",
      dedupeKey: "invitation:tok-1:user@example.com",
    });
    expect(await sent.isDuplicated("invitation:tok-1:user@example.com")).toBe(true);
  });

  test("skips a duplicate job without sending", async () => {
    const mailer = createFakeMailer();
    const sent = createFakeSentMailRepository(["invitation:tok-1:user@example.com"]);
    const handler = createNotificationWorker({ mailer, sent });

    await handler({ type: NOTIFICATION_JOB_TYPE, payload: makeJobPayload() });

    expect(mailer.sent).toHaveLength(0);
  });

  test("rethrows MailerUnavailableError so the job fails and can be retried", async () => {
    const mailer = createFailingMailer();
    const sent = createFakeSentMailRepository();
    const handler = createNotificationWorker({ mailer, sent });

    await expect(
      handler({ type: NOTIFICATION_JOB_TYPE, payload: makeJobPayload() }),
    ).rejects.toBeInstanceOf(MailerUnavailableError);
    expect(await sent.isDuplicated("invitation:tok-1:user@example.com")).toBe(false);
  });

  test("sends the html body when the job carries one", async () => {
    const mailer = createFakeMailer();
    const handler = createNotificationWorker({
      mailer,
      sent: createFakeSentMailRepository(),
    });
    const html = "<p>HTML body</p>";

    await handler({
      type: NOTIFICATION_JOB_TYPE,
      payload: makeJobPayload({ html }),
    });

    expect(mailer.sent[0]?.html).toBe(html);
  });
});

describe("EmailMessage shape", () => {
  test("carries templateId and dedupeKey on every delivered message", async () => {
    const message: EmailMessage = makeEmailMessage();
    expect(message.templateId).toBe("invitation.v1");
    expect(message.dedupeKey).toContain("invitation:");
  });
});
