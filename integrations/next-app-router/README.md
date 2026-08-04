# Next App Router integration

The Next adapter keeps the REST API as the only backend boundary. It does not
create duplicate Next API routes, and it never stores access tokens in
`localStorage`.

## Server components

Forward the incoming cookie header explicitly. Server clients default to
`cache: "no-store"`, which is the safe policy for sessions and tenant data.

```tsx
import { cookies } from "next/headers";
import { createNextServerClient } from "@consulting/sdk";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const client = createNextServerClient({
    baseUrl: process.env.API_BASE_URL as string,
    cookieHeader,
    organizationId: "organization-id-from-your-server-context",
  });
  const session = await client.auth.getSession();

  return <pre>{JSON.stringify(session, null, 2)}</pre>;
}
```

For intentionally public or cacheable data, opt in with an integer
`revalidate` value and optional tags. This changes the request policy to
`cache: "force-cache"`; it is never the default.

```tsx
import { createNextQueryTag, createNextServerClient } from "@consulting/sdk";

const client = createNextServerClient({
  baseUrl: process.env.API_BASE_URL as string,
  revalidate: 60,
  tags: [createNextQueryTag("public-catalog")],
});
```

## Browser clients and invalidation

Use the browser wrapper in client components. Supply an in-memory token getter
or another application-owned credential boundary; the SDK has no
`localStorage` token behavior.

```tsx
"use client";

import { createBrowserApiClient } from "@consulting/sdk";

const client = createBrowserApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL as string,
  getAccessToken: () => inMemoryAccessToken,
});
```

After a server-side mutation, use `revalidatePath` for the affected route and
`revalidateTag` with the same `createNextQueryTag` value for tagged cache
entries. In a Server Action, the current Next.js API can be used like this:

```tsx
import { revalidatePath, revalidateTag } from "next/cache";
import { createNextQueryTag } from "@consulting/sdk";

revalidatePath("/dashboard");
revalidateTag(createNextQueryTag("public-catalog"), "max");
```

Keep authorization and business behavior in the existing REST API; Next
components are consumers, not a second API implementation.
