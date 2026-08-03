export class OutboxEventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`Outbox event not found: ${eventId}`);
    this.name = "OutboxEventNotFoundError";
  }
}
