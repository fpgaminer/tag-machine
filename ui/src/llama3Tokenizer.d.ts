// llama3Tokenizer.d.ts
export default llama3Tokenizer;
export class Llama3Tokenizer {
    constructor(vocab_base64: any, merges_binary: any, special_tokens: any);
    vocabById: string[];
    vocabByString: Map<any, any>;
    merges: Map<any, any>;
    utf8Encoder: TextEncoder;
    utf8Decoder: TextDecoder;
    getSpecialTokenId(specialTokenString: any): any;
    getMergeIdentifierString(firstTokenId: any, secondTokenId: any): string;
    decompressMerges(merges_binary: any): Map<any, any>;
    /**
     * Helper function to decode the vocabulary (returns an array that contains Strings representing tokens).
     *
     * vocab_base64 is base64-encoded string of tokens delimited by '\n' (line break) in utf-8.
     * The row number of the token (indexing from 0) represents the id of the token in LLaMA 3 tokenizer.
     * That row number does not have any particular significance in the tokenizer logic, but we use
     * it to aid with the compression of the merge data, so it has significance to us in that way.
     */
    decodeVocabulary(vocab_base64: any): string[];
    encode(prompt: any, options: any): any[];
    decode(tokenIds: any): string;
    optimisticCount(prompt: any): number;
    defaultTests(tokenizer: any): boolean;
    runTests(tests?: (tokenizer: any) => boolean): void;
}
declare const llama3Tokenizer: Llama3Tokenizer;
