import {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  GraphQLResolveInfo,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  SelectionNode,
  subscribe,
  graphql,
  print,
  VariableDefinitionNode,
} from 'graphql';
import { Operation, Request } from '../Interfaces';
import {
  Transform,
  applyRequestTransforms,
  applyResultTransforms,
} from '../transforms';
import AddArgumentsAsVariables from '../transforms/AddArgumentsAsVariables';
import FilterToSchema from '../transforms/FilterToSchema';
import CheckResultAndHandleErrors from '../transforms/CheckResultAndHandleErrors';

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

  const rawRequest: Request = {
    document: rawDocument,
    variables: info.variableValues as Record<string, any>,
  };

  transforms = [
    ...transforms,
    AddArgumentsAsVariables(targetSchema, args),
    FilterToSchema(targetSchema),
    CheckResultAndHandleErrors(info),
  ];

  const processedRequest = applyRequestTransforms(rawRequest, transforms);

  console.log(print(processedRequest.document), processedRequest.variables);

  if (targetOperation === 'query' || targetOperation === 'mutation') {
    const rawResult = await graphql(
      targetSchema,
      print(processedRequest.document),
      info.rootValue,
      context,
      processedRequest.variables,
    );

    const result = applyResultTransforms(rawResult, transforms);
    return result;
  }

  if (targetOperation === 'subscription') {
    // apply result processing ???
    return subscribe(
      targetSchema,
      processedRequest.document,
      info.rootValue,
      context,
      processedRequest.variables,
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
