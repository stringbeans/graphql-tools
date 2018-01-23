import { GraphQLSchema, DocumentNode } from 'graphql';

export type Transform = {
  transformSchema?: (schema: GraphQLSchema) => GraphQLSchema;
  transformDocument?: (originalDocument: DocumentNode) => DocumentNode;
  transformResult?: (result: any) => any;
};

export function applySchemaTransforms(
  originalSchema: GraphQLSchema,
  transforms: Array<Transform>,
): GraphQLSchema {
  return transforms.reduce(
    (schema: GraphQLSchema, transform: Transform) =>
      transform.transformSchema ? transform.transformSchema(schema) : schema,
    originalSchema,
  );
}

export function applyDocumentTransforms(
  originalDocument: DocumentNode,
  transforms: Array<Transform>,
): DocumentNode {
  return transforms.reduce(
    (document: DocumentNode, transform: Transform) =>
      transform.transformDocument
        ? transform.transformDocument(document)
        : document,

    originalDocument,
  );
}

export function applyResultTransforms(
  originalResult: any,
  transforms: Array<Transform>,
): any {
  return transforms.reduce(
    (result: any, transform: Transform) =>
      transform.transformResult ? transform.transformResult(result) : result,
    originalResult,
  );
}
