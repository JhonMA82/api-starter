# TanStack Query integration

The SDK kit returns dependency-free query option objects. Install and own
`@tanstack/react-query` in the consuming application; this kit does not install
React Query, React, or a framework.

## Query options

```tsx
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { createSdkQueries, type ApiClient } from "@consulting/sdk";

const sdkQueries = (client: ApiClient) => {
  const sdk = createSdkQueries(client);
  return {
    organizations: () => queryOptions(sdk.organizations()),
  };
};

export function Organizations({ client }: { client: ApiClient }) {
  const organizationsQuery = useQuery(sdkQueries(client).organizations());
  return <pre>{JSON.stringify(organizationsQuery.data ?? [], null, 2)}</pre>;
}

export async function refreshOrganizations(
  queryClient: QueryClient,
  client: ApiClient,
): Promise<void> {
  const query = sdkQueries(client).organizations();
  await queryClient.invalidateQueries({
    queryKey: query.queryKey,
  });
}
```

`queryFn` is lazy: creating the options does not make a request. Keep query keys
stable and invalidate the matching SDK key prefix after mutations.

## SSR hydration

```tsx
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";

export async function OrganizationsPage({ client }: { client: ApiClient }) {
  const queryClient = new QueryClient();
  const query = sdkQueries(client).organizations();
  await queryClient.prefetchQuery(query);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Organizations client={client} />
    </HydrationBoundary>
  );
}
```

Use `createSdkMutationInvalidations()` to keep mutation invalidation policy in
one place, then pass each returned prefix to the installed `QueryClient`.
