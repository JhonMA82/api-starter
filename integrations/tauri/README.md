# Kit Tauri 2

El kit Tauri de `@consulting/sdk` conecta un cliente bearer con comandos nativos
inyectados. El SDK no importa paquetes de Tauri: la aplicación entrega `invoke`,
un keyring o secure-store nativo y el adaptador de comandos correspondiente.

## Camino rápido

1. Expón comandos Rust/plugin que lean, escriban y limpien tokens en un keyring.
2. Adapta `invoke` con `createTauriCredentialBridge`.
3. Crea el cliente y usa autenticación del navegador del sistema para el login.

```ts
import {
  createTauriApiClient,
  createTauriCredentialBridge,
  createTauriSystemAuth,
} from "@consulting/sdk";
import { invoke } from "@tauri-apps/api/core";

const bridge = createTauriCredentialBridge(invoke, {
  read: "auth_read_tokens",
  write: "auth_write_tokens",
  clear: "auth_clear_tokens",
});

const client = createTauriApiClient({
  baseUrl: API_BASE_URL,
  bridge,
  getOrganizationId: () => selectedOrganizationId,
});

const systemAuth = createTauriSystemAuth({
  openExternal: (url) => openSystemBrowser(url),
  callbackScheme: "consulting",
  onCallback: (url) => exchangeSystemCallback(url),
});
```

Los nombres predeterminados son `auth_read_tokens`, `auth_write_tokens` y
`auth_clear_tokens`. Decláralos explícitamente en los comandos nativos o pasa
un mapa de nombres si tu aplicación usa otra convención. El comando de escritura
recibe `{ tokens }`; lectura y limpieza no necesitan argumentos.

## Keyring y cliente bearer

Los comandos nativos deben persistir en el keyring del sistema o en un plugin de
secure store. No guardes tokens en archivos de texto, `localStorage`, preferencias
sin cifrar o logs. `createTauriApiClient` reutiliza el kit móvil, envía
`Authorization: Bearer ...` y fija `credentials: "omit"`.

El bridge es una frontera de aplicación: valida permisos del comando, limita el
alcance de la ventana y no expone el valor de las credenciales a la UI más allá
de lo necesario para el getter del SDK.

## Login con navegador del sistema

`createTauriSystemAuth` abre la URL en el navegador predeterminado y valida el
esquema del deep link antes de llamar a `onCallback`:

```ts
await systemAuth.startLogin("https://auth.example.test/authorize?...");

// Invocado por el listener nativo de deep links.
const tokens = await systemAuth.handleCallback("consulting://callback?code=...");
await bridge.write(tokens);
```

El kit no persiste esos tokens. La sesión o bridge de la aplicación decide cómo
guardarlos después del intercambio. Un callback `https:` u otro esquema se
rechaza; no uses credenciales embebidas en una vista web.

## Checklist

- [ ] `invoke` es inyectado y los comandos usan keyring o secure store.
- [ ] No existen secretos en archivos planos ni `localStorage`.
- [ ] El login ocurre en el navegador del sistema.
- [ ] Se valida el esquema del callback antes del intercambio.
- [ ] La sesión guarda los tokens solo después de recibirlos del callback.
