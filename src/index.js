import onFinished from 'on-finished';
import {format} from 'util';
import clockit from 'clockit';
import md5 from 'md5';
import {getNamedType} from 'graphql';

/**
 * A default client
 * Logs to console
 *
 * @return object
 */
const getDefaultClient = () => {
  console.warn('Using default graphqlStatsd client!');
  return {
    increment: (name, value, sampleRate, tags, callback) => {
      console.info('graphqlStatsd:increment');
      console.log(name, value, sampleRate, tags);
      if (callback && typeof callback === 'function') {
        return callback();
      }
    },
    timing: (name, value, sampleRate, tags, callback) => {
      console.info('graphqlStatsd:timing');
      console.log(name, value, sampleRate, tags);
      if (callback && typeof callback === 'function') {
        return callback();
      }
    }
  };
};

export default class {

  /**
   * Create a new GraphQL Statsd Client
   * @param  object statsdClient
   * @return void
   */
  constructor(statsdClient = getDefaultClient()) {
    if (!statsdClient) {
      throw new Error('StatsdClient is required');
    }

    if (!statsdClient.timing || typeof statsdClient.timing !== 'function') {
      throw new Error('StatsdClient must implement timing method');
    }

    if (!statsdClient.increment ||
      typeof statsdClient.increment !== 'function') {
      throw new Error('StatsdClient must implement increment method');
    }

    this.statsdClient = statsdClient;
  }

  /**
   * The sample rate to use for statsd reporting
   *
   * @return float
   */
  get sampleRate() {
    return this._sampleRate ? this._sampleRate : 1;
  }

  /**
   * Set the sample rate to use for statsd reporting
   *
   * @param  float value
   * @return void
   */
  set sampleRate(value) {
    this._sampleRate = value;
  }

  /**
   * Decorate individual GraphQL resolvers
   *
   * Adds timers and increments
   *
   * @param  function resolver
   * @param  object fieldInfo
   * @return mixed
   */
  decorateResolver(resolver, fieldInfo) {
    return (p, a, ctx, resolverInfo) => {
      const resolveTimer = clockit.start();
      const context = ctx.graphqlStatsdContext ?
       ctx.graphqlStatsdContext : undefined;

      if (!context) {
        console.warn('graphqlStatsd: Context is undefined!');
      }

      // Send the resolve stat
      const statResolve = err => {
        let tags = [];
        if (fieldInfo.statsdTags)
          tags = tags.concat(fieldInfo.statsdTags);

        if (err) {
          // In case Apollo Error is used, send the err.data.type
          tags.push(format('error:%s', err.data ? err.data.type : err.name));
        }

        if (context) {
          tags.push(format('queryHash:%s', context.queryHash));
          tags.push(format('operationName:%s', context.operationName));
        }
        tags.push(format('resolveName:%s', fieldInfo.name ?
          fieldInfo.name : 'undefined'));

        this.statsdClient.timing(
          'resolve_time',
          resolveTimer.ms,
          this.sampleRate,
          tags
        );
        if (err) {
          this.statsdClient.increment('resolve_error', 1, this.sampleRate, tags);
        }
      };

      // Heavily inspired by:
      // apollographql/optics-agent-js
      // https://git.io/vDL9p

      let result;
      try {
        result = resolver(p, a, ctx, resolverInfo);
      } catch (e) {
        statResolve(e);
        throw e;
      }

      try {
        if (result && typeof result.then === 'function') {
          result.then(res => {
            statResolve();
            return res;
          }).catch(err => {
            statResolve(err);
            throw err;
          });
          return result;
        } else if (Array.isArray(result)) {
          const promises = [];
          result.forEach(value => {
            if (value && typeof value.then === 'function') {
              promises.push(value);
            }
          });
          if (promises.length > 0) {
            Promise.all(promises).then(() => {
              statResolve();
            }).catch(err => {
              statResolve(err);
              throw err;
            });
            return result;
          }
        }

        statResolve();
        return result;
      } catch (e) {
        statResolve(e);
        return result;
      }

      return result;
    };
  }

  /**
   * Decorate the schema with decorated resolvers
   *
   * @param GraphQLSchema schema
   * @return GraphQLSchema
   */
  decorateSchema(schema) {
    var typeMap = schema.getTypeMap();
    Object.keys(typeMap).forEach(typeName => {
      var type = typeMap[typeName];
      if (!getNamedType(type).name.startsWith('__') && type.getFields) {
        var fields = type.getFields();
        Object.keys(fields).forEach(fieldName => {
          var field = fields[fieldName];
          if (field.resolve) {
            field.resolve = this.decorateResolver(field.resolve, field);
          }
        });
      }
    });

    return schema;
  }

  /**
   * Get express middleware to handle incomming requests
   *
   * @param config object that can hold:
   *   - tagQueryHash: if true metrics will be tagged with queryHash
   *   - tagOperationName: if true metrics will be tagged with operationName
   *   if config is not available, metrics will be tagged with queryHash and operationName
   *   if config is available metrics will only be tagged with available options, missing options is equivalent to false
   * @return function
   */
  getExpressMiddleware(config) {
    return (req, res, next) => {
      const timer = clockit.start();

      req.graphqlStatsdContext = {
        queryHash: req.body.query ? md5(req.body.query) : null,
        operationName: req.body.operationName ? req.body.operationName : null
      };
      var tags = [];

      if (!config || config.tagQueryHash) {
        tags.push(format('queryHash:%s', req.graphqlStatsdContext.queryHash))
      }

      if (!config || config.tagOperationName) {
        tags.push(format('operationName:%s', req.graphqlStatsdContext.operationName))
      }

      onFinished(res, () => {
        this.statsdClient.timing(
          'response_time',
          timer.ms,
          this.sampleRate,
          tags
        );
      });
      next();
    };
  }
}
