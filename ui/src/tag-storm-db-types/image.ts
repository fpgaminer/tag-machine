// automatically generated by the FlatBuffers compiler, do not modify

import * as flatbuffers from "flatbuffers";

import { AttributeWithBlame } from "../tag-storm-db-types/attribute-with-blame.js";
import { Hash } from "../tag-storm-db-types/hash.js";
import { TagWithBlame } from "../tag-storm-db-types/tag-with-blame.js";

export class Image {
	bb: flatbuffers.ByteBuffer | null = null;
	bb_pos = 0;
	__init(i: number, bb: flatbuffers.ByteBuffer): Image {
		this.bb_pos = i;
		this.bb = bb;
		return this;
	}

	static getRootAsImage(bb: flatbuffers.ByteBuffer, obj?: Image): Image {
		return (obj || new Image()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
	}

	static getSizePrefixedRootAsImage(bb: flatbuffers.ByteBuffer, obj?: Image): Image {
		bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
		return (obj || new Image()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
	}

	id(): number {
		const offset = this.bb!.__offset(this.bb_pos, 4);
		return offset ? this.bb!.readUint32(this.bb_pos + offset) : 0;
	}

	hash(obj?: Hash): Hash | null {
		const offset = this.bb!.__offset(this.bb_pos, 6);
		return offset ? (obj || new Hash()).__init(this.bb_pos + offset, this.bb!) : null;
	}

	tags(index: number, obj?: TagWithBlame): TagWithBlame | null {
		const offset = this.bb!.__offset(this.bb_pos, 8);
		return offset
			? (obj || new TagWithBlame()).__init(
					this.bb!.__indirect(this.bb!.__vector(this.bb_pos + offset) + index * 4),
					this.bb!,
				)
			: null;
	}

	tagsLength(): number {
		const offset = this.bb!.__offset(this.bb_pos, 8);
		return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
	}

	attributes(index: number, obj?: AttributeWithBlame): AttributeWithBlame | null {
		const offset = this.bb!.__offset(this.bb_pos, 10);
		return offset
			? (obj || new AttributeWithBlame()).__init(
					this.bb!.__indirect(this.bb!.__vector(this.bb_pos + offset) + index * 4),
					this.bb!,
				)
			: null;
	}

	attributesLength(): number {
		const offset = this.bb!.__offset(this.bb_pos, 10);
		return offset ? this.bb!.__vector_len(this.bb_pos + offset) : 0;
	}

	static startImage(builder: flatbuffers.Builder) {
		builder.startObject(4);
	}

	static addId(builder: flatbuffers.Builder, id: number) {
		builder.addFieldInt32(0, id, 0);
	}

	static addHash(builder: flatbuffers.Builder, hashOffset: flatbuffers.Offset) {
		builder.addFieldStruct(1, hashOffset, 0);
	}

	static addTags(builder: flatbuffers.Builder, tagsOffset: flatbuffers.Offset) {
		builder.addFieldOffset(2, tagsOffset, 0);
	}
}
