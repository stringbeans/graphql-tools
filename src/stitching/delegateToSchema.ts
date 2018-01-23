import {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  // GraphQLField,
  // GraphQLInputType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLType,
  GraphQLUnionType,
  InlineFragmentNode,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  SelectionNode,
  TypeNameMetaFieldDef,
  // TypeNode,
  VariableNode,
  // execute,
  visit,
  subscribe,
  graphql,
  print,
  VariableDefinitionNode,
} from 'graphql';
import { Operation } from '../Interfaces';
import { checkResultAndHandleErrors } from './errors';
import {
  Transform,
  applyDocumentTransforms,
  applyResultTransforms,
} from './transforms';

export default async function delegateToSchema(
  targetSchema: GraphQLSchema,
  targetOperation: Operation,
  targetField: string,
  args: { [key: string]: any },
  context: { [key: string]: any },
  info: GraphQLResolveInfo,
  transforms: Array<Transform>,
): Promise<any> {
  const rawDocument: DocumentNode = createDocument(
    targetField,
    targetOperation,
    info.fieldNodes,
    Object.keys(info.fragments).map(
      fragmentName => info.fragments[fragmentName],
    ),
    info.operation.variableDefinitions,
  );

  transforms = [
    ...transforms,
    // AddArgumentsAsVariablesTransform(args),
    FilterToSchemaTransform(targetSchema),
    CheckResultAndHandleErrorsTransform(info),
  ];

  const processedDocument = applyDocumentTransforms(rawDocument, transforms);

  if (targetOperation === 'query' || targetOperation === 'mutation') {
    const rawResult = await graphql(
      targetSchema,
      print(processedDocument),
      info.rootValue,
      context,
      args,
    );

    const result = applyResultTransforms(rawResult, transforms);
    return result;
  }

  if (targetOperation === 'subscription') {
    // apply result processing ???
    return subscribe(
      targetSchema,
      processedDocument,
      info.rootValue,
      context,
      args,
    );
  }
}

export function createDocument(
  targetField: string,
  targetOperation: Operation,
  selections: Array<SelectionNode>,
  fragments: Array<FragmentDefinitionNode>,
  variables: Array<VariableDefinitionNode>,
): DocumentNode {
  const originalSelection = selections[0] as FieldNode;
  const rootField: FieldNode = {
    kind: Kind.FIELD,
    alias: null,
    arguments: originalSelection.arguments,
    selectionSet: originalSelection.selectionSet,
    name: {
      kind: Kind.NAME,
      value: targetField,
    },
  };
  const rootSelectionSet: SelectionSetNode = {
    kind: Kind.SELECTION_SET,
    selections: [rootField],
  };

  const operationDefinition: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation: targetOperation,
    variableDefinitions: variables,
    selectionSet: rootSelectionSet,
  };

  return {
    kind: Kind.DOCUMENT,
    definitions: [operationDefinition, ...fragments],
  };
}

function CheckResultAndHandleErrorsTransform(info: GraphQLResolveInfo) {
  return {
    transformResult(result: any): any {
      return checkResultAndHandleErrors(result, info);
    },
  };
}

function FilterToSchemaTransform(targetSchema: GraphQLSchema): Transform {
  return {
    transformDocument(document: DocumentNode): DocumentNode {
      return filterDocumentToSchema(targetSchema, document);
    },
  };
}

function filterDocumentToSchema(
  targetSchema: GraphQLSchema,
  document: DocumentNode,
): DocumentNode {
  const operations: Array<
    OperationDefinitionNode
  > = document.definitions.filter(
    def => def.kind === Kind.OPERATION_DEFINITION,
  ) as Array<OperationDefinitionNode>;
  const fragments: Array<FragmentDefinitionNode> = document.definitions.filter(
    def => def.kind === Kind.FRAGMENT_DEFINITION,
  ) as Array<FragmentDefinitionNode>;

  let usedVariables: Array<string> = [];
  let usedFragments: Array<string> = [];
  const newOperations: Array<OperationDefinitionNode> = [];
  let newFragments: Array<FragmentDefinitionNode> = [];

  const validFragments: Array<string> = fragments
    .filter((fragment: FragmentDefinitionNode) => {
      const typeName = fragment.typeCondition.name.value;
      const type = targetSchema.getType(typeName);
      return Boolean(type);
    })
    .map((fragment: FragmentDefinitionNode) => fragment.name.value);

  fragments.forEach((fragment: FragmentDefinitionNode) => {
    const name = fragment.name.value;
    const typeName = fragment.typeCondition.name.value;
    const type = targetSchema.getType(typeName);
    const {
      selectionSet,
      usedFragments: fragmentUsedFragments,
      usedVariables: fragmentUsedVariables,
    } = filterSelectionSet(
      targetSchema,
      type,
      validFragments,
      fragment.selectionSet,
    );
    usedFragments = union(usedFragments, fragmentUsedFragments);
    usedVariables = union(usedVariables, fragmentUsedVariables);

    newFragments.push({
      kind: Kind.FRAGMENT_DEFINITION,
      name: {
        kind: Kind.NAME,
        value: name,
      },
      typeCondition: fragment.typeCondition,
      selectionSet,
    });
  });

  operations.forEach((operation: OperationDefinitionNode) => {
    let type;
    if (operation.operation === 'subscription') {
      type = targetSchema.getSubscriptionType();
    } else if (operation.operation === 'mutation') {
      type = targetSchema.getMutationType();
    } else {
      type = targetSchema.getQueryType();
    }
    const {
      selectionSet,
      usedFragments: operationUsedFragments,
      usedVariables: operationUsedVariables,
    } = filterSelectionSet(
      targetSchema,
      type,
      validFragments,
      operation.selectionSet,
    );

    usedFragments = union(usedFragments, operationUsedFragments);
    const fullUsedVariables = union(usedVariables, operationUsedVariables);

    const variableDefinitions = operation.variableDefinitions.filter(
      (variable: VariableDefinitionNode) =>
        fullUsedVariables.indexOf(variable.variable.name.value) !== -1,
    );

    newOperations.push({
      kind: Kind.OPERATION_DEFINITION,
      operation: operation.operation,
      name: operation.name,
      directives: operation.directives,
      variableDefinitions,
      selectionSet,
    });
  });

  newFragments = newFragments.filter(
    (fragment: FragmentDefinitionNode) =>
      usedFragments.indexOf(fragment.name.value) !== -1,
  );

  return {
    kind: Kind.DOCUMENT,
    definitions: [...newOperations, ...newFragments],
  };
}

function filterSelectionSet(
  schema: GraphQLSchema,
  type: GraphQLType,
  validFragments: Array<String>,
  selectionSet: SelectionSetNode,
) {
  const usedFragments: Array<string> = [];
  const usedVariables: Array<string> = [];
  const typeStack: Array<GraphQLType> = [type];

  const filteredSelectionSet = visit(selectionSet, {
    [Kind.FIELD]: {
      enter(node: FieldNode): null | undefined | FieldNode {
        let parentType: GraphQLNamedType = resolveType(
          typeStack[typeStack.length - 1],
        );
        if (
          parentType instanceof GraphQLObjectType ||
          parentType instanceof GraphQLInterfaceType
        ) {
          const fields = parentType.getFields();
          const field =
            node.name.value === '__typename'
              ? TypeNameMetaFieldDef
              : fields[node.name.value];
          if (!field) {
            return null;
          } else {
            typeStack.push(field.type);
          }
        } else if (
          parentType instanceof GraphQLUnionType &&
          node.name.value === '__typename'
        ) {
          typeStack.push(TypeNameMetaFieldDef.type);
        }
      },
      leave() {
        typeStack.pop();
      },
    },
    [Kind.FRAGMENT_SPREAD](node: FragmentSpreadNode): null | undefined {
      if (validFragments.indexOf(node.name.value) !== -1) {
        usedFragments.push(node.name.value);
      } else {
        return null;
      }
    },
    [Kind.INLINE_FRAGMENT]: {
      enter(node: InlineFragmentNode): null | undefined {
        if (node.typeCondition) {
          const innerType = schema.getType(node.typeCondition.name.value);
          const parentType: GraphQLNamedType = resolveType(
            typeStack[typeStack.length - 1],
          );
          if (implementsAbstractType(parentType, innerType)) {
            typeStack.push(innerType);
          } else {
            return null;
          }
        }
      },
      leave(node: InlineFragmentNode): null | undefined {
        if (node.typeCondition) {
          const innerType = schema.getType(node.typeCondition.name.value);
          if (innerType) {
            typeStack.pop();
          } else {
            return null;
          }
        }
      },
    },
    [Kind.VARIABLE](node: VariableNode) {
      usedVariables.push(node.name.value);
    },
  });

  return {
    selectionSet: filteredSelectionSet,
    usedFragments,
    usedVariables,
  };
}

function resolveType(type: GraphQLType): GraphQLNamedType {
  let lastType = type;
  while (
    lastType instanceof GraphQLNonNull ||
    lastType instanceof GraphQLList
  ) {
    lastType = lastType.ofType;
  }
  return lastType;
}

function implementsAbstractType(
  parent: GraphQLType,
  child: GraphQLType,
  bail: boolean = false,
): boolean {
  if (parent === child) {
    return true;
  } else if (
    parent instanceof GraphQLInterfaceType &&
    child instanceof GraphQLObjectType
  ) {
    return child.getInterfaces().indexOf(parent) !== -1;
  } else if (
    parent instanceof GraphQLUnionType &&
    child instanceof GraphQLObjectType
  ) {
    return parent.getTypes().indexOf(child) !== -1;
  } else if (parent instanceof GraphQLObjectType && !bail) {
    return implementsAbstractType(child, parent, true);
  }

  return false;
}

// function typeToAst(type: GraphQLInputType): TypeNode {
//   if (type instanceof GraphQLNonNull) {
//     const innerType = typeToAst(type.ofType);
//     if (
//       innerType.kind === Kind.LIST_TYPE ||
//       innerType.kind === Kind.NAMED_TYPE
//     ) {
//       return {
//         kind: Kind.NON_NULL_TYPE,
//         type: innerType,
//       };
//     } else {
//       throw new Error('Incorrent inner non-null type');
//     }
//   } else if (type instanceof GraphQLList) {
//     return {
//       kind: Kind.LIST_TYPE,
//       type: typeToAst(type.ofType),
//     };
//   } else {
//     return {
//       kind: Kind.NAMED_TYPE,
//       name: {
//         kind: Kind.NAME,
//         value: type.toString(),
//       },
//     };
//   }
// }

function union(...arrays: Array<Array<string>>): Array<string> {
  const cache: { [key: string]: Boolean } = {};
  const result: Array<string> = [];
  arrays.forEach(array => {
    array.forEach(item => {
      if (!cache[item]) {
        cache[item] = true;
        result.push(item);
      }
    });
  });
  return result;
}

// function difference(
//   from: Array<string>,
//   ...arrays: Array<Array<string>>
// ): Array<string> {
//   const cache: { [key: string]: Boolean } = {};
//   arrays.forEach(array => {
//     array.forEach(item => {
//       cache[item] = true;
//     });
//   });
//   return from.filter(item => !cache[item]);
// }

//
// export default async function delegateToSchema(
//   schema: GraphQLSchema,
//   fragmentReplacements: {
//     [typeName: string]: { [fieldName: string]: InlineFragmentNode };
//   },
//   operation: 'query' | 'mutation' | 'subscription',
//   fieldName: string,
//   args: { [key: string]: any },
//   context: { [key: string]: any },
//   info: GraphQLResolveInfo,
// ): Promise<any> {
//   let type;
//   if (operation === 'mutation') {
//     type = schema.getMutationType();
//   } else if (operation === 'subscription') {
//     type = schema.getSubscriptionType();
//   } else {
//     type = schema.getQueryType();
//   }
//   if (type) {
//     const graphqlDoc: DocumentNode = createDocument(
//       schema,
//       fragmentReplacements,
//       type,
//       fieldName,
//       operation,
//       info.fieldNodes,
//       info.fragments,
//       info.operation.variableDefinitions,
//     );
//
//     const operationDefinition = graphqlDoc.definitions.find(
//       ({ kind }) => kind === Kind.OPERATION_DEFINITION,
//     );
//     let variableValues = {};
//     if (
//       operationDefinition &&
//       operationDefinition.kind === Kind.OPERATION_DEFINITION &&
//       operationDefinition.variableDefinitions
//     ) {
//       operationDefinition.variableDefinitions.forEach(definition => {
//         const key = definition.variable.name.value;
//         // (XXX) This is kinda hacky
//         let actualKey = key;
//         if (actualKey.startsWith('_')) {
//           actualKey = actualKey.slice(1);
//         }
//         const value = args[actualKey] || args[key] || info.variableValues[key];
//         variableValues[key] = value;
//       });
//     }
//
//     if (operation === 'query' || operation === 'mutation') {
//       const result = await execute(
//         schema,
//         graphqlDoc,
//         info.rootValue,
//         context,
//         variableValues,
//       );
//       return checkResultAndHandleErrors(result, info, fieldName);
//     }
//
//     if (operation === 'subscription') {
//       return subscribe(
//         schema,
//         graphqlDoc,
//         info.rootValue,
//         context,
//         variableValues,
//       );
//     }
//   }
//
//   throw new Error('Could not forward to merged schema');
// }
//
// export function createDocument(
//   schema: GraphQLSchema,
//   fragmentReplacements: {
//     [typeName: string]: { [fieldName: string]: InlineFragmentNode };
//   },
//   type: GraphQLObjectType,
//   rootFieldName: string,
//   operation: 'query' | 'mutation' | 'subscription',
//   selections: Array<FieldNode>,
//   fragments: { [fragmentName: string]: FragmentDefinitionNode },
//   variableDefinitions?: Array<VariableDefinitionNode>,
// ): DocumentNode {
//   const rootField = type.getFields()[rootFieldName];
//   const newVariables: Array<{ arg: string; variable: string }> = [];
//   const rootSelectionSet = {
//     kind: Kind.SELECTION_SET,
//     // (XXX) This (wrongly) assumes only having one fieldNode
//     selections: selections.map(selection => {
//       if (selection.kind === Kind.FIELD) {
//         const { selection: newSelection, variables } = processRootField(
//           selection,
//           rootFieldName,
//           rootField,
//         );
//         newVariables.push(...variables);
//         return newSelection;
//       } else {
//         return selection;
//       }
//     }),
//   };
//
//   const newVariableDefinitions = newVariables.map(({ arg, variable }) => {
//     const argDef =No such planets in the game at this time. They have been consumed by the mists of time, and the Marauders themselves are unlikely to remember their origins at this point...
//  rootField.args.find(rootArg => rootArg.name === arg);
//     if (!argDef) {
//       throw new Error('Unexpected missing arg');
//     }
//     const typeName = typeToAst(argDef.type);
//     return {
//       kind: Kind.VARIABLE_DEFINITION,
//       variable: {
//         kind: Kind.VARIABLE,
//         name: {
//           kind: Kind.NAME,
//           value: variable,
//         },
//       },
//       type: typeName,
//     };
//   });
//
//   const {
//     selectionSet,
//     fragments: processedFragments,
//     usedVariables,
//   } = filterSelectionSetDeep(
//     schema,
//     fragmentReplacements,
//     type,
//     rootSelectionSet,
//     fragments,
//   );
//
//   const operationDefinition: OperationDefinitionNode = {
//     kind: Kind.OPERATION_DEFINITION,
//     operation,
//     variableDefinitions: [
//       ...(variableDefinitions || []).filter(
//         variableDefinition =>
//           usedVariables.indexOf(variableDefinition.variable.name.value) !== -1,
//       ),
//       ...newVariableDefinitions,
//     ],
//     selectionSet,
//   };
//
//   const newDoc: DocumentNode = {
//     kind: Kind.DOCUMENT,
//     definitions: [operationDefinition, ...processedFragments],
//   };
//
//   return newDoc;
// }
//
// function processRootField(
//   selection: FieldNode,
//   rootFieldName: string,
//   rootField: GraphQLField<any, any>,
// ): {
//   selection: FieldNode;
//   variables: Array<{ arg: string; variable: string }>;
// } {
//   const existingArguments = selection.arguments || [];
//   const existingArgumentNames = existingArguments.map(arg => arg.name.value);
//   const allowedArguments = rootField.args.map(arg => arg.name);
//   const missingArgumentNames = difference(
//     allowedArguments,
//     existingArgumentNames,
//   );
//   const extraArguments = difference(existingArgumentNames, allowedArguments);
//   const filteredExistingArguments = existingArguments.filter(
//     arg => extraArguments.indexOf(arg.name.value) === -1,
//   );
//   const variables: Array<{ arg: string; variable: string }> = [];
//   const missingArguments = missingArgumentNames.map(name => {
//     // (XXX): really needs better var generation
//     const variableName = `_${name}`;
//     variables.push({
//       arg: name,
//       variable: variableName,
//     });
//     return {
//       kind: Kind.ARGUMENT,
//       name: {
//         kind: Kind.NAME,
//         value: name,
//       },
//       value: {
//         kind: Kind.VARIABLE,
//         name: {
//           kind: Kind.NAME,
//           value: variableName,
//         },
//       },
//     };
//   });
//
//   return {
//     selection: {
//       kind: Kind.FIELD,
//       alias: null,
//       arguments: [...filteredExistingArguments, ...missingArguments],
//       selectionSet: selection.selectionSet,
//       name: {
//         kind: Kind.NAME,
//         value: rootFieldName,
//       },
//     },
//     variables,
//   };
// }

//
// function filterSelectionSet(
//   schema: GraphQLSchema,
//   type: GraphQLType,
//   validFragments: Array<String>,
//   selectionSet: SelectionSetNode,
// ): {
//   selectionSet: SelectionSetNode;
//   usedFragments: Array<string>;
//   usedVariables: Array<string>;
// } {
//   const usedFragments: Array<string> = [];
//   const usedVariables: Array<string> = [];
//   const typeStack: Array<GraphQLType> = [type];
//   const filteredSelectionSet = visit(selectionSet, {
//     [Kind.FIELD]: {
//       enter(node: FieldNode): null | undefined | FieldNode {
//         let parentType: GraphQLNamedType = resolveType(
//           typeStack[typeStack.length - 1],
//         );
//         if (
//           parentType instanceof GraphQLObjectType ||
//           parentType instanceof GraphQLInterfaceType
//         ) {
//           const fields = parentType.getFields();
//           const field =
//             node.name.value === '__typename'
//               ? TypeNameMetaFieldDef
//               : fields[node.name.value];
//           if (!field) {
//             return null;
//           } else {
//             typeStack.push(field.type);
//           }
//         } else if (
//           parentType instanceof GraphQLUnionType &&
//           node.name.value === '__typename'
//         ) {
//           typeStack.push(TypeNameMetaFieldDef.type);
//         }
//       },
//       leave() {
//         typeStack.pop();
//       },
//     },
//     [Kind.SELECTION_SET](
//       node: SelectionSetNode,
//     ): SelectionSetNode | null | undefined {
//       const parentType: GraphQLType = resolveType(
//         typeStack[typeStack.length - 1],
//       );
//       const parentTypeName = parentType.name;
//       let selections = node.selections;
//       if (
//         (parentType instanceof GraphQLInterfaceType ||
//           parentType instanceof GraphQLUnionType) &&
//         !selections.find(
//           _ =>
//             (_ as FieldNode).kind === Kind.FIELD &&
//             (_ as FieldNode).name.value === '__typename',
//         )
//       ) {
//         selections = selections.concat({
//           kind: Kind.FIELD,
//           name: {
//             kind: Kind.NAME,
//             value: '__typename',
//           },
//         });
//       }
//
//       if (fragmentReplacements[parentTypeName]) {
//         selections.forEach(selection => {
//           if (selection.kind === Kind.FIELD) {
//             const name = selection.name.value;
//             const fragment = fragmentReplacements[parentTypeName][name];
//             if (fragment) {
//               selections = selections.concat(fragment);
//             }
//           }
//         });
//       }
//
//       if (selections !== node.selections) {
//         return {
//           ...node,
//           selections,
//         };
//       }
//     },
//     [Kind.FRAGMENT_SPREAD](node: FragmentSpreadNode): null | undefined {
//       const fragmentFiltered = validFragments.filter(
//         frg => frg.name.value === node.name.value,
//       );
//       const fragment = fragmentFiltered[0];
//       if (fragment) {
//         if (fragment.typeCondition) {
//           const innerType = schema.getType(fragment.typeCondition.name.value);
//           const parentType: GraphQLNamedType = resolveType(
//             typeStack[typeStack.length - 1],
//           );
//           if (!implementsAbstractType(parentType, innerType)) {
//             return null;
//           }
//         }
//         usedFragments.push(node.name.value);
//         return;
//       } else {
//         return null;
//       }
//     },
//     [Kind.INLINE_FRAGMENT]: {
//       enter(node: InlineFragmentNode): null | undefined {
//         if (node.typeCondition) {
//           const innerType = schema.getType(node.typeCondition.name.value);
//           const parentType: GraphQLNamedType = resolveType(
//             typeStack[typeStack.length - 1],
//           );
//           if (implementsAbstractType(parentType, innerType)) {
//             typeStack.push(innerType);
//           } else {
//             return null;
//           }
//         }
//       },
//       leave(node: InlineFragmentNode): null | undefined {
//         if (node.typeCondition) {
//           const innerType = schema.getType(node.typeCondition.name.value);
//           if (innerType) {
//             typeStack.pop();
//           } else {
//             return null;
//           }
//         }
//       },
//     },
//     [Kind.VARIABLE](node: VariableNode) {
//       usedVariables.push(node.name.value);
//     },
//   });
//
//   return {
//     selectionSet: filteredSelectionSet,
//     usedFragments,
//     usedVariables,
//   };
// }
