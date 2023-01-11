// options
// @see https://github.com/googleapis/googleapis/blob/master/google/api/http.proto
export interface Http {
  rules: HttpRule[];
}

export type HttpRule = {
  get?: string;
  put?: string;
  post?: string;
  delete?: string;
  patch?: string;

  body?: string;
  response_body?: string;
  additional_bindings?: HttpRule[];
};

export function getHttpRule(opts: Record<string, unknown>): HttpRule {
  const opt = opts["google.api.http"] || {};
  return opt;
}

export function isHttpRuleGet<T extends HttpRule>(
  rule: T
): rule is T & {get: string} {
  if (rule.get && rule.get.length > 0) {
    return true;
  }
  return false;
}

export function isHttpRulePost<T extends HttpRule>(
  rule: T
): rule is T & {post: string} {
  if (rule.post && rule.post.length > 0) {
    return true;
  }
  return false;
}

export function parseHttpRule(rule: HttpRule): {
  post: string;
} {
  if (!isHttpRulePost(rule)) {
    throw new Error(`we only support post, but got: ${JSON.stringify(rule)}`);
  }

  if (rule.body && rule.body != "*") {
    throw new Error(
      `we only support body='*', but got: ${JSON.stringify(rule)}`
    );
  }

  return rule;
}
