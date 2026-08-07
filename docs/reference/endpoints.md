# Endpoints

**Audiencia:** usuarios y desarrolladores de proyectos generados.
**Objetivo:** referencia de rutas del **repositorio completo** del starter.

> Un proyecto generado puede no incluir todos estos endpoints: las rutas dependen de las features seleccionadas (auth, tenancy, archivos, webhooks…). El contrato vigente de cualquier instancia está en `/openapi.json` y en `/docs` (Scalar) de esa instancia.

## Base

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Sonda de vida (liveness) |
| GET | `/ready` | Sonda de disponibilidad (readiness) |
| GET | `/version` | Nombre, versión y entorno del servicio |
| GET | `/metrics` | Métricas en formato texto Prometheus |
| GET | `/openapi.json` | Documento OpenAPI 3.1 generado desde los contratos |
| GET | `/docs` | Documentación interactiva (Scalar) |

## Autenticación (feature `auth`)

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/api/auth/*` | Registro, sesión, cierre, revocación, bearer |

## Autorización (feature `authorization`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/authorization/protected` | Ruta demo protegida por permiso `request.read` (requiere sesión) |
| GET | `/api/v1/authorization/admin` | Ruta demo protegida por permiso `request.delete` (solo rol admin) |

## Organizaciones (feature `tenancy`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/organizations` | Crea una organización propiedad del usuario autenticado |
| GET | `/api/v1/organizations/:id` | Contexto de tenant del llamante (requiere `x-organization-id`) |
| POST | `/api/v1/organizations/:id/invitations` | Invita por email; devuelve el token de un solo uso |
| POST | `/api/v1/organizations/accept-invitation` | Acepta una invitación con su token |
| POST | `/api/v1/organizations/:id/ownership` | Transfiere la propiedad a otro miembro |
| POST | `/api/v1/organizations/:id/suspend` | Suspende la organización |
| DELETE | `/api/v1/organizations/:id/members/:userId` | Elimina un miembro (el último owner no puede eliminarse) |
| DELETE | `/api/v1/organizations/:id?confirm=true` | Borra la organización tras confirmación fuerte (cascada) |

## API keys (feature `apiKeys`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/organizations/:id/api-keys` | Crea una API key; devuelve el secreto una sola vez |
| DELETE | `/api/v1/organizations/:id/api-keys/:keyId` | Revoca una API key |

## Webhooks (feature `webhooks`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/organizations/:id/webhooks` | Registra un webhook saliente; secreto de firma mostrado una sola vez |
| GET | `/api/v1/organizations/:id/webhooks` | Lista los webhooks salientes del tenant |
| POST | `/api/v1/organizations/:id/webhooks/:webhookId/rotate` | Rota el secreto de firma de un webhook |
| POST | `/api/v1/organizations/:id/webhooks/:webhookId/toggle` | Activa/desactiva un webhook saliente |
| GET | `/api/v1/organizations/:id/webhooks/:webhookId/deliveries` | Historial de entregas de un webhook |
| POST | `/api/v1/webhooks/incoming/:provider` | Webhook entrante público firmado con HMAC (202 aceptado/duplicado, 401 firma inválida, 404 proveedor desconocido) |

## Archivos (feature `files`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/files` | Sube un archivo multipart; devuelve 201 + `downloadUrl` de un solo uso |
| GET | `/api/v1/files?limit` | Lista los archivos del tenant |
| GET | `/api/v1/files/:id` | Metadatos de un archivo del tenant |
| DELETE | `/api/v1/files/:id` | Soft-delete de un archivo (204) |
| GET | `/api/v1/files/download?token` | Descarga pública firmada con HMAC (el token ES la autorización; 401 expirado/malformado, 404 borrado) |
| POST | `/api/v1/files/:id/url` | URL firmada nueva (1 h por defecto, tope 24 h) |

## Módulo de ejemplo

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/example/hello?name=...` | Módulo de ejemplo (demuestra la estructura por capas) |

## Errores

Los errores se devuelven como `application/problem+json` (RFC 9457) con `code`, `requestId` e `instance`; nunca se filtran stack traces ni internos (ver [architecture/capabilities.md](../architecture/capabilities.md#modelo-de-errores-y-contratos-base)).
