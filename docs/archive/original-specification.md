# Especificación para crear un backend Hono reutilizable

> **HISTÓRICO** — Documento archivado. Es la especificación original del starter, conservada como trazabilidad. No es la fuente vigente de uso, arquitectura ni operación: ver [`docs/README.md`](../README.md).

> **Documento de ejecución para OpenCode y el harness activo**  
> **Fecha de referencia:** 2026-08-02  
> **Nombre provisional del proyecto:** `consulting-hono-api-starter`

---

## 1. Instrucción principal

Construye un **starter de backend API reutilizable, modular y generable**, pensado para conectarse con diferentes interfaces y aplicaciones de la consultoría sin quedar acoplado a ninguna de ellas.

El starter debe servir tanto para:

- una API pequeña y pública;
- una aplicación single-tenant con usuarios;
- una aplicación institucional con roles y permisos;
- una plataforma multi-tenant;
- una API de integraciones, webhooks y automatizaciones;
- un backend compartido por web, móvil y escritorio.

No construyas una aplicación de negocio concreta. Construye una **base versionable y extensible**, acompañada de generadores, documentación, pruebas, perfiles y contratos.

Usa el flujo normal del harness activo:

1. análisis;
2. especificación;
3. plan;
4. tareas pequeñas;
5. implementación;
6. pruebas;
7. revisión arquitectónica;
8. documentación;
9. validación final.

No marques la solución como terminada mientras no se cumplan todos los criterios de aceptación de este documento.

---

# 2. Contexto de uso

El backend se utilizará en soluciones de desarrollo a medida, automatización, productividad con IA y optimización de procesos para:

- gobiernos;
- escuelas;
- sindicatos;
- pymes;
- productos propios de la consultoría.

Debe poder integrarse con los boilerplates y stacks ya seleccionados:

| Cliente o plataforma | Papel |
|---|---|
| Stardrive | Sitios públicos, landing pages, documentación y formularios públicos |
| TanStack Shadcn Admin Dashboard | Frontend administrativo predeterminado |
| Next Shadcn Admin Dashboard | Productos híbridos con sitio público y aplicación |
| Ignite | Aplicaciones móviles React Native |
| Tauri UI | Aplicaciones de escritorio |
| Vercel Chatbot o AI Assistant Starter | Interfaces de IA que consumen herramientas de la API |
| n8n y automatizaciones | Consumo mediante REST, API keys y webhooks |
| SpeedPy | Aplicaciones Python centradas en datos y documentos |
| Full Stack FastAPI Template | Proyectos donde Python y una API independiente sean la base principal |
| Open SaaS | Productos SaaS donde se adopte Wasp como arquitectura completa |

## Regla de integración

Este backend **no debe utilizarse por obligación en todos los proyectos**.

- Si SpeedPy resuelve mejor una aplicación de datos, formularios y documentos en un solo proyecto, no agregar Hono innecesariamente.
- Si Full Stack FastAPI Template es la base elegida, no duplicar la misma API con Hono.
- Si Open SaaS/Wasp es la arquitectura seleccionada, no agregar un segundo backend salvo que exista una frontera funcional clara.
- Stardrive no necesita este backend cuando el sitio es completamente estático.
- Una herramienta local Tauri no necesita un servidor remoto cuando toda la operación puede ejecutarse localmente.

El starter debe ofrecer una opción sólida, no convertirse en una dependencia universal.

---

# 3. Decisiones técnicas obligatorias

## 3.1 Stack base

Usa como base:

- **TypeScript estricto**.
- **Bun** como package manager, runner y runtime inicial.
- **Hono** como framework HTTP.
- **PostgreSQL** como base de datos predeterminada cuando se habilite persistencia.
- **Drizzle ORM** y **Drizzle Kit** para esquema, consultas y migraciones.
- **`postgres.js` como driver predeterminado**, para evitar acoplar la persistencia exclusivamente a `Bun.SQL`.
- **Zod** como esquema y validación inicial.
- **`hono-openapi`** o la integración oficial recomendada por Hono al momento de implementar para generar OpenAPI desde esquemas compatibles con Standard Schema.
- **Scalar** para documentación interactiva de la API.
- **Better Auth** para identidad, sesiones y proveedores de autenticación cuando el perfil habilite autenticación.
- **Biome** para formato y análisis estático.
- **Bun Test** para pruebas.
- **Docker** y Docker Compose para desarrollo y despliegue reproducible.
- **GitHub Actions** para integración continua.
- **OpenTelemetry** como módulo opcional de observabilidad productiva.

## 3.2 Portabilidad

Aunque Bun será el runtime inicial:

- la lógica de dominio no debe importar APIs de Bun;
- los casos de uso no deben depender de `Hono.Context`;
- los repositorios no deben exponer detalles del driver;
- los paquetes de dominio y aplicación deben poder probarse sin servidor HTTP;
- debe existir un adaptador de runtime separado;
- no uses `Bun.SQL` como dependencia obligatoria del dominio;
- documenta las dependencias que impidan ejecutar la API sobre Node.js.

La portabilidad no significa prometer compatibilidad automática con todos los runtimes. Significa impedir acoplamientos innecesarios.

## 3.3 Contrato API

La API debe ofrecer dos vías compatibles:

### Contrato público

- REST sobre HTTP.
- OpenAPI 3.1 como documentación y contrato interoperable.
- Respuestas y códigos de error explícitos.
- Compatible con clientes que no utilizan TypeScript.

### Cliente interno TypeScript

- Hono RPC o un SDK tipado derivado del contrato.
- Debe poder usarse desde TanStack Start, Next.js, Ignite y Tauri.
- No debe ser el único medio de consumir la API.

La especificación OpenAPI es obligatoria. Hono RPC es una comodidad interna.

## 3.4 Arquitectura

Construye un **monolito modular**, no microservicios.

- Los módulos deben tener fronteras explícitas.
- La lógica de negocio debe vivir fuera de los handlers.
- Los módulos pueden publicar eventos internos.
- Los servicios externos pueden extraerse posteriormente si existe una razón operativa demostrable.
- No agregues mensajería distribuida, service mesh ni Kubernetes al starter base.

---

# 4. Perfiles generables

El starter debe incluir un generador capaz de producir proyectos con perfiles. Los perfiles son presets; las capacidades deben seguir siendo configurables individualmente.

## 4.1 Perfil `minimal`

Para APIs simples, públicas o sin persistencia.

Incluye:

- Hono;
- configuración validada;
- errores estándar;
- request ID;
- logging;
- CORS configurable;
- headers seguros;
- límites de cuerpo;
- health check;
- readiness check básico;
- OpenAPI;
- documentación Scalar;
- pruebas;
- Docker;
- CI.

No incluye:

- base de datos;
- autenticación;
- organizaciones;
- roles;
- auditoría persistente;
- jobs;
- archivos.

Casos:

- proxy controlado;
- endpoint público;
- API para cálculo;
- webhook receiver simple;
- servicio temporal;
- integración sin estado.

## 4.2 Perfil `data-api`

Para APIs con persistencia, pero sin cuentas de usuario.

Incluye:

- todo `minimal`;
- PostgreSQL;
- Drizzle;
- migraciones;
- repositorios;
- transacciones;
- paginación;
- filtros;
- seeds;
- auditoría técnica opcional.

Autenticación opcional:

- ninguna;
- API key;
- red privada;
- autenticación de servicio.

Casos:

- catálogo público;
- API de consulta;
- importador;
- integración interna;
- servicio consumido por n8n;
- backend de una herramienta local.

## 4.3 Perfil `authenticated`

Para aplicaciones single-tenant.

Incluye:

- todo `data-api`;
- Better Auth;
- usuarios;
- sesiones;
- recuperación de acceso;
- verificación de correo configurable;
- roles globales opcionales;
- auditoría;
- administración de sesiones;
- cliente de autenticación;
- protección de endpoints.

No incluye organizaciones ni `organizationId` en todas las tablas.

Casos:

- herramienta interna de una sola empresa;
- sistema de una sola escuela;
- portal de un solo sindicato;
- aplicación de un municipio con una sola instancia;
- producto con usuarios, pero sin separación por clientes.

## 4.4 Perfil `multi-tenant`

Para una sola instalación que atiende múltiples organizaciones.

Incluye:

- todo `authenticated`;
- organizaciones;
- membresías;
- invitaciones;
- organización activa;
- roles por organización;
- permisos;
- RBAC + políticas ABAC explícitas;
- transferencia de propiedad;
- ciclo de vida de organización;
- auditoría por tenant;
- aislamiento obligatorio;
- API keys por organización opcionales;
- dominios de organización opcionales;
- PostgreSQL Row-Level Security opcional.

Casos:

- varias escuelas en una plataforma;
- delegaciones sindicales;
- municipios o dependencias separadas;
- SaaS B2B;
- múltiples empresas clientes.

## 4.5 Perfil `integration`

Para APIs enfocadas en automatización e interoperabilidad.

Incluye:

- todo `data-api`;
- API keys;
- webhooks entrantes y salientes;
- firma de webhooks;
- reintentos;
- idempotencia;
- outbox transaccional;
- worker;
- tareas programadas;
- auditoría;
- documentación de integraciones.

Autenticación de usuarios es opcional.

Casos:

- gateway de integraciones;
- sincronización entre sistemas;
- n8n;
- importación y exportación;
- receptor de eventos;
- automatizaciones institucionales.

## 4.6 Perfil `platform`

Incluye todas las capacidades productivas:

- autenticación;
- multi-tenancy;
- autorización;
- auditoría;
- API keys;
- webhooks;
- jobs;
- archivos;
- notificaciones;
- observabilidad;
- SDK;
- documentación completa.

No debe ser el perfil predeterminado.

## 4.7 Regla contra el sobrediseño

El generador debe excluir físicamente los módulos y dependencias no elegidos. No basta con dejar todo instalado y desactivarlo mediante variables.

Ejemplos:

- `minimal` no instala Drizzle ni Better Auth.
- `authenticated` no crea tablas de organizaciones.
- `multi-tenant` sí crea restricciones e índices por organización.
- `integration` no agrega UI o flujos de usuario si no se solicitaron.
- Redis no se instala si no existe una capacidad que lo requiera.

---

# 5. Estructura esperada del starter

Construye el repositorio maestro con una estructura equivalente a:

```text
consulting-hono-api-starter/
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
├── package.json
├── bun.lock
├── bunfig.toml
├── tsconfig.json
├── biome.json
├── docker-compose.yml
├── Dockerfile
├── catalog/
│   ├── features.json
│   ├── profiles.json
│   └── dependencies.json
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── bootstrap.ts
│   │   │   └── routes.ts
│   │   └── package.json
│   └── worker/
│       ├── src/
│       └── package.json
├── packages/
│   ├── config/
│   ├── core/
│   ├── contracts/
│   ├── database/
│   ├── auth/
│   ├── tenancy/
│   ├── authorization/
│   ├── audit/
│   ├── events/
│   ├── jobs/
│   ├── webhooks/
│   ├── files/
│   ├── notifications/
│   ├── sdk/
│   └── testing/
├── modules/
│   ├── users/
│   ├── organizations/
│   ├── memberships/
│   ├── invitations/
│   ├── roles/
│   ├── api-keys/
│   └── example/
├── templates/
│   ├── base/
│   ├── features/
│   └── profiles/
├── scripts/
│   ├── create-project.ts
│   ├── add-feature.ts
│   ├── create-module.ts
│   ├── validate-architecture.ts
│   ├── validate-openapi.ts
│   └── validate-profile.ts
├── docs/
│   ├── architecture.md
│   ├── project-generation.md
│   ├── API.md
│   ├── authentication.md
│   ├── authorization.md
│   ├── tenancy.md
│   ├── database.md
│   ├── testing.md
│   ├── deployment.md
│   ├── frontend-integrations.md
│   ├── threat-model.md
│   ├── runbooks/
│   └── decisions/
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── PULL_REQUEST_TEMPLATE.md
```

La implementación final puede ajustar nombres, pero debe conservar la separación conceptual.

---

# 6. Arquitectura interna de cada módulo

Cada módulo funcional debe usar una estructura clara:

```text
modules/requests/
├── domain/
│   ├── request.entity.ts
│   ├── request.errors.ts
│   ├── request.events.ts
│   └── request.policy.ts
├── application/
│   ├── create-request.use-case.ts
│   ├── update-request.use-case.ts
│   ├── approve-request.use-case.ts
│   └── ports.ts
├── infrastructure/
│   ├── request.repository.ts
│   ├── request.mapper.ts
│   └── request.schema.ts
├── http/
│   ├── request.contract.ts
│   ├── request.routes.ts
│   └── request.presenter.ts
├── tests/
└── index.ts
```

## Reglas de dependencia

```text
domain
↑
application
↑
infrastructure / http
```

- `domain` no importa Hono, Drizzle, Better Auth ni Bun.
- `application` depende de puertos, no de implementaciones concretas.
- `infrastructure` implementa repositorios y adaptadores.
- `http` valida, autentica, autoriza, ejecuta un caso de uso y presenta la respuesta.
- Un handler no contiene consultas SQL.
- Un repositorio no toma decisiones de permisos.
- Una política no ejecuta HTTP.
- El dominio no conoce códigos de estado.

Agrega validación automática de fronteras con Dependency Cruiser o una herramienta equivalente.

---

# 7. Núcleo HTTP

Implementa desde el perfil mínimo:

## 7.1 Endpoints base

```text
GET /health
GET /ready
GET /version
GET /openapi.json
GET /docs
```

`/ready` debe comprobar dependencias habilitadas:

- base de datos;
- cola;
- almacenamiento;
- proveedor de correo;

pero sin exponer secretos.

## 7.2 Middleware base

- request ID;
- logging estructurado;
- secure headers;
- CORS por allowlist;
- límite de tamaño;
- timeout;
- compresión cuando aplique;
- normalización de errores;
- métricas opcionales;
- trazas opcionales.

No uses `*` como origen CORS en producción cuando se permiten credenciales.

## 7.3 Respuesta de error

Usa una estructura consistente basada en Problem Details:

```json
{
  "type": "https://errors.example.com/authorization/forbidden",
  "title": "Forbidden",
  "status": 403,
  "code": "AUTHORIZATION_FORBIDDEN",
  "detail": "The current actor cannot perform this action.",
  "instance": "/api/v1/requests/123",
  "requestId": "req_...",
  "errors": []
}
```

Reglas:

- `code` es estable y procesable.
- `detail` puede ser traducible.
- no exponer stack traces;
- no filtrar nombres de tablas;
- no confirmar existencia de recursos de otro tenant;
- errores de validación deben identificar campos;
- todos los errores deben documentarse en OpenAPI.

## 7.4 Versionado

Usa:

```text
/api/v1
```

No versionar cada cambio. Incrementar versión solo cuando exista una ruptura contractual real.

## 7.5 Paginación

- Cursor como opción predeterminada para listas grandes o cambiantes.
- Offset permitido para pantallas administrativas pequeñas y reportes.
- Respuestas con metadatos consistentes.
- Límites máximos configurables.
- Orden estable obligatorio.

---

# 8. Contratos, OpenAPI y SDK

## 8.1 Fuente de verdad

Los esquemas de entrada y salida deben vivir cerca del contrato HTTP y reutilizarse en:

- validación;
- OpenAPI;
- tipos;
- cliente;
- pruebas.

No mantengas manualmente:

- un DTO;
- un esquema Zod;
- un tipo TypeScript;
- y un OpenAPI diferente;

para la misma operación.

## 8.2 OpenAPI

Debe incluir:

- entradas;
- respuestas;
- errores;
- autenticación;
- tags;
- ejemplos;
- paginación;
- idempotencia;
- webhooks cuando aplique.

La CI debe:

1. generar `openapi.json`;
2. comprobar que sea válido;
3. detectar cambios;
4. fallar si se agrega una ruta sin documentación;
5. publicar el artefacto.

## 8.3 SDK TypeScript

Crea un paquete `@consulting/api-sdk`.

Debe poder consumirse desde repositorios separados.

Opciones:

- generar el SDK desde OpenAPI;
- o publicar un cliente Hono RPC como paquete de tipos.

Preferencia:

1. OpenAPI como contrato estable;
2. SDK generado para consumo entre repositorios;
3. Hono RPC como opción adicional dentro de un monorepo.

## 8.4 Compatibilidad

El SDK no debe importar código de servidor que arrastre:

- Drizzle;
- Better Auth server;
- variables privadas;
- driver PostgreSQL;
- Hono runtime;
- módulos de Node/Bun innecesarios.

---

# 9. Persistencia y Drizzle

## 9.1 PostgreSQL

PostgreSQL es la opción predeterminada para:

- consistencia;
- transacciones;
- índices;
- JSONB cuando sea justificado;
- auditoría;
- constraints;
- Row-Level Security opcional;
- extensiones futuras.

SQLite puede ofrecerse en otro starter local, pero no debe complicar este starter intentando soportar dos dialectos desde el principio.

## 9.2 Driver

Usa `postgres.js` inicialmente porque:

- funciona con Bun;
- evita acoplar la capa de datos a Bun;
- tiene integración con Drizzle;
- permite conservar una ruta a Node.

No uses simultáneamente varios drivers.

## 9.3 Migraciones

- Generar migraciones SQL con Drizzle Kit.
- Commitear todas las migraciones.
- Prohibir `push` directo en producción.
- Probar migración desde base vacía.
- Probar actualización desde la versión anterior.
- Usar transacciones cuando PostgreSQL lo permita.
- Documentar migraciones destructivas.
- Crear runbook de rollback o forward-fix.
- No editar una migración ya desplegada.

## 9.4 Integridad

Usa constraints de base de datos:

- claves foráneas;
- únicos;
- checks;
- `NOT NULL`;
- índices compuestos;
- cascadas explícitas;
- estados válidos.

No depender únicamente de validación TypeScript.

## 9.5 Transacciones

Los casos de uso que modifiquen varias entidades deben recibir un `UnitOfWork` o contexto transaccional.

Ejemplos:

- aceptar invitación;
- transferir propiedad;
- eliminar organización;
- emitir evento de outbox;
- cambiar rol;
- generar webhook.

---

# 10. Autenticación

## 10.1 Better Auth

Usa Better Auth para:

- identidad;
- sesiones;
- email y contraseña;
- verificación;
- recuperación;
- proveedores OAuth opcionales;
- 2FA opcional;
- passkeys opcionales;
- administración de sesiones.

Aísla Better Auth detrás de `packages/auth`.

El dominio no debe depender directamente de sus tablas o tipos.

## 10.2 Auth no es autorización

Separa estrictamente:

```text
Autenticación
└── Quién es el actor

Autorización
└── Qué puede hacer sobre un recurso y dentro de qué alcance
```

No uses los roles de Better Auth como la única política de negocio.

## 10.3 Sesiones web

Para TanStack Start, Next.js y Stardrive cuando corresponda:

- cookies `HttpOnly`;
- `Secure` en producción;
- `SameSite` adecuado;
- rotación y revocación;
- trusted origins;
- protección CSRF cuando la topología lo requiera;
- no guardar tokens sensibles en `localStorage`.

## 10.4 Mobile y escritorio

Para Ignite y Tauri:

- no reutilizar de forma improvisada cookies del navegador;
- usar Authorization Code + PKCE cuando se habilite OAuth;
- o una estrategia Bearer documentada y segura;
- guardar credenciales en Keychain/Keystore o almacenamiento seguro de Tauri;
- soportar revocación;
- usar tokens de corta duración;
- no incluir secretos de cliente dentro de apps públicas.

## 10.5 Servicio a servicio

Ofrecer como capacidades opcionales:

- API keys;
- OAuth 2.1 provider;
- scopes;
- expiración;
- rotación;
- último uso;
- rate limiting;
- ownership por usuario u organización.

Las API keys deben almacenarse hasheadas. Mostrar el secreto solo al crearlo.

---

# 11. Single-tenant frente a multi-tenant

## 11.1 No forzar multi-tenancy

El perfil single-tenant no debe incluir:

- tabla `organizations`;
- `organization_id` en cada tabla;
- selector de organización;
- invitaciones por tenant;
- roles por organización.

No conviertas una escuela única o un sistema municipal único en un SaaS artificial.

## 11.2 Modelo multi-tenant predeterminado

Cuando se active multi-tenancy, usar:

```text
Base compartida
└── esquema compartido
    └── filas separadas por organization_id
```

No usar base de datos por tenant como opción predeterminada.

## 11.3 Entidades mínimas

```text
organizations
organization_settings
memberships
invitations
roles
role_permissions
membership_roles
organization_domains        opcional
ownership_transfers         opcional
```

Better Auth puede gestionar identidad y sesiones. La consultoría debe conservar control sobre el dominio institucional.

## 11.4 Tenant context

Cada petición tenant-scoped debe resolver un contexto:

```ts
type TenantContext = {
  organizationId: string
  membershipId: string
  userId: string
  roleIds: string[]
}
```

El `organizationId` enviado por el cliente nunca es suficiente.

Flujo obligatorio:

1. autenticar usuario;
2. resolver organización solicitada;
3. verificar membresía activa;
4. cargar roles;
5. comprobar permiso;
6. ejecutar el caso de uso;
7. consultar mediante repositorio tenant-scoped;
8. registrar auditoría.

## 11.5 Repositorios tenant-scoped

Los repositorios de recursos tenant deben requerir `TenantContext` o `organizationId` de forma no opcional.

No permitas métodos como:

```ts
findById(id)
```

para recursos tenant.

Usa:

```ts
findById({ organizationId, id })
```

o crea el repositorio desde un contexto ya limitado.

## 11.6 Protección contra IDOR

Una petición a un recurso de otra organización debe responder sin revelar:

- que el recurso existe;
- su tipo;
- su propietario;
- su estado.

Agrega pruebas automáticas para cada nuevo recurso tenant-scoped.

## 11.7 Row-Level Security

RLS es opcional como defensa adicional.

Habilitarla en perfiles o clientes que lo justifiquen:

- datos sensibles;
- múltiples tenants externos;
- requisitos regulatorios;
- equipos grandes;
- alto riesgo de consultas directas.

RLS no sustituye la autorización de aplicación.

## 11.8 Ciclo de vida

Implementa invariantes:

- una organización siempre debe conservar al menos un owner;
- un owner no puede abandonar sin transferir propiedad;
- una invitación expira;
- una invitación no puede reutilizarse;
- eliminar organización requiere confirmación fuerte;
- suspender organización bloquea acceso, pero conserva auditoría;
- membresías inactivas no autorizan;
- cambios críticos revocan sesiones cuando corresponda.

---

# 12. Autorización: RBAC + ABAC

## 12.1 Modelo híbrido

Usa tres capas:

### Roles del sistema

Definidos en código y no editables por tenants:

```text
SYSTEM_ADMIN
SUPPORT_AGENT
SECURITY_AUDITOR
```

No deben mezclarse con roles de una organización.

### Roles de organización

Configurables o predefinidos:

```text
OWNER
ADMIN
AUDITOR
MEMBER
```

Una aplicación puede agregar:

```text
DIRECTOR
COORDINATOR
CAPTURIST
REVIEWER
APPROVER
TEACHER
DELEGATE
REPRESENTATIVE
VIEWER
```

### Permisos

Catálogo estable:

```text
request.create
request.read
request.update
request.assign
request.review
request.approve
request.reject
request.export
request.delete
```

Los roles agrupan permisos.

## 12.2 ABAC explícito

Las condiciones sensibles deben implementarse como políticas de código legibles:

- mismo tenant;
- propietario del recurso;
- departamento;
- sede o plantel;
- asignación;
- estado del workflow;
- vigencia;
- clasificación del dato;
- separación de funciones.

Ejemplo:

```ts
canUpdateRequest({
  actor,
  request,
  tenant,
  now,
})
```

No construyas inicialmente un motor genérico de reglas JSON.

## 12.3 Denegar por defecto

Si no existe una concesión explícita:

```text
DENY
```

No uses `manage all` como regla general para administradores institucionales.

## 12.4 Autorización backend

El frontend puede ocultar botones para mejorar UX, pero el backend siempre valida:

- sesión;
- tenant;
- membresía;
- rol;
- permiso;
- condición;
- estado del recurso.

## 12.5 Matriz de permisos

Genera documentación y pruebas desde una matriz declarativa.

Ejemplo:

```text
resource, action, owner, admin, reviewer, member
request, create, yes, yes, no, yes
request, approve, no, yes, yes, no
request, delete, conditional, yes, no, no
```

La CI debe detectar permisos sin prueba.

---

# 13. Auditoría

## 13.1 Auditoría de negocio

Implementar un log append-only para acciones relevantes:

- actor;
- tenant;
- acción;
- recurso;
- ID del recurso;
- fecha;
- request ID;
- resultado;
- IP y user-agent cuando sea apropiado;
- cambios antes/después redactados;
- metadata segura.

No guardar:

- contraseñas;
- tokens;
- secretos;
- documentos completos;
- datos personales innecesarios.

## 13.2 Eventos mínimos

- login y logout relevantes;
- fallos de autenticación significativos;
- creación/eliminación de organización;
- invitaciones;
- cambio de roles;
- transferencia de propiedad;
- exportaciones;
- cambios de configuración;
- generación o revocación de API keys;
- acciones de soporte;
- acceso a datos especialmente sensibles.

## 13.3 Diferencia con logging

```text
Logging
└── diagnóstico técnico

Audit log
└── trazabilidad de acciones y decisiones
```

No sustituir uno por otro.

---

# 14. Eventos, outbox, jobs y webhooks

## 14.1 Módulos opcionales

No incluir worker ni cola en perfiles que no los necesitan.

## 14.2 Eventos de dominio

Los casos de uso pueden emitir eventos:

```text
OrganizationCreated
MemberInvited
InvitationAccepted
RoleChanged
OwnershipTransferred
RequestApproved
```

Los eventos no deben enviar correo directamente dentro del caso de uso.

## 14.3 Outbox transaccional

Cuando se habiliten integraciones:

1. modificar el dominio;
2. guardar evento en outbox dentro de la misma transacción;
3. worker procesa el evento;
4. registrar intentos;
5. aplicar reintentos;
6. mover fallos permanentes a estado dead-letter;
7. permitir reproceso controlado.

## 14.4 Cola

Implementa una interfaz:

```ts
interface JobQueue {
  enqueue(...): Promise<void>
  schedule(...): Promise<void>
  cancel(...): Promise<void>
}
```

No acoples casos de uso a BullMQ, Redis o una librería específica.

Adaptadores:

- implementación PostgreSQL para instalaciones simples;
- implementación Redis/BullMQ solo cuando Redis ya esté justificado;
- implementación in-memory únicamente para pruebas.

Antes de elegir una librería de cola PostgreSQL, prueba compatibilidad real con Bun.

## 14.5 Webhooks salientes

- firma HMAC;
- timestamp;
- prevención de replay;
- IDs de evento;
- idempotencia;
- reintentos exponenciales;
- historial de entregas;
- rotación de secretos;
- prueba manual controlada;
- allowlist opcional;
- no registrar payloads sensibles sin redacción.

## 14.6 Webhooks entrantes

- verificar firma antes de parsear negocio;
- conservar cuerpo raw cuando el proveedor lo requiera;
- responder pronto;
- procesar de forma asíncrona;
- usar idempotencia;
- registrar proveedor y event ID.

---

# 15. Archivos

Módulo opcional con interfaz S3-compatible.

Adaptadores posibles:

- MinIO;
- AWS S3;
- Cloudflare R2;
- proveedor compatible.

Requisitos:

- URLs firmadas;
- límites de tamaño;
- MIME allowlist;
- nombre generado por servidor;
- hash;
- metadata;
- ownership;
- tenant;
- antivirus opcional;
- estado de procesamiento;
- eliminación y retención;
- no servir uploads directamente desde el proceso API.

Los archivos son referencias. No guardes blobs grandes en PostgreSQL por defecto.

---

# 16. Notificaciones y correo

Módulo opcional.

Define interfaces:

```ts
interface Mailer {}
interface NotificationChannel {}
interface TemplateRenderer {}
```

Canales posibles:

- correo;
- notificación interna;
- push;
- SMS;
- WhatsApp mediante proveedor autorizado.

Requisitos:

- plantillas versionadas;
- español como idioma predeterminado configurable;
- locale por usuario;
- preferencia de notificaciones;
- logs sin contenido sensible;
- reintentos;
- deduplicación;
- previews en desarrollo.

No atar el dominio a Resend, SendGrid u otro proveedor.

---

# 17. Integración con los boilerplates seleccionados

## 17.1 TanStack Start Admin

Es el frontend administrativo predeterminado.

Proveer:

- SDK TypeScript;
- ejemplos con TanStack Query;
- manejo de errores tipados;
- organización activa;
- invalidación;
- permisos para UX;
- autenticación con cookies cuando comparta sitio;
- SSR documentado;
- proxy/BFF opcional, no obligatorio.

No incorporar lógica de seguridad solo en loaders.

## 17.2 Next.js Admin

Proveer:

- cliente server-safe;
- cliente browser-safe;
- manejo de cookies;
- integración con Server Components cuando corresponda;
- fetch sin caché accidental para datos sensibles;
- revalidación explícita;
- separación entre Server Actions y API externa.

No crear endpoints duplicados en Next.js que reimplementen el dominio.

## 17.3 Ignite

Proveer:

- SDK compatible con React Native;
- estrategia de login móvil;
- almacenamiento seguro;
- refresh/revocación;
- manejo offline;
- reintentos seguros;
- idempotencia;
- paginación;
- subida de archivos.

No asumir cookies web.

## 17.4 Tauri UI

Proveer:

- SDK;
- autenticación con navegador del sistema o flujo seguro;
- almacenamiento en keyring;
- URLs de callback;
- configuración por ambiente;
- soporte para operación local/remota;
- política CORS.

No guardar secretos en archivos planos.

## 17.5 Stardrive

Consumir únicamente cuando sea necesario:

- formularios;
- newsletter;
- búsqueda;
- contenido dinámico;
- consulta pública.

Usar:

- endpoints públicos limitados;
- CAPTCHA cuando aplique;
- rate limiting;
- validación;
- protección contra spam;
- CORS restrictivo.

## 17.6 AI Assistant Starter

Exponer herramientas de IA mediante endpoints con:

- scopes;
- identidad del actor;
- tenant;
- autorización;
- schemas;
- confirmación para acciones críticas;
- auditoría;
- idempotencia;
- límites de consumo.

Nunca dar acceso directo del modelo a la base de datos.

## 17.7 n8n

Proveer:

- OpenAPI;
- API keys por organización;
- scopes;
- webhooks;
- paginación;
- rate limits;
- entornos;
- idempotencia;
- ejemplos.

## 17.8 SpeedPy y FastAPI

No compartir tablas ni base de datos como mecanismo de integración.

Usar:

- REST/OpenAPI;
- API keys;
- OAuth;
- eventos;
- webhooks;
- jobs.

Extraer un servicio Python cuando la capacidad esté dominada por:

- OCR;
- documentos;
- pandas;
- Polars;
- IA;
- modelos;
- reportes complejos.

Hono conserva:

- identidad;
- organizaciones;
- permisos;
- auditoría;
- coordinación.

## 17.9 Open SaaS

Elegir entre:

- arquitectura Wasp/Open SaaS;
- o backend Hono propio.

No mezclar ambos full-stack sin una frontera explícita.

---

# 18. Generador de proyectos

Implementa:

```bash
bun run create:project
```

Modo interactivo y flags:

```bash
bun run create:project -- \
  --name=my-api \
  --profile=authenticated \
  --runtime=bun \
  --database=postgres \
  --auth=better-auth \
  --openapi \
  --docker \
  --ci=github
```

Para multi-tenant:

```bash
bun run create:project -- \
  --name=institutional-platform \
  --profile=multi-tenant \
  --roles=dynamic \
  --audit \
  --api-keys \
  --webhooks \
  --files=s3
```

## 18.1 Configuración generada

Crear:

```ts
export default defineStarterConfig({
  profile: "multi-tenant",
  runtime: "bun",
  database: "postgres",
  features: {
    auth: true,
    tenancy: true,
    dynamicRoles: true,
    audit: true,
    apiKeys: true,
    webhooks: false,
    jobs: false,
    files: false,
    notifications: true,
    observability: true,
  },
})
```

## 18.2 Validación del generador

El generador debe impedir combinaciones inválidas.

Ejemplos:

- `multiTenant` requiere `auth` y `database`.
- `webhooks` requiere persistencia.
- `jobs` requiere worker.
- `organizationApiKeys` requiere tenancy.
- `files` requiere proveedor.
- `auth=false` no genera páginas o endpoints de sesión.
- `minimal` no debe arrastrar Drizzle.

## 18.3 Idempotencia

Ejecutar el generador dos veces sobre el mismo destino debe:

- fallar de forma segura;
- o requerir `--force`;
- nunca sobrescribir trabajo silenciosamente.

## 18.4 Agregar capacidad

Implementa:

```bash
bun run add:feature -- audit
bun run add:feature -- webhooks
bun run add:feature -- multitenancy
```

Cada feature debe incluir:

- código;
- dependencias;
- migraciones;
- configuración;
- pruebas;
- documentación;
- actualización de AGENTS.md.

Agregar multi-tenancy a un proyecto existente debe emitir una advertencia y generar un plan de migración, no modificar datos automáticamente.

## 18.5 Generador de módulos

```bash
bun run create:module -- requests --scope=tenant
```

Opciones:

```text
--scope=global
--scope=user
--scope=tenant
--crud
--events
--audit
```

El generador debe producir contratos, casos de uso, repositorio, rutas y pruebas mínimas.

---

# 19. Configuración y secretos

Usa un paquete de configuración con validación en arranque.

Separar:

- variables públicas;
- variables privadas;
- variables de build;
- variables runtime.

Proveer:

```text
.env.example
.env.test.example
```

No incluir secretos reales.

Variables por feature:

```text
APP_ENV
APP_VERSION
API_BASE_URL
LOG_LEVEL
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
TRUSTED_ORIGINS
OTEL_EXPORTER_OTLP_ENDPOINT
S3_ENDPOINT
S3_BUCKET
SMTP_URL
WEBHOOK_SIGNING_SECRET
```

El proyecto debe fallar rápido con mensajes claros si falta una variable requerida por un módulo habilitado.

---

# 20. Seguridad

## 20.1 Threat model

Crear `docs/threat-model.md`.

Debe cubrir:

- robo de sesión;
- CSRF;
- XSS reflejado a través de errores;
- IDOR;
- filtración entre tenants;
- escalamiento de privilegios;
- invitaciones robadas;
- transferencia de propiedad;
- API keys filtradas;
- replay de webhooks;
- carga de archivos;
- abuso de endpoints públicos;
- exportación masiva;
- acciones de soporte;
- prompt injection en herramientas de IA.

## 20.2 Controles obligatorios

- deny by default;
- validación de entrada;
- límites de payload;
- rate limiting donde aplique;
- request ID;
- secreto fuerte;
- rotación;
- cookies seguras;
- CORS allowlist;
- CSRF cuando aplique;
- redacción de logs;
- consultas parametrizadas;
- permisos backend;
- tenant scope;
- auditoría;
- headers seguros;
- dependencias fijadas;
- escaneo de vulnerabilidades;
- SBOM opcional;
- backups probados.

## 20.3 Soporte administrativo

Las funciones de impersonación, soporte o administración global deben:

- estar deshabilitadas por defecto;
- requerir permiso especial;
- registrar auditoría;
- mostrar banner;
- expirar;
- impedir acciones altamente sensibles cuando sea posible.

## 20.4 Datos personales

No asumir que toda información puede registrarse.

Agregar mecanismos para:

- clasificación;
- retención;
- exportación;
- eliminación;
- redacción;
- minimización;
- consentimiento cuando aplique.

---

# 21. Pruebas

## 21.1 Pirámide

### Unitarias

- entidades;
- casos de uso;
- políticas;
- validadores;
- mappers.

### Integración

- repositorios;
- migraciones;
- transacciones;
- outbox;
- webhooks;
- Better Auth;
- PostgreSQL.

### HTTP

Usar `app.request()` y el cliente de pruebas de Hono.

### Contrato

- OpenAPI válido;
- rutas documentadas;
- SDK compilable;
- errores declarados;
- cambios detectados.

### E2E

- registro/login;
- recuperación;
- flujo de organización;
- invitación;
- roles;
- aislamiento;
- webhooks;
- archivos.

## 21.2 Suite multi-tenant obligatoria

Para cada recurso tenant:

```text
usuario A / organización A:
- puede leer A según permiso;
- no puede leer B;
- no puede editar B;
- no puede eliminar B;
- no puede inferir existencia de B;
- no puede cambiar organizationId en body;
- no puede omitir tenant scope;
- no puede escalar rol;
```

## 21.3 Suite de privilegios

- usuario no puede cambiar su propio rol;
- admin no puede convertirse en owner sin transferencia;
- último owner no puede abandonar;
- invitación expirada falla;
- token reutilizado falla;
- miembro suspendido pierde acceso;
- sesión revocada falla;
- API key revocada falla;
- permiso eliminado se refleja inmediatamente.

## 21.4 Base real

No uses únicamente mocks para repositorios críticos.

La CI debe levantar PostgreSQL y ejecutar migraciones reales.

## 21.5 Cobertura

No uses cobertura global como sustituto de pruebas.

Establece umbrales altos para:

- tenancy;
- authorization;
- auth adapters;
- ownership transfer;
- audit;
- webhooks.

---

# 22. Observabilidad

## 22.1 Logging

Logging JSON estructurado con:

- timestamp;
- level;
- service;
- environment;
- version;
- request ID;
- route;
- status;
- duration;
- tenant ID redactable;
- user ID seudonimizado cuando corresponda.

No registrar cuerpos completos por defecto.

## 22.2 Métricas

- throughput;
- latencia;
- errores;
- conexiones DB;
- jobs;
- reintentos;
- dead letters;
- webhooks;
- login failures;
- rate limiting.

## 22.3 Tracing

Módulo opcional con OpenTelemetry.

Instrumentar:

- HTTP;
- PostgreSQL;
- jobs;
- webhooks;
- llamadas externas.

No atar el código de dominio a un proveedor de observabilidad.

---

# 23. Docker y despliegue

## 23.1 Dockerfile

Crear multi-stage build usando imagen oficial de Bun.

Requisitos:

- usuario no root;
- dependencias reproducibles;
- `bun.lock` copiado correctamente;
- health check funcional;
- imagen mínima;
- secrets fuera de la imagen;
- señal de apagado;
- cierre limpio de DB y worker.

## 23.2 Docker Compose

Perfiles:

```text
core
database
worker
redis
storage
observability
```

No declarar dependencias de servicios inexistentes.

## 23.3 Despliegue inicial

Soportar primero:

```text
Bun + Hono + Docker + PostgreSQL
```

No optimizar para edge como requisito inicial.

## 23.4 Migraciones

La migración debe ejecutarse como job separado o paso controlado, no de forma insegura en todas las réplicas al iniciar.

## 23.5 Shutdown

Implementar graceful shutdown:

- dejar de aceptar requests;
- completar requests activas;
- cerrar DB;
- detener worker;
- liberar recursos;
- respetar timeout.

---

# 24. Integración continua

GitHub Actions:

```text
lint
typecheck
architecture
unit-test
integration-test
migration-test
openapi-validation
sdk-build
docker-build
security-scan
```

En pull requests:

- detectar cambios de contrato;
- adjuntar diff OpenAPI;
- impedir migraciones no commiteadas;
- validar perfiles;
- generar al menos un proyecto de cada perfil;
- instalar dependencias desde cero;
- probar Docker.

Matriz mínima:

```text
minimal
authenticated
multi-tenant
integration
```

---

# 25. Preparación AI-friendly

Crear un `AGENTS.md` completo.

Debe explicar:

- propósito;
- arquitectura;
- reglas de dependencia;
- perfiles;
- comandos;
- decisiones;
- módulos;
- contratos;
- cómo crear features;
- cómo agregar tablas;
- cómo agregar permisos;
- cómo probar aislamiento;
- archivos generados que no deben editarse;
- fuentes de verdad;
- anti-patrones.

Agregar:

```text
docs/ai/project-map.yaml
docs/ai/invariants.yaml
docs/ai/canonical-examples.md
docs/ai/change-checklists.md
```

## Invariantes mínimas

```text
- ningún recurso tenant se consulta sin tenant scope;
- ningún permiso se confía al frontend;
- ningún handler contiene lógica de negocio;
- ninguna migración desplegada se modifica;
- ninguna ruta se publica sin OpenAPI;
- ningún evento externo se envía antes del commit;
- ningún secreto aparece en logs;
- ningún módulo opcional entra en perfiles que no lo habilitan.
```

## Ejemplos canónicos

Crear ejemplos correctos de:

- endpoint público;
- endpoint autenticado;
- endpoint tenant-scoped;
- caso de uso;
- repositorio;
- política ABAC;
- evento/outbox;
- prueba de aislamiento;
- migración;
- SDK.

La IA debe imitar ejemplos canónicos, no inventar nuevas estructuras.

---

# 26. Reimplementación limpia

No copiar código, documentación, migraciones, pruebas, prompts ni nombres distintivos desde repositorios sin licencia compatible.

Los repositorios observados pueden servir para identificar capacidades generales como:

- organizaciones;
- membresías;
- invitaciones;
- roles;
- outbox;
- auditoría;
- webhooks;
- SDK;
- módulos.

La implementación debe surgir de esta especificación y de documentación oficial.

Conservar:

- ADRs;
- commits;
- plan;
- decisiones;
- pruebas;

como evidencia de desarrollo independiente.

---

# 27. ADR obligatorios

Crear al menos:

```text
ADR-001 Hono como framework HTTP
ADR-002 Bun como runtime inicial sin acoplar dominio
ADR-003 PostgreSQL y Drizzle
ADR-004 OpenAPI como contrato público
ADR-005 Better Auth aislado detrás de un adapter
ADR-006 Monolito modular
ADR-007 Perfiles generables
ADR-008 Multi-tenancy opcional
ADR-009 RBAC + ABAC explícito
ADR-010 Outbox para integraciones
ADR-011 Estrategia de SDK
ADR-012 Estrategia web/mobile/desktop auth
```

Cada ADR debe registrar:

- contexto;
- opciones;
- decisión;
- consecuencias;
- condiciones para revisarla.

---

# 28. Roadmap de implementación

## Fase 0 — Investigación y versiones

- revisar documentación oficial;
- seleccionar versiones exactas;
- registrar licencias;
- crear ADR;
- crear matriz de compatibilidad Bun/Node;
- fijar `packageManager`;
- no usar `"latest"`.

## Fase 1 — Foundation

- workspace;
- Hono;
- config;
- errores;
- logging;
- health;
- OpenAPI;
- docs;
- Docker;
- CI;
- pruebas base.

## Fase 2 — Persistencia

- PostgreSQL;
- Drizzle;
- migraciones;
- repositorio ejemplo;
- transacciones;
- seeds;
- pruebas reales.

## Fase 3 — Autenticación

- Better Auth;
- Drizzle adapter;
- sesiones;
- trusted origins;
- web auth;
- pruebas;
- documentación.

## Fase 4 — Autorización single-tenant

- roles globales opcionales;
- permission catalog;
- policy functions;
- auditoría;
- pruebas.

## Fase 5 — Multi-tenancy

- organizaciones;
- membresías;
- invitaciones;
- tenant context;
- roles por org;
- ownership transfer;
- tenant repositories;
- pruebas de aislamiento.

## Fase 6 — Integraciones

- outbox;
- worker;
- webhooks;
- API keys;
- idempotencia;
- reintentos.

## Fase 7 — Archivos y notificaciones

- storage adapter;
- signed URLs;
- mailer;
- templates;
- pruebas.

## Fase 8 — Generador

- perfiles;
- features;
- create project;
- add feature;
- create module;
- validaciones.

## Fase 9 — Frontend integration kits

- TanStack;
- Next.js;
- Ignite;
- Tauri;
- n8n;
- ejemplo Python.

## Fase 10 — Hardening

- threat model;
- observabilidad;
- load test;
- Docker;
- backup/restore;
- security review;
- documentación final.

No desarrollar todas las fases en un único cambio gigantesco. Mantener cada fase ejecutable y validada.

---

# 29. Criterios de aceptación

La solución se considera terminada cuando:

## Base

- [ ] Un proyecto `minimal` se genera y ejecuta.
- [ ] No instala DB ni auth.
- [ ] OpenAPI y Scalar funcionan.
- [ ] Docker build funciona.
- [ ] CI pasa.

## Persistencia

- [ ] `data-api` levanta PostgreSQL.
- [ ] Migraciones funcionan desde cero.
- [ ] Repositorio ejemplo tiene pruebas reales.
- [ ] No se usa `push` en producción.

## Auth

- [ ] Registro/login/sesión/revocación funcionan.
- [ ] Better Auth está encapsulado.
- [ ] Secrets y cookies están configurados de forma segura.
- [ ] Existe una estrategia documentada para web, móvil y escritorio.

## Single-tenant

- [ ] No incluye tablas de organizaciones.
- [ ] Roles globales son opcionales.
- [ ] Auditoría puede activarse.

## Multi-tenant

- [ ] Organización, membresía e invitación funcionan.
- [ ] Último owner no puede abandonar.
- [ ] Transferencia de ownership es transaccional.
- [ ] Todos los recursos tenant requieren tenant scope.
- [ ] Suite A/B de aislamiento pasa.
- [ ] Frontend no es autoridad de permisos.
- [ ] Auditoría registra cambios críticos.

## Integraciones

- [ ] API keys se almacenan de forma segura.
- [ ] Webhooks están firmados.
- [ ] Reintentos e idempotencia funcionan.
- [ ] Outbox evita eventos antes del commit.
- [ ] Worker se puede ejecutar separado.

## Generador

- [ ] Genera todos los perfiles.
- [ ] No arrastra dependencias innecesarias.
- [ ] Impide combinaciones inválidas.
- [ ] Genera documentación y AGENTS.md.
- [ ] Cada proyecto generado pasa lint, types, tests y Docker build.

## Contrato

- [ ] Todas las rutas aparecen en OpenAPI.
- [ ] Todas las respuestas documentadas.
- [ ] SDK compila en un repositorio separado.
- [ ] TanStack y Next pueden consumirlo.
- [ ] Existe ejemplo Ignite/Tauri.
- [ ] n8n puede consumir REST sin Hono RPC.

## Calidad

- [ ] No existen dependencias `"latest"`.
- [ ] Arquitectura validada automáticamente.
- [ ] No hay lógica de negocio en handlers.
- [ ] No hay consultas tenant sin scope.
- [ ] No hay secretos en logs.
- [ ] README y runbooks están completos.
- [ ] CHANGELOG inicial y versión `0.1.0`.

---

# 30. Anti-patrones prohibidos

No hacer:

- una arquitectura de microservicios;
- multi-tenancy obligatorio;
- `organizationId` opcional en repositorios tenant;
- autorización solamente en frontend;
- roles codificados dentro de componentes;
- un `service.ts` gigantesco por módulo;
- consultas SQL dentro de handlers;
- tokens en `localStorage`;
- API keys en texto plano;
- migraciones automáticas concurrentes por réplica;
- eventos externos antes del commit;
- OpenAPI manual desincronizado;
- dependencias `"latest"`;
- Redis sin necesidad;
- Docker Compose con servicios incompletos;
- mezclar código demo con capacidades productivas;
- copiar código de repositorios sin licencia;
- adoptar Bun APIs en dominio sin una razón documentada;
- crear abstracciones genéricas que no tengan dos usos reales;
- declarar “production-ready” sin threat model, pruebas y runbooks.

---

# 31. Entregables finales

OpenCode debe entregar:

```text
consulting-hono-api-starter/
├── código completo;
├── generador;
├── perfiles;
├── paquetes de features;
├── pruebas;
├── migraciones;
├── OpenAPI;
├── SDK;
├── Docker;
├── CI;
├── AGENTS.md;
├── ADRs;
├── documentación;
├── ejemplos de integración;
├── threat model;
├── runbooks;
└── reporte final de validación.
```

Además, generar:

```text
VALIDATION_REPORT.md
```

Debe indicar:

- comandos ejecutados;
- resultados;
- perfiles generados;
- pruebas;
- cobertura crítica;
- Docker;
- limitaciones;
- riesgos pendientes;
- decisiones no implementadas;
- recomendaciones para `0.2.0`.

---

# 32. Fuentes oficiales que deben consultarse durante la implementación

Verificar nuevamente las versiones y recomendaciones antes de escribir código:

- Hono: https://hono.dev/docs
- Hono RPC: https://hono.dev/docs/guides/rpc
- Hono testing: https://hono.dev/docs/guides/testing
- Hono OpenAPI: https://hono.dev/examples/hono-openapi
- Hono + Better Auth: https://hono.dev/examples/better-auth
- Bun: https://bun.sh/docs
- Bun workspaces: https://bun.sh/guides/install/workspaces
- Bun Docker: https://bun.sh/guides/ecosystem/docker
- Drizzle ORM: https://orm.drizzle.team/docs
- Drizzle PostgreSQL: https://orm.drizzle.team/docs/get-started/postgresql-new
- Drizzle migrations: https://orm.drizzle.team/docs/migrations
- Better Auth: https://better-auth.com/docs/introduction
- Better Auth Hono: https://better-auth.com/docs/integrations/hono
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Better Auth organization plugin: https://better-auth.com/docs/plugins/organization
- Better Auth API keys: https://better-auth.com/docs/plugins/api-key
- Better Auth OAuth provider: https://better-auth.com/docs/plugins/oauth-provider
- OpenTelemetry JavaScript: https://opentelemetry.io/docs/languages/js/

No asumir que un ejemplo oficial cubre por sí mismo seguridad, multi-tenancy o producción. Usar la documentación como referencia técnica y validar cada integración.

---

# 33. Orden de inicio para OpenCode

Comienza así:

1. Convierte este documento en especificación y lista de tareas del harness.
2. Revisa las fuentes oficiales y fija versiones exactas.
3. Crea los ADR iniciales.
4. Implementa solamente `minimal`.
5. Genera un proyecto desde el starter y valida que funcione.
6. Agrega `data-api`.
7. Agrega `authenticated`.
8. Agrega `multi-tenant`.
9. Agrega integraciones opcionales.
10. Construye el generador después de que al menos dos perfiles funcionen manualmente.
11. Extrae templates desde implementaciones validadas; no generes templates teóricos sin ejecutar.
12. Finaliza con todos los criterios de aceptación y `VALIDATION_REPORT.md`.

La prioridad es:

```text
Correctitud
→ seguridad
→ aislamiento
→ contratos
→ pruebas
→ mantenibilidad
→ experiencia de desarrollo
→ rendimiento
```

No sacrifiques las primeras seis por ahorrar líneas de código o por perseguir benchmarks.
