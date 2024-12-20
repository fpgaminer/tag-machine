// automatically generated by the FlatBuffers compiler, do not modify
import * as flatbuffers from "flatbuffers";

import { Hash } from "../tag-storm-db-types/hash.js";

export class HashResponse {
	bb: flatbuffers.ByteBuffer | null = null;
	bb_pos = 0;
	__init(i: number, bb: flatbuffers.ByteBuffer): HashResponse {
		this.bb_pos = i;
		this.bb = bb;
		return this;
	}

	static getRootAsHashResponse(bb: flatbuffers.ByteBuffer, obj?: HashResponse): HashResponse {
		return (obj || new HashResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
	}

	static getSizePrefixedRootAsHashResponse(bb: flatbuffers.ByteBuffer, obj?: HashResponse): HashResponse {
		bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
		return (obj || new HashResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
	}

	hashes(index: number, obj?: Hash): Hash | null {
		const offset = this.bb!.__offset(this.bb_pos, 4);
		return offset ? (obj || new Hash()).__init(this.bb!.__vector(this.bb_pos + offset) + index * 32, this.bb!) : null;
	}

	hashesLength(): number {
		const offset = this.bb!.__offset(this.bb_pos, 4);
		return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
	}

	static startHashResponse(builder: flatbuffers.Builder) {
		builder.startObject(1);
	}

	static addHashes(builder: flatbuffers.Builder, hashesOffset: flatbuffers.Offset) {
		builder.addFieldOffset(0, hashesOffset, 0);
	}

	static startHashesVector(builder: flatbuffers.Builder, numElems: number) {
		builder.startVector(32, numElems, 1);
	}

	static endHashResponse(builder: flatbuffers.Builder): flatbuffers.Offset {
		const offset = builder.endObject();
		return offset;
	}

	static createHashResponse(builder: flatbuffers.Builder, hashesOffset: flatbuffers.Offset): flatbuffers.Offset {
		HashResponse.startHashResponse(builder);
		HashResponse.addHashes(builder, hashesOffset);
		return HashResponse.endHashResponse(builder);
	}
}
