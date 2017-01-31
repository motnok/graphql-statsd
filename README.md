# graphql-statsd

Package for collecting metrics from an [expressjs/express](https://github.com/expressjs/express) / [apollographql/graphql-server](https://github.com/apollographql/graphql-server) based GraphQL server, and sending those to a statsd service.

```
npm install graphql-statsd
```

Currently it collects timings and counts for the entire requests as well as the individual resolvers in the query.

## Usage

Install using NPM and include in your project together with a statsd client.
In this sample we use [brightcove/hot-shots](https://github.com/brightcove/hot-shots) - but any client implementing `increment` and `timing` methods should work.

```
import graphqlStatsd from 'graphql-statsd';
import statsD from 'hot-shots';
```

Instantiate the graphql-statsd module with the statsd client:

```
const graphqlStatsdModule = new graphqlStatsd(new statsD());
``` 

Decorate your GraphQL schema using the 

```
const schema = graphqlStatsdModule.decorateSchema(importedSchema);
```

Add the express middleware and define the `graphqlStatsdContext` context from the express `request` property.
The `graphqlStatsdContext` is used to inject data from the request (operation name, query hash etc.) into the resolver metrics for traceability:

```
graphQLApp.post(['/', '/graphql'], bodyParser.json(), graphqlStatsdModule.getExpressMiddleware(), graphqlExpress(request => ({
  schema: schema,
  context: {
    graphqlStatsdContext: request.graphqlStatsdContext
  }
})));
```

You should now be good to go!

## Tests

Currently no tests are implemented

## Thanks

* [kadirahq/npm-base](https://github.com/kadirahq/npm-base)
* [apollographql/optics-agent-js](https://github.com/apollographql/optics-agent-js)