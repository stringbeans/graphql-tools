import { GraphQLSchema, Document } from 'graphql';
import { Operation } from '../Interfaces';

export type Transform = {
  transformSchema?: (schema: GraphQLSchema) => GraphQLSchema;
  transformDocument?: (originalDocument: Document) => Document;
  transformResult?: (result: any) => any;
};

export function applySchemaTransforms(
  originalSchema: GraphQLSchema,
  transforms: Array<Transform>,
): GraphQLSchema {
  return transforms.reduce(
    (schema: GraphQLSchema, transform: Trasform) =>
      transform.transformSchema ? transform.transformSchema(schema) : schema,
    originalSchema,
  );
}

export function applyDocumentTransforms(
  originalDocument: Document,
  transforms: Array<Transform>,
): Document {
  return transforms.reduce(
    (document: Document, transform: Trasform) =>
      transform.transformDocument
        ? transform.transformDocument(document)
        : document,

    originalDocument,
  );
}

export function applyResultTransform(
  originalResult: any,
  transforms: Array<Transform>,
): any {
  return transforms.reduce(
    (result: any, transform: Trasform) =>
      transform.transformResult ? transform.transformResult(result) : result,
    originalResult,
  );
}
