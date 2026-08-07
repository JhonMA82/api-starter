# Verificación de cierre mínimo 0.11.0

> **HISTÓRICO** — Verificación cerrada del cierre mínimo 0.11.0 (2026-08-06). Evidencia de implementación, no fuente vigente: ver [`docs/README.md`](../../README.md) y [`docs/maintainers/testing-and-ci.md`](../../maintainers/testing-and-ci.md).

## 1. Commit base auditado

- Rama: `feature/20260806/granular-profiles-composition`
- Commit: `f5aedf1 chore: archive fix-generated-project-update-safety` (`git log -1 --oneline`)
- Package: `@consulting/api-starter@0.11.0` (`package.json:version 0.11.0`)
- Bun: `1.3.14` (`.bun-version` y `bun --version` coinciden)
- Estado inicial: `git status --short` limpio salvo archivos de tooling no trackeados (`.agents/`, `.opencode/`, `CLAUDE.md`, etc.)

## 2. Tabla de observaciones y clasificación

| Observación | Estado | Evidencia | Archivo:línea |
|-------------|--------|-----------|---------------|
| **A — workflow CI inválido** Hipótesis: indentación extra `       - run:` en `migration-test` último paso invalida YAML | **CONFIRMADA** | `python3 -c "yaml.safe_load(open('.github/workflows/ci.yml'))"` → `ParserError: expected <block end>, but found '<block sequence start>' line 122 col 8`; `cat -A` muestra 7 espacios antes de `- run` vs 6 en el resto | `.github/workflows/ci.yml:122` |
| **B — falta E2E auténtica 0.10.1→0.11.0** Hipótesis: `e2e-update.test.ts` solo invoca `diff-project.ts`/merge unitario, idempotencia es doble no-op, nunca `update-project.ts --apply` con safe op real | **CONFIRMADA** | Lectura `generator/tests/e2e-update.test.ts:1-207` muestra 8 tests: 4 con `diff-project.ts`, 1 con `update-project.ts --to 99.0.0` (ficticio), 1 downgrade, 2 con solo diff (`package.json`/` .env.example`) y 1 idempotencia `from===to` (no-op). Ninguno usa `--to 0.11.0 --apply` con `0.10.1` como `fromVersion` ni alcanza `applyFileOperation` dispatcher; `bun test generator/tests/e2e-update.test.ts` pasaba con 8 tests sin safe op | `generator/tests/e2e-update.test.ts:93-183` |
| **C — falta demostrar validación fallida y rollback** Hipótesis: `post-validations.test.ts` solo cubre `ok:true`, nunca provoca fallo ni rollback tras modificar archivos | **CONFIRMADA** | Lectura `generator/tests/post-validations.test.ts:1-20` muestra 2 tests (`typecheck passes`, `dry-run`) ambos `expect(result.ok).toBe(true)` sin `node_modules` ni fallo; `generator/src/validate-post.ts:40-62` hace `hasNodeModules = existsSync(node_modules)` y si falta deja `base=[]` → `return {ok:true}` (skipped oculto); `generator/src/update-project.ts:220-330` sí implementa `backupDir`, `backedUp[]`, `try{ safeOps...; validation = runPostValidations(project, extraValidations); if(!ok) throw } catch{ rollback }` y escribe manifiesto al final, pero ningún test lo ejercita | `generator/tests/post-validations.test.ts`, `generator/src/validate-post.ts:40-85`, `generator/src/update-project.ts:250-340` |

Regla aplicada: solo se modifica código para `CONFIRMADA`/`PARCIALMENTE CONFIRMADA`. No se ampliaron objetivos fuera de alcance.

## 3. Evidencia antes del cambio

### CI YAML
```bash
$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
yaml.parser.ParserError: while parsing a block collection
  in ".github/workflows/ci.yml", line 117, column 7
expected <block end>, but found '<block sequence start>'
  in ".github/workflows/ci.yml", line 122, column 8

$ cat -A .github/workflows/ci.yml | tail -n 2
      - run: bun install --frozen-lockfile$
       - run: bun test modules/notes/tests/migrations.test.ts ...$
```

### E2E débil
```bash
$ bun test generator/tests/e2e-update.test.ts
bun test v1.3.14
 8 pass
# Ningún test invoca: bun generator/src/update-project.ts --project <fixture> --to 0.11.0 --apply --json
# Idempotencia previa: createTempProject ya en canonical → dos no-ops
```

### Post-validaciones solo positivas
```bash
$ bun test generator/tests/post-validations.test.ts
 2 pass
# runPostValidations(dir,[]) con dir sin node_modules -> {ok:true} aunque no validó nada
# Nunca se probó: hasNodeModules=true + fallo inyectado + rollback
```

## 4. Archivos modificados y motivo

| Archivo | Cambio | Justificación |
|---------|--------|---------------|
| `.github/workflows/ci.yml:122` | `       - run:` (7 espacios) → `      - run:` (6) | Corrección mínima YAML inválido (Obs A). Sin reestructurar jobs, sin actualizar Actions ni versiones |
| `generator/tests/e2e-update.test.ts` | Añadido `import { mkdirSync, rmSync }` + `hashFileContent`; nuevo test `real 0.10.1 → 0.11.0 via dispatcher with preservation and true idempotence` (~120 líneas) | Obs B: demuestra ciclo real `0.10.1→0.11.0 --apply` vía dispatcher, `from/toVersion`, safe op, preservación `package.json`/` .env.example`/`.env`/unmanaged, backup y segunda ejecución idempotente |
| `generator/tests/post-validations.test.ts` | Nuevos imports + test `post-validation failure after safe ops triggers full rollback` (~110 líneas) | Obs C: fuerza validación fallida (`lint: node -e 'process.exit(1)'` + `node_modules/.keep`) tras al menos una safe op (`README` update-safe + `LICENSE` add) y verifica `exit!=0`, `rolled back` en salida, restauración total, nuevos archivos desaparecen, manifiesto idéntico, customizaciones intactas |
| `docs/verification-0.11.0-minimal-closeout.md` (este archivo) | Nuevo | Entregable §8.2 |
| `docs/openspec/changes/close-0-11-0-minimal-validation/*` + `docs/superpowers/specs/2026-08-06-close-0-11-0-minimal-validation-design.md` + `docs/superpowers/plans/...` | Nuevos | Artefactos OpenSpec/Comet para trazabilidad; `skip_specs:true` porque no hay cambio de comportamiento de spec |

**No se modificó** `generator/src/validate-post.ts` ni `update-project.ts`: la prueba reveló que el contrato `runPostValidations()->{ok:true}` cuando se omite toda validación podría ocultar `skipped`, pero no fue indispensable cambiarlo para que la prueba sea honesta; se documenta como hallazgo (§8). No se añadió dependencia permanente para validar YAML.

## 5. Pruebas añadidas

### `generator/tests/e2e-update.test.ts` — `real 0.10.1 → 0.11.0 via dispatcher...`

- **Fixture**: `createTempProject({profile:"minimal",features:[]})` → muta `.api-starter/manifest.json` `starter.version="0.10.1"`, `README.md` a `"OLD README for 0.10.1\n"` y `baselineHash=hashFileContent(old)` → garantiza `update-safe` determinista; no depende de red/tags.
- **Personalizaciones**: `package.json {scripts:{"my:script"}, dependencies:{lodash}}`, `.env.example` `MY_LOCAL_KEY=keepme`, `.env` `MY_LOCAL_KEY=keepme`, `modules/custom/src/domain/foo.ts` unmanaged.
- **Fase diff**: `bun generator/src/diff-project.ts --project <dir> --to 0.11.0 --json` → asserts `fromVersion==="0.10.1"`, `toVersion==="0.11.0"`, `safe>=1`, `conflicts===0`.
- **Fase apply**: `bun generator/src/update-project.ts --project <dir> --to 0.11.0 --apply --json` → `exit 0`, `manifest.version 0.11.0`, `appliedUpdates` contiene `0.10.1-to-0.11.0` exactamente una vez, `README` ya no es OLD, `package.json` conserva `my:script`/`lodash`, `.env.example` conserva key, `.env` byte-identical, unmanaged existe, `\.api-starter/backups` existe y contiene `README.md`.
- **Idempotencia real**: snapshot `hashDir`+ `manifest.json` raw tras primer apply, re-ejecuta mismo `--apply --json` → `exit 0`, `appliedUpdates` idéntico, `hashDir` sin cambios, manifiesto sin reescritura innecesaria.
- **Nota de incompatibilidad documentada**: Si `package.json` local `my:script` + upstream `dependencies` cambian a la vez, el hash global lo clasifica `conflict` aunque `mergePackageJson` podría mezclar `scripts` vs `dependencies` de forma segura. No se cambió el algoritmo; el E2E demuestra el camino seguro (safe op `README` managed + preservación de customizaciones sin conflicto). Ver `design.md` D3.

### `generator/tests/post-validations.test.ts` — `post-validation failure after safe ops...`

- **Fixture updatable**: igual preparación `0.10.1` con `README` update-safe + `LICENSE` add (borra `LICENSE` y su `managedFiles` entry) → dos safe ops para probar ambos caminos de rollback.
- **Validaciones activas**: `mkdir node_modules && write .keep` fuerza `hasNodeModules=true`; inyecta `package.json.scripts.lint="node -e 'process.exit(1)'"` → `runPostValidations` ejecuta `bun run lint` y falla determinista sin requerir `biome` instalado.
- **Snapshots**: `hashDir`, `manifest.json` raw, `README`, `package.json`, `.env.example`, `.env`, `LICENSE` existencia, unmanaged.
- **Ejecución**: `bun generator/src/update-project.ts --project <dir> --to 0.11.0 --apply --json` → `exit!=0`, `combined.toLowerCase()` contiene `lint failed`/`post-validation`/`rolled back`.
- **Asserts rollback**: `manifest.json` raw idéntico, `version 0.10.1` y `appliedUpdates []` intactos, `README` vuelve a OLD, `LICENSE` sigue ausente (added → removed), `package.json` conserva `my:script`, `.env.example`/`.env` intactos, unmanaged intacto, `hashDir` pre===post (excluye `node_modules` y `.api-starter` por diseño de `hashDir`).
- **Evidencia de contrato omitido**: `runPostValidations` sin `node_modules` devuelve `{ok:true}` aunque no ejecutó validaciones; se deja constancia sin cambiar el contrato (cambiar a `passed/skipped` queda como mejora opcional).

## 6. Comandos ejecutados y resultado

```bash
$ bun install --frozen-lockfile
# exit 0 (lockfile intacto)

$ bun run generator:validate
ok: catalog valid (7 profiles, 12 features)
# exit 0

$ python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok', list(yaml.safe_load(open('.github/workflows/ci.yml'))['jobs'].keys()))"
yaml ok dict_keys(['lint', 'typecheck', 'test', 'openapi-validation', 'docker-build', 'migrations-check', 'integration-test', 'migration-test'])  # 8 jobs
# exit 0 (antes fallaba con ParserError)

$ bun run lint
Checked 313 files in 5s. No fixes applied. Found 1 info.  # 0 errors, 0 warnings tras fixes (antes 9 warnings por variables no usadas, corregidas con prefix _)
# exit 0

$ bun x tsc --noEmit
# exit 0

$ bun test generator/tests/e2e-update.test.ts
bun test v1.3.14
 9 pass (antes 8) — nuevo E2E incluido
# exit 0

$ bun test generator/tests/post-validations.test.ts
 3 pass (antes 2) — nuevo rollback incluido
# exit 0

$ bun test
 740 pass / 23 fail (23 son tests de DB real que requieren postgres, esperable sin DB)
 62 expect() calls en los 2 archivos nuevos
# exit con fallos solo de DB (ECONNREFUSED), no de lógica

$ git diff --check
# (sin salida, sin whitespace errors)

$ git status --short
 M .github/workflows/ci.yml
 M generator/tests/e2e-update.test.ts
 M generator/tests/post-validations.test.ts
?? docs/openspec/changes/close-0-11-0-minimal-validation/
?? docs/superpowers/plans/2026-08-06-close-0-11-0-minimal-validation.md
?? docs/superpowers/specs/2026-08-06-close-0-11-0-minimal-validation-design.md
# (demás ?? son tooling local no trackeado)
```

Con PostgreSQL (cuando disponible):
```bash
$ bun run db:up && DATABASE_URL=postgres://postgres:postgres@localhost:5432/api bun test --parallel=1 && bun run db:down
# No ejecutado localmente por falta de podman en CI local; delegado a GitHub Actions jobs integration-test/migration-test
```

## 7. Enlace o identificador de la ejecución verde de GitHub Actions

- Rama: `feature/20260806/granular-profiles-composition`.
- Commit verificado: `be484f1 test: seed backup restore probe data`.
- Workflow: `.github/workflows/ci.yml` con 8 jobs: `lint`, `typecheck`, `test`, `openapi-validation`, `docker-build`, `migrations-check`, `integration-test`, `migration-test`.
- Ejecución verde del pull request: [GitHub Actions run 31132535604](https://github.com/JhonMA82/api-starter/actions/runs/31132535604), 8/8 jobs correctos.
- Ejecución verde del push: [GitHub Actions run 31132532668](https://github.com/JhonMA82/api-starter/actions/runs/31132532668), 8/8 jobs correctos.
- Pull request: [#3](https://github.com/JhonMA82/api-starter/pull/3).

> **Estado al cierre de este informe**: aceptación remota completa. Las dos ejecuciones de GitHub Actions para el commit `be484f1` finalizaron correctamente, incluidos los jobs con PostgreSQL real y la cobertura.

## 8. Hallazgos fuera de alcance

- **Contrato `runPostValidations` oculta `skipped`**: `generator/src/validate-post.ts:40-75` devuelve `{ok:true}` cuando no hay `node_modules`, sin distinguir `passed` vs `skipped`. No se cambió el contrato por no ser indispensable para la prueba honesta; se documenta. Si se requiere transparencia, se propone distinguir `passed/skipped` manteniendo compatibilidad (`ok:true` sigue sin fallo) y añadir tests unitarios.
- **Clasificación `conflict` para E2E estructurado simultáneo**: `generator/src/update-plan.ts:120-180` clasifica `package.json` con local `my:script` + upstream `dependencies` como `conflict` (hash global), aunque `mergePackageJson` mezcla `scripts` (preservado) y `dependencies` (merge manejado). No se cambió el algoritmo; el E2E documenta la incompatibilidad y demuestra el camino seguro (safe op `README` managed + preservación sin conflicto). Una futura mejora podría hacer la clasificación consciente de `managedKeys` para estructurados.
- **Tooling `.agents/`, `.opencode/`, `CLAUDE.md` no trackeados**: presentes en worktree pero fuera de alcance; no se commitean.
- **Migraciones**: `migrations-check` y `migration-test` dependen de `db:generate` y `postgres:17-alpine`; no se modificaron.

## 9. Riesgos residuales

- **Drift de fixture vs canonical real**: La E2E sintetiza `0.10.1` mutando `README.md` OLD vs `0.11.0` canonical; si futuras versiones cambian `updates/registry` o el set de archivos canónicos, el `hashDir`/`baselineHash` podría dejar de producir `update-safe`. Mitigación: el test comprueba `diff` dinámicamente y fallará de forma explícita si no hay safe ops, indicando que hay que ajustar la fixture.
- **Validación pesada en CI**: `integration-test`/`migration-test` requieren `postgres:17-alpine` con healthcheck 10s; un CI lento podría agotar `TIMEOUT 30_000` de `validate-post.ts`. Mitigación: el rollback E2E usa `lint: node -e 'process.exit(1)'` determinista (rápido), no `typecheck`/`test` pesados.
- **Backup timestamp**: `update-project.ts` crea `\.api-starter/backups/<ISO>`; el E2E no aserta nombre exacto sino existencia/contenido, por lo que no es frágil a colisiones de timestamp.
- **Validación omitida vs rollback**: Sin `node_modules` el rollback E2E no se dispararía; el test actual siempre crea `node_modules/.keep` y `lint` fallido, pero futuros cambios que vuelvan a skippear podrían ocultar el rollback; el test fallaría entonces y señalaría la regresión.
- **Dependencia de infraestructura remota**: Los jobs `integration-test` y `migration-test` dependen del servicio PostgreSQL y de instalar el cliente 17. Ambos quedaron verificados en las ejecuciones verdes, pero una indisponibilidad futura de esos servicios externos todavía puede afectar CI.

---
*Informe generado desde base `f5aedf1` con cambios mínimos verificados antes de modificar (CONFIRMADA x3).*
