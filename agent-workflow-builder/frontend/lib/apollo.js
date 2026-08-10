import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  split,
} from '@apollo/client';

import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { setContext } from '@apollo/client/link/context';

import { nhost } from './nhost';

function makeApolloClient() {
  const GRAPHQL_URL =
    process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL;

  if (!GRAPHQL_URL) {
    throw new Error(
      'NEXT_PUBLIC_HASURA_GRAPHQL_URL is not defined'
    );
  }

  const httpLink = new HttpLink({
    uri: GRAPHQL_URL,
  });

  const authLink = setContext((_, { headers }) => {
    const token = nhost.auth.getAccessToken();

    return {
      headers: {
        ...headers,
        ...(token
          ? {
              Authorization: `Bearer ${token}`,
            }
          : {}),
      },
    };
  });

  const authenticatedHttpLink = authLink.concat(httpLink);

  if (typeof window === 'undefined') {
    return new ApolloClient({
      link: authenticatedHttpLink,
      cache: new InMemoryCache(),
    });
  }

  const wsUrl = GRAPHQL_URL.replace(/^http/, 'ws');

  const wsLink = new GraphQLWsLink(
    createClient({
      url: wsUrl,
      connectionParams: () => {
        const token = nhost.auth.getAccessToken();

        return token
          ? {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          : {};
      },
    })
  );

  const link = split(
    ({ query }) => {
      const definition = getMainDefinition(query);

      return (
        definition.kind === 'OperationDefinition' &&
        definition.operation === 'subscription'
      );
    },
    wsLink,
    authenticatedHttpLink
  );

  return new ApolloClient({
    link,
    cache: new InMemoryCache(),
  });
}

export default makeApolloClient;
