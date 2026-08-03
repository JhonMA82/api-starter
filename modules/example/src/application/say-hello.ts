import { createGreeting } from "../domain/greeting";

export interface SayHelloInput {
  name: string;
}

export interface SayHelloResult {
  message: string;
}

/**
 * Application use case: orchestrates the domain layer for the hello route.
 * Pure orchestration — no framework or runtime imports.
 */
export function sayHello({ name }: SayHelloInput): SayHelloResult {
  return { message: `Hello, ${createGreeting(name).name}!` };
}
