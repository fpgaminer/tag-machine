// automatically generated by the FlatBuffers compiler, do not modify

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { HashResponse } from '../tag-storm-db-types/hash-response.js';
import { IDResponse } from '../tag-storm-db-types/idresponse.js';
import { ImageResponse } from '../tag-storm-db-types/image-response.js';


export enum ResponseType {
  NONE = 0,
  IDResponse = 1,
  HashResponse = 2,
  ImageResponse = 3
}

export function unionToResponseType(
  type: ResponseType,
  accessor: (obj:HashResponse|IDResponse|ImageResponse) => HashResponse|IDResponse|ImageResponse|null
): HashResponse|IDResponse|ImageResponse|null {
  switch(ResponseType[type]) {
    case 'NONE': return null; 
    case 'IDResponse': return accessor(new IDResponse())! as IDResponse;
    case 'HashResponse': return accessor(new HashResponse())! as HashResponse;
    case 'ImageResponse': return accessor(new ImageResponse())! as ImageResponse;
    default: return null;
  }
}

export function unionListToResponseType(
  type: ResponseType, 
  accessor: (index: number, obj:HashResponse|IDResponse|ImageResponse) => HashResponse|IDResponse|ImageResponse|null, 
  index: number
): HashResponse|IDResponse|ImageResponse|null {
  switch(ResponseType[type]) {
    case 'NONE': return null; 
    case 'IDResponse': return accessor(index, new IDResponse())! as IDResponse;
    case 'HashResponse': return accessor(index, new HashResponse())! as HashResponse;
    case 'ImageResponse': return accessor(index, new ImageResponse())! as ImageResponse;
    default: return null;
  }
}
