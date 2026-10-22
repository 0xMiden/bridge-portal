import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import maxBooleanClauses from "../../../scripts/eslint/max-boolean-clauses.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester().run("bridge/max-boolean-clauses", maxBooleanClauses as Rule.RuleModule, {
  valid: [
    "if (signed && funded && ready) send();",
    "if ((signed && funded) || sponsored) send();",
    "if (!(signed || funded) && ready) send();",
    "const network = selected ?? saved ?? preferred ?? fallback;",
  ],
  invalid: [
    {
      code: "if (signed && funded && ready && connected) send();",
      errors: [{ messageId: "tooMany", data: { count: 4 } }],
    },
    {
      code: "if ((signed && funded) || (sponsored && connected)) send();",
      errors: [{ messageId: "tooMany", data: { count: 4 } }],
    },
    {
      code: "if (!(signed || funded || ready || connected)) stop();",
      errors: [{ messageId: "tooMany", data: { count: 4 } }],
    },
    {
      code: "if (!(signed || funded) || ready || connected) send();",
      errors: [{ messageId: "tooMany", data: { count: 4 } }],
    },
  ],
});
