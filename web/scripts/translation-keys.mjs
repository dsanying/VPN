// SPDX-License-Identifier: MIT
/** Known literal branches stay auditable, including conditional action labels. */
export function literalTranslationKeys(ts,node) {
 if(ts.isStringLiteralLike(node))return [node.text];
 if(ts.isConditionalExpression(node))return [...literalTranslationKeys(ts,node.whenTrue),...literalTranslationKeys(ts,node.whenFalse)];
 if(ts.isParenthesizedExpression(node))return literalTranslationKeys(ts,node.expression);
 return [];
}
