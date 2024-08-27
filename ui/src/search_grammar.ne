@preprocessor typescript

@{%
import { tagListState } from "./state/TagList";
import moo from "moo";

const lexer = moo.compile({
	ws: /[ \t]+/,
	tag: /tag:/,
	equal: /=/,
	and: /and/,
	or: /or/,
	not: /not/,
	lparen: /\(/,
	rparen: /\)/,
    sort: /sort:/,
    id: /id/,
    hash: /hash/,
    null_token: /NULL/,
    quoted_string: /"(?:\\["\\]|[^\n"\\])*"/,
	word: /[^\s=()]+/,
});
%}

@lexer lexer

main -> %ws:? expr %ws:? sort:?            {% d => ({ expr: d[1], sort: d[3] }) %}

paren -> %lparen %ws:? expr %ws:? %rparen  {% d => d[2] %}
       | %tag %word                        {%
    function(d, location, reject) {
        const tag = tagListState.getTagByName(d[1].value);
        if (tag === null) {
            return reject;
        }

        return { kind: "tag", value: tag.id };
    }
    %}
       | %word %equal %quoted_string       {% d => ({ kind: "attribute", value: [d[0].value, d[2].value.slice(1, -1)] }) %}
       | %word %equal %word                {% d => ({ kind: "attribute", value: [d[0].value, d[2].value] }) %}
       | %word %equal %null_token          {% d => ({ kind: "attribute", value: [d[0].value, null] }) %}
       | %id %equal %word                  {% d => ({ kind: "attribute", value: ["id", d[2].value] }) %}
       | %hash %equal %word                {% d => ({ kind: "attribute", value: ["hash", d[2].value] }) %}

not -> %not %ws:? paren                    {% d => ({ kind: "not", value: d[2] }) %}
     | paren                               {% d => d[0] %}

term -> term %ws:? %and %ws:? not          {% d => ({ kind: "and", value: [d[0], d[4]] }) %}
      | not                                {% d => d[0] %}

expr -> expr %ws:? %or %ws:? term          {% d => ({ kind: "or", value: [d[0], d[4]] }) %}
      | term                               {% d => d[0] %}

sort -> %sort %id                          {% d => "id" %}
      | %sort %hash                        {% d => "hash" %}