import type { Locale } from "../domain/notification.entity";
import { TemplateNotFoundError } from "../domain/notification.errors";
import type { TemplateRenderer } from "./ports";

export interface TemplateDefinition {
  /** Versioned id, e.g. "invitation.v1" — bump the suffix on content change. */
  id: string;
  locales: Partial<Record<Locale, { subject: string; text: string; html: string | null }>>;
}

/**
 * Code-first versioned template registry (not a filesystem loader): content is
 * versioned by id and locales are keyed by code so renderer resolution is
 * deterministic. Spanish is the default locale per spec §16.
 */
export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: "invitation.v1",
    locales: {
      es: {
        subject: "Invitación a {organizationName}",
        text: "Has sido invitado a {organizationName}. Token: {token}",
        html: null,
      },
      en: {
        subject: "Invitation to {organizationName}",
        text: "You have been invited to {organizationName}. Token: {token}",
        html: null,
      },
    },
  },
  {
    id: "welcome.v1",
    locales: {
      es: {
        subject: "Bienvenido a {organizationName}",
        text: "Tu cuenta está lista.",
        html: null,
      },
    },
  },
];

function resolveContent(
  template: TemplateDefinition,
  locale: Locale,
): { subject: string; text: string; html: string | null } {
  // Fallback rule: exact locale -> es (default locale) -> first available.
  const exact = template.locales[locale];
  if (exact !== undefined) {
    return exact;
  }
  const spanish = template.locales.es;
  if (spanish !== undefined) {
    return spanish;
  }
  const first = Object.values(template.locales)[0];
  if (first !== undefined) {
    return first;
  }
  throw new TemplateNotFoundError(`${template.id} (no locale content)`);
}

/**
 * Replaces {placeholder} occurrences with the provided variables. Unknown
 * placeholders are left as-is (no throw) so a missing variable never
 * aborts delivery.
 */
export function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined ? match : value;
  });
}

/**
 * Template registry-backed renderer. Rendering is synchronous underneath but
 * the interface is async to leave room for future filesystem/DB-backed
 * template sources.
 */
export function createTemplateRenderer(): TemplateRenderer {
  const byId = new Map(TEMPLATES.map((template) => [template.id, template]));
  return {
    async render({ templateId, variables, locale }) {
      const template = byId.get(templateId);
      if (template === undefined) {
        throw new TemplateNotFoundError(templateId);
      }
      const content = resolveContent(template, locale);
      return {
        subject: substituteVariables(content.subject, variables),
        text: substituteVariables(content.text, variables),
        // html is null when the template defines no HTML variant.
        html: content.html === null ? null : substituteVariables(content.html, variables),
      };
    },
  };
}
