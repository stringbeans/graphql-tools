import {
  GraphQLArgument,
  GraphQLArgumentConfig,
  GraphQLCompositeType,
  GraphQLField,
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFieldMap,
  GraphQLInputField,
  GraphQLInputFieldConfig,
  GraphQLInputFieldConfigMap,
  GraphQLInputFieldMap,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLUnionType,
} from 'graphql';
import { ResolveType } from '../Interfaces';
import resolveFromParentTypename from './resolveFromParentTypename';
import defaultMergedResolver from './defaultMergedResolver';

export function recreateCompositeType(
  type: GraphQLCompositeType | GraphQLInputObjectType,
  resolveType: ResolveType<any>,
): GraphQLCompositeType | GraphQLInputObjectType {
  if (type instanceof GraphQLObjectType) {
    const fields = type.getFields();
    const interfaces = type.getInterfaces();

    return new GraphQLObjectType({
      name: type.name,
      description: type.description,
      fields: () => fieldMapToFieldConfigMap(fields, resolveType),
      interfaces: () => interfaces.map(iface => resolveType(iface)),
    });
  } else if (type instanceof GraphQLInterfaceType) {
    const fields = type.getFields();

    return new GraphQLInterfaceType({
      name: type.name,
      description: type.description,
      fields: () => fieldMapToFieldConfigMap(fields, resolveType),
      resolveType: (parent, context, info) =>
        resolveFromParentTypename(parent, info.schema),
    });
  } else if (type instanceof GraphQLUnionType) {
    return new GraphQLUnionType({
      name: type.name,
      description: type.description,
      types: () => type.getTypes().map(unionMember => resolveType(unionMember)),
      resolveType: (parent, context, info) =>
        resolveFromParentTypename(parent, info.schema),
    });
  } else if (type instanceof GraphQLInputObjectType) {
    return new GraphQLInputObjectType({
      name: type.name,
      description: type.description,
      fields: () =>
        inputFieldMapToFieldConfigMap(type.getFields(), resolveType),
    });
  } else {
    throw new Error(`Invalid type ${type}`);
  }
}

export function fieldMapToFieldConfigMap(
  fields: GraphQLFieldMap<any, any>,
  resolveType: ResolveType<any>,
): GraphQLFieldConfigMap<any, any> {
  const result: GraphQLFieldConfigMap<any, any> = {};
  Object.keys(fields).forEach(name => {
    const field = fields[name];
    const type = resolveType(field.type);
    if (type !== null) {
      result[name] = fieldToFieldConfig(fields[name], resolveType);
    }
  });
  return result;
}

export function createResolveType(
  getType: (name: string, type: GraphQLType) => GraphQLType | null,
): ResolveType<any> {
  const resolveType = <T extends GraphQLType>(type: T): T => {
    if (type instanceof GraphQLList) {
      const innerType = resolveType(type.ofType);
      if (innerType === null) {
        return null;
      } else {
        return new GraphQLList(innerType) as T;
      }
    } else if (type instanceof GraphQLNonNull) {
      const innerType = resolveType(type.ofType);
      if (innerType === null) {
        return null;
      } else {
        return new GraphQLNonNull(innerType) as T;
      }
    } else if (isNamedType(type)) {
      return getType(getNamedType(type).name, type) as T;
    } else {
      return type;
    }
  };
  return resolveType;
}

function fieldToFieldConfig(
  field: GraphQLField<any, any>,
  resolveType: ResolveType<any>,
): GraphQLFieldConfig<any, any> {
  return {
    type: resolveType(field.type),
    args: argsToFieldConfigArgumentMap(field.args, resolveType),
    resolve: defaultMergedResolver,
    description: field.description,
    deprecationReason: field.deprecationReason,
  };
}

function argsToFieldConfigArgumentMap(
  args: Array<GraphQLArgument>,
  resolveType: ResolveType<any>,
): GraphQLFieldConfigArgumentMap {
  const result: GraphQLFieldConfigArgumentMap = {};
  args.forEach(arg => {
    const [name, def] = argumentToArgumentConfig(arg, resolveType);
    result[name] = def;
  });
  return result;
}

function argumentToArgumentConfig(
  argument: GraphQLArgument,
  resolveType: ResolveType<any>,
): [string, GraphQLArgumentConfig] {
  return [
    argument.name,
    {
      type: resolveType(argument.type),
      defaultValue: argument.defaultValue,
      description: argument.description,
    },
  ];
}

function inputFieldMapToFieldConfigMap(
  fields: GraphQLInputFieldMap,
  resolveType: ResolveType<any>,
): GraphQLInputFieldConfigMap {
  const result: GraphQLInputFieldConfigMap = {};
  Object.keys(fields).forEach(name => {
    const field = fields[name];
    const type = resolveType(field.type);
    if (type !== null) {
      result[name] = inputFieldToFieldConfig(fields[name], resolveType);
    }
  });
  return result;
}

function inputFieldToFieldConfig(
  field: GraphQLInputField,
  resolveType: ResolveType<any>,
): GraphQLInputFieldConfig {
  return {
    type: resolveType(field.type),
    defaultValue: field.defaultValue,
    description: field.description,
  };
}
