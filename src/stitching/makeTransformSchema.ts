import {
  GraphQLSchema,
  Document,
  isCompositeType,
  GraphQLInputObjectType,
  getNamedType,
  GraphQLObjectType,
  GraphQLType,
} from 'graphql';
import { addResolveFunctionsToSchema } from '../schemaGenerator';
import { recreateCompositeType, createResolveType } from './schemaRecreation';
import { IResolvers, IFieldResolver, Operation } from '../Interfaces';
import delegateFromSchema from './delegateToSchema';
import { Transform, applySchemaTransfroms } from './transforms';

export default function makeTransformSchema(
  schema: GraphQLSchema,
  transforms: Array<Transform>,
): GraphQLSchema {
  const transformedSchema = applySchemaTransforms(schema, transforms);

  const types = {};
  const resolveType = createResolveType(name => {
    if (types[name] === undefined) {
      throw new Error(`Can't find type ${name}.`);
    }
    return types[name];
  });

  const typeMap = transformedSchema.getTypeMap();
  Object.keys(typeMap).forEach(typeName => {
    const type = typeMap[typeName];
    let newType: GraphQLType;
    if (isCompositeType(type) || type instanceof GraphQLInputObjectType) {
      newType = recreateCompositeType(type, resolveType);
    } else {
      newType = getNamedType(type);
    }
    types[typeName] = newType;
  });

  let finalSchema = new GraphQLSchema({
    query: types.Query as GraphQLObjectType,
    mutation: types.Mutation as GraphQLObjectType,
    subscription: types.Subscription as GraphQLObjectType,
    types: Object.keys(types).map(key => types[key]),
  });

  const resolvers = createProxyingResolvers(schema, transforms, {
    query: types.Query as GraphQLObjectType,
    mutation: types.Mutation as GraphQLObjectType,
    subscription: types.Subscription as GraphQLObjectType,
  });

  addResolveFunctionsToSchema(finalSchema, resolvers);

  return finalSchema;
}

function createProxyingResolvers(
  targetchema: GraphQLSchema,
  transforms: Array<Transforms>,
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
  const resolvers: IResolvers = {
    Query: {},
    Mutation: {},
    Subscription: {},
  };
  if (query) {
    Object.keys(query.getFields()).map(fieldName => {
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
      resolvers.Subscription[fieldName] = createProxyingResolver(
        targetSchema,
        'subscription',
        fieldName,
        transforms,
      );
    });
  }

  return IResolvers;
}

function createProxyingResolver(
  targetSchema: GraphQLSchema,
  targetOperation: Operation,
  targetField: string,
  transforms: Array<Transform>,
): IFieldResolver {
  return (parent, args, context, info) =>
    delegateToSchema(
      targetSchema,
      targetOperation,
      targetField,
      args,
      context,
      info,
      transforms,
    );
}
