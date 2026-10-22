function isBooleanExpression(node) {
  return node.type === "LogicalExpression" && node.operator !== "??";
}

function clauseCount(node) {
  if (node.type === "UnaryExpression" && node.operator === "!") return clauseCount(node.argument);
  if (!isBooleanExpression(node)) return 1;
  return clauseCount(node.left) + clauseCount(node.right);
}

function hasBooleanParent(node) {
  let parent = node.parent;
  while (parent.type === "UnaryExpression" && parent.operator === "!") parent = parent.parent;
  return isBooleanExpression(parent);
}

/** Keep individual conditions small; parenthesizing a chain does not simplify it. */
const maxBooleanClauses = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      tooMany: "This boolean expression has {{count}} clauses. Maximum allowed is 3; separate the domain rules.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (!isBooleanExpression(node) || hasBooleanParent(node)) return;
        const count = clauseCount(node);
        if (count > 3) context.report({ node, messageId: "tooMany", data: { count } });
      },
    };
  },
};

export default maxBooleanClauses;
