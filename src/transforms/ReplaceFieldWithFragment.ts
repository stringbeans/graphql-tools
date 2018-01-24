export default function ReplaceFieldWithFragment(
  mapping: FieldToFragmentMapping,
): Transform {
  return {
    transformRequest(originalRequest: Request): Request {
      const document = replaceFieldsWithFragments(
        originalRequest.document,
        mapping,
      );
      return {
        ...originalRequest,
        document,
      };
    },
  };
}

function replaceFieldsWithFragments(
  document: DocumentNode,
  mapping: FieldToFragmentMapping,
): DocumentNode {
  const typeStack: Array<GraphQLType> = [type];
  return visit(document, {
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
    [Kind.SELECTION_SET](
      node: SelectionSetNode,
    ): SelectionSetNode | null | undefined {
      const parentType: GraphQLType = resolveType(
        typeStack[typeStack.length - 1],
      );
      const parentTypeName = parentType.name;

      if (fragmentReplacements[parentTypeName]) {
        selections.forEach(selection => {
          if (selection.kind === Kind.FIELD) {
            const name = selection.name.value;
            const fragment = fragmentReplacements[parentTypeName][name];
            if (fragment) {
              selections = selections.concat(fragment);
            }
          }
        });
      }

      if (selections !== node.selections) {
        return {
          ...node,
          selections,
        };
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

            typeStack.pop();
        }
      },
    },
  });
}
