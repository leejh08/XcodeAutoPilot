// ============================================================
// XcodeAutoPilot — Swift Error Classifier
// Parses Swift compiler error messages to extract relevant symbols
// for targeted context lookup (grep / sourcekit-lsp).
// ============================================================

export type ErrorClass =
  | { kind: "missing_member"; symbol: string }   // "has no member 'X'" → look up type X
  | { kind: "unresolved";     symbol: string }   // "unresolved identifier 'X'" → look up X
  | { kind: "type_mismatch";  symbol: string | null } // "cannot convert..." → look up call site
  | { kind: "missing_label";  symbol: string }   // "missing argument label 'foo:'" → look up func
  | { kind: "unknown" };

/**
 * Classify a Swift compiler error message and extract the most useful
 * symbol name for follow-up context lookups.
 */
export function classifyError(message: string): ErrorClass {
  let m: RegExpMatchArray | null;

  // "value of type 'MyModel' has no member 'foo'"
  // → need to see definition of MyModel
  m = message.match(/value of type '([^']+)' has no member/);
  if (m) return { kind: "missing_member", symbol: stripGenerics(m[1]) };

  // "use of unresolved identifier 'fetchUser'"
  m = message.match(/use of unresolved identifier '([^']+)'/);
  if (m) return { kind: "unresolved", symbol: m[1] };

  // "cannot find type 'UserModel' in scope"
  m = message.match(/cannot find type '([^']+)' in scope/);
  if (m) return { kind: "unresolved", symbol: m[1] };

  // "cannot find 'fetchUser' in scope"
  m = message.match(/cannot find '([^']+)' in scope/);
  if (m) return { kind: "unresolved", symbol: m[1] };

  // "referencing instance method 'foo(bar:)' requires..."
  m = message.match(/referencing (?:instance|static|class) method '([^'(]+)/);
  if (m) return { kind: "unresolved", symbol: m[1] };

  // "missing argument label 'completion:' in call"
  m = message.match(/missing argument label '([^':]+)/);
  if (m) return { kind: "missing_label", symbol: m[1] };

  // "extra argument 'callback' in call"
  m = message.match(/extra argument '([^']+)' in call/);
  if (m) return { kind: "missing_label", symbol: m[1] };

  // "cannot convert value of type 'String' to expected argument type 'Int'"
  // Symbol is unclear from message alone — return null so callers skip lookup
  if (message.includes("cannot convert value of type") ||
      message.includes("cannot convert return expression")) {
    return { kind: "type_mismatch", symbol: null };
  }

  return { kind: "unknown" };
}

/** Strip generic parameters from type names, e.g. "Array<String>" → "Array" */
function stripGenerics(typeName: string): string {
  return typeName.replace(/<.*>$/, "").trim();
}
