# Kit Ignite/React Native

El kit móvil de `@consulting/sdk` permite consumir la API REST desde Ignite o
React Native sin asumir cookies de navegador ni instalar dependencias nativas en
el SDK. La aplicación inyecta el almacenamiento seguro, el refresh y el `fetch`
que correspondan a su plataforma.

## Camino rápido

1. Implementa `SecureTokenStore` con Keychain, Keystore o SecureStore.
2. Crea `createMobileSession` y `createMobileApiClient` con bearer tokens.
3. Ejecuta el runner offline cuando la aplicación vuelva a tener conectividad o
   pase a foreground.

```ts
import {
  createMobileApiClient,
  createMobileSession,
  type SecureTokenStore,
} from "@consulting/sdk";

const store: SecureTokenStore = {
  async get() {
    return nativeSecureStore.readTokens();
  },
  async set(tokens) {
    await nativeSecureStore.writeTokens(tokens);
  },
  async clear() {
    await nativeSecureStore.deleteTokens();
  },
};

const session = createMobileSession({
  store,
  refresh: (refreshToken) => authApi.refresh(refreshToken),
});

const client = createMobileApiClient({
  baseUrl: API_BASE_URL,
  store,
  refresh: (refreshToken) => authApi.refresh(refreshToken),
  getOrganizationId: () => selectedOrganizationId,
});
```

## Seguridad de sesión

`SecureTokenStore` debe usar Keychain, Keystore o SecureStore. No uses
`AsyncStorage`, `localStorage`, archivos de texto ni logs para access o refresh
tokens. El cliente envía `Authorization: Bearer ...` y fija
`credentials: "omit"`; el SDK no espera una cookie de sesión.

`session.refresh()` es explícito y single-flight: llamadas concurrentes comparten
la misma promesa. Si el refresh falla, el store se limpia. El SDK no reintenta
automáticamente solicitudes no idempotentes. La capa de red puede refrescar y
repetir una operación de forma segura cuando la operación lleve una clave de
idempotencia.

## Mutaciones offline

Persiste `OfflineMutation` en la base local elegida por la aplicación. La clave
`idempotencyKey` deduplica la cola y debe viajar como `Idempotency-Key`:

```ts
import {
  createOfflineMutationRunner,
  withIdempotencyKey,
} from "@consulting/sdk";

const runner = createOfflineMutationRunner({
  store: mutationStore,
  maxAttempts: 3,
  send: async (mutation, headers) => {
    await fetch(`${API_BASE_URL}${mutation.path}`, {
      method: mutation.method,
      headers: withIdempotencyKey(headers, mutation.idempotencyKey),
      body: JSON.stringify(mutation.payload),
    });
  },
});

const result = await runner.run();
if (result.shouldRetry || result.exhausted > 0) {
  showOfflineStatus(result);
}
```

El runner procesa una sola vez, no crea timers y nunca registra el payload. Las
mutaciones agotadas quedan fuera de la ventana de vencimiento para que la
aplicación pueda inspeccionarlas o ofrecer una acción de recuperación.

## Archivos y paginación

No hay supuestos sobre rutas locales o sistemas de archivos. Usa `Blob` o `File`
compatible con la plataforma y `createMobileUploadForm`:

```ts
const form = createMobileUploadForm(photoBlob, {
  source: "camera",
  album: "receipts",
});
await client.files.upload(form, { organizationId: selectedOrganizationId });
```

Para listados, pasa `limit` a `client.files.list({ limit })` y conserva el
estado de paginación en la aplicación. Las URLs de descarga son referencias
emitidas por la API; el kit no convierte blobs ni lee archivos del dispositivo.

## Checklist

- [ ] Los secretos viven solo en Keychain, Keystore o SecureStore.
- [ ] Las solicitudes usan bearer y no cookies.
- [ ] Las mutaciones repetibles llevan `createIdempotencyKey()`.
- [ ] El refresh y los reintentos se coordinan fuera del cliente automático.
- [ ] La cola se ejecuta por eventos de conectividad, sin timers del SDK.
