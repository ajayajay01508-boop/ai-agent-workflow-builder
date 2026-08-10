import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';
import { nhost } from './nhost';

function makeApolloClient() {
  const graphqlUrl = process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL; // https://<sub>.nhost.run/v1/graphql
  const wsUrl = graphqlUrl.replace(/^http/, 'ws');

  const httpLink = new HttpLink({ uri: graphqlUrl });

  const authLink = setContext(async (_, { headers }) => {
    const token = nhost.auth.getAccessToken();
    return {
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  });

  const wsLink =
    typeof window !== 'undefined'
      ? new GraphQLWsLink(
          createClient({
            url: wsUrl,
            connectionParams: () => {
              const token = nhost.auth.getAccessToken();
              return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
            },
          })
        )
      : null;

  const splitLink =
    typeof window !== 'undefined'
      ? split(
          ({ query }) => {
            const def = getMainDefinition(query);
            return def.kind === 'OperationDefinition' && def.operation === 'subscription';
          },
          wsLink,
          authLink.concat(httpLink)
        )
      : authLink.concat(httpLink);

  return new ApolloClient({ link: splitLink, cache: new InMemoryCache() });
}

export default makeApolloClient;
