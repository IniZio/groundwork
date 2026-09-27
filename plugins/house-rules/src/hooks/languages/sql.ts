export function isSqlCommentNodeType(type: string): boolean { return type.includes("comment") || type === "marginalia"; }
