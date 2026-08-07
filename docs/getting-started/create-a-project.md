# Crear un proyecto

**Audiencia:** persona que crea una API nueva con el starter.
**Objetivo:** recorrido completo desde el clon hasta el primer commit del proyecto generado.

## 1. Requisitos

- [Bun](https://bun.sh) `1.3.14` (`.bun-version` la fija; también puedes usar `bun x bun@1.3.14` si tienes otra versión).
- Podman o Docker: solo si el perfil incluye `persistence` y quieres base de datos local.

## 2. Obtener el starter

```bash
git clone https://github.com/JhonMA82/api-starter.git
cd api-starter
bun install --frozen-lockfile
```

## 3. Descubrir perfiles y features

```bash
bun run create:project -- --list-profiles
bun run create:project -- --list-features
```

Si no sabes qué elegir, [choose-a-profile.md](choose-a-profile.md) explica cada perfil con su caso de uso y sus límites.

## 4. Comprobar la selección (dry-run)

`create:project` muestra el plan final (módulos, paquetes y migraciones que se mantienen o se eliminan) antes de escribir. Genera directamente a un directorio nuevo; el generador falla de forma segura si el destino no está vacío salvo `--force`.

## 5. Generar

```bash
bun run create:project -- --profile=minimal --out=../my-api
```

Variantes:

```bash
bun run create:project -- --profile=multi-tenant-core --with=files,notifications --out=../my-saas
bun run create:project -- --features=persistence,auth,authorization --out=../custom-api
bun run create:project -- --profile=data-api --out=../my-data-api
```

El resultado es un repositorio independiente con poda física: solo existen los módulos, paquetes, migraciones y tests de las features seleccionadas. Incluye `GENERATED.md` (resumen) y `.api-starter/manifest.json` (registro de los archivos administrados, necesario para actualizaciones futuras).

## 6. Entrar al proyecto generado e instalar

```bash
cd ../my-api
bun install
```

## 7. Configurar el entorno

```bash
cp .env.example .env
```

Las variables obligatorias dependen del perfil; `.env.example` del proyecto generado solo lista lo que ese perfil necesita (detalle en [reference/environment.md](../reference/environment.md)).

## 8. Levantar la base de datos (solo perfiles con `persistence`)

```bash
bun run db:up        # levanta postgres 17 (contenedor api-pg)
bun run db:migrate   # aplica las migraciones pendientes (idempotente)
bun run db:seed      # datos semilla (idempotente)
```

## 9. Ejecutar

```bash
bun run dev
```

## 10. Health check

```bash
curl http://localhost:3000/health   # {"status":"ok"}
curl http://localhost:3000/version
```

La documentación interactiva (Scalar) queda en `http://localhost:3000/docs` y el contrato OpenAPI en `/openapi.json`.

## 11. Tests iniciales

```bash
bun test          # suite del proyecto generado (los tests de DB se saltan sin DATABASE_URL)
bun run lint      # biome ci .
bun run typecheck # bun x tsc --noEmit
```

## 12. Primer commit recomendado

```bash
git init
git add .
git commit -m "chore: scaffold API from api-starter <perfil>"
```

Todo lo que viene con el proyecto generado está pensado para commitearse tal cual. A partir de aquí, [primer módulo](first-module.md) muestra cómo añadir dominio propio.

## Siguiente paso

- [Primer módulo](first-module.md) — estructura por capas y `create:module`.
- [Elegir otro perfil](choose-a-profile.md) — si la selección no fue la correcta, regenera y porta los cambios de dominio.
