import {
  GraphQLFieldResolver,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import { addResolveFunctionsToSchema } from '../schemaGenerator';
import { IResolvers, Operation } from '../Interfaces';
import delegateToSchema from './delegateToSchema';
import { Transform, applySchemaTransforms } from '../transforms';
import visitSchema from '../transforms/visitSchema';

export default function makeTransformSchema(
  schema: GraphQLSchema,
  transforms: Array<Transform>,
): GraphQLSchema {
  const transformedSchema = applySchemaTransforms(schema, transforms);
  const finalSchema = visitSchema(transformedSchema, {});

  const resolvers = createProxyingResolvers(schema, transforms, {
    query: finalSchema.getQueryType(),
    mutation: finalSchema.getMutationType(),
    subscription: finalSchema.getSubscriptionType(),
  });

  addResolveFunctionsToSchema(finalSchema, resolvers);

  return finalSchema;
}

function createProxyingResolvers(
  targetSchema: GraphQLSchema,
  transforms: Array<Transform>,
  {
    query,
    mutation,
    subscription,
  }: {
    query?: GraphQLObjectType;
    mutation?: GraphQLObjectType;
    subscription?: GraphQLObjectType;
  },
): IResolvers {
  const resolvers: IResolvers = {};
  if (query) {
    Object.keys(query.getFields()).map(fieldName => {
      if (!resolvers.Query) {
        resolvers.Query = {};
      }
      resolvers.Query[fieldName] = createProxyingResolver(
        targetSchema,
        'query',
        fieldName,
        transforms,
      );
    });
  }

  if (mutation) {
    Object.keys(mutation.getFields()).map(fieldName => {
      if (!resolvers.Mutation) {
        resolvers.Mutation = {};
      }
      resolvers.Mutation[fieldName] = createProxyingResolver(
        targetSchema,
        'mutation',
        fieldName,
        transforms,
      );
    });
  }

  if (subscription) {
    Object.keys(subscription.getFields()).map(fieldName => {
      if (!resolvers.Subscription) {
        resolvers.Subscription = {};
      }
      resolvers.Subscription[fieldName] = createProxyingResolver(
        targetSchema,
        'subscription',
        fieldName,
        transforms,
      );
    });
  }

  return resolvers;
}

function createProxyingResolver(
  targetSchema: GraphQLSchema,
  targetOperation: Operation,
  targetField: string,
  transforms: Array<Transform>,
): GraphQLFieldResolver<any, any> {
  return (parent, args, context, info) =>
    delegateToSchema(
      targetSchema,
      targetOperation,
      targetField,
      {},
      context,
      info,
      transforms,
    );
}
