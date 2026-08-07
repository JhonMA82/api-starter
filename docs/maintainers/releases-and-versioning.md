# Releases y versionado

**Audiencia:** mantenedores del starter.
**Objetivo:** publicar una versión nueva del starter con compatibilidad verificada para proyectos generados.

## Fuente canónica de versión

- `package.json` (raíz) es la **única** fuente de la versión del starter.
- `generator/src/starter-version.ts` deriva `STARTER_VERSION` de ahí; `generator/tests/version-sync.test.ts` falla si divergen.
- El actualizador rechaza `--to` distinto de la canónica antes de materializar.

## Actualización de workspaces

Al bumpear versión, alinea **todos** los manifests del workspace (17 `package.json`), `packages/config/src/env.ts` (`APP_VERSION` default), `.env.example`, `.env.test.example` y el default `IMAGE_VERSION` del Dockerfile. Busca restos:

```bash
rg "0\.10\.1|0\.11\.0" . --glob '!bun.lock' --glob '!node_modules/**' --glob '!docs/archive/**'
```

## Changelog

`CHANGELOG.md` sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y SemVer. Cada entrada describe el cambio para humanos; las rutas de documentación que se muevan deben reflejarse en la entrada correspondiente.

## Registry de updates

Las migraciones versionadas del starter viven en `generator/updates/registry.ts` (`UPDATES`, `resolveUpdatePath`) y `generator/updates/<from>-to-<to>.ts`. Cada `Update` declara `from`/`to`, `plan`, `breakingNotes`, `requiresManual` y `postValidations`. Reglas:

- Rutas SemVer secuenciales sin saltos; downgrades rechazados.
- Cada `Update.id` se registra una vez en `manifest.appliedUpdates` solo tras éxito.
- `db:migrate` nunca se ejecuta automáticamente; las migraciones de datos nuevas se bloquean como `manual-migration`.

## Compatibilidad con proyectos generados

- Un proyecto generado con la versión N puede actualizar a N+1 solo si la ruta `N → N+1` existe y es aplicable (mira `resolveUpdatePath`).
- Los cambios de esquema del manifiesto (`.api-starter/manifest.json`) requieren `readManifestOrLegacy` compatible o un paso de migración explícito.
- La poda física exige que cualquier feature nueva sea opcional: los proyectos existentes no pueden romperse por una feature que no seleccionaron.

## Checklist de release

- [ ] Versión bumpeada en todos los manifests y config (ver arriba); `rg` sin restos de la anterior en documentación activa.
- [ ] `bun run generator:sync && bun run generator:validate` limpios.
- [ ] `CHANGELOG.md` actualizado.
- [ ] Registry: `generator/updates/registry.ts` con la ruta desde la última versión; update de ejemplo probado con `--apply` en una fixture.
- [ ] Todos los jobs de CI verdes (ver [testing-and-ci.md](testing-and-ci.md)); evidencia registrada.
- [ ] `bun run docs:check` limpio.
- [ ] Un proyecto generado (perfil representativo) pasa `bun install`, `bun test`, `lint`, `typecheck` y `generator:doctor`.
- [ ] Imagen Docker construida y fumada (`docker build .`, health 200).
