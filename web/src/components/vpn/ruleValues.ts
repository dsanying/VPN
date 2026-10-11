/** Newlines delimit values; commas, spaces and regex syntax remain part of each value. */
export const splitRuleValues = (text: string) => text.split('\n').map(value => value.trim()).filter(Boolean);
