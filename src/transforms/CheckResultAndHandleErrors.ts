import { GraphQLResolveInfo } from 'graphql';
import { checkResultAndHandleErrors } from '../stitching/errors';
import { Transform } from './index';

export default function CheckResultAndHandleErrors(
  info: GraphQLResolveInfo,
): Transform {
  return {
    transformResult(result: any): any {
      return checkResultAndHandleErrors(result, info);
    },
  };
}
