import { useMemo } from 'react';
import { NhostProvider } from '@nhost/react';
import { ApolloProvider } from '@apollo/client';
import { nhost } from '../lib/nhost';
import makeApolloClient from '../lib/apollo';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  const apolloClient = useMemo(() => makeApolloClient(), []);
  return (
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={apolloClient}>
        <Component {...pageProps} />
      </ApolloProvider>
    </NhostProvider>
  );
}
