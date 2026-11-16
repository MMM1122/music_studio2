/** Deliberately small, bounded arithmetic language. No JavaScript evaluation or
 * property access; each token must belong to this allowlist. */
export class ExpressionError extends Error {}
type Node = (x: number) => number;
const functions: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
};
export function compileExpression(expression: string): Node {
  if (!expression.trim() || expression.length > 256)
    throw new ExpressionError("Enter an expression of 1–256 characters.");
  const tokens: string[] = [];
  const regex =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?|([a-zA-Z]+)|([+*/^()\-]))/y;
  let at = 0;
  while (at < expression.length) {
    if (!expression.slice(at).trim()) break;
    regex.lastIndex = at;
    const match = regex.exec(expression);
    if (!match)
      throw new ExpressionError(
        `Unsupported symbol near “${expression.slice(at, at + 12)}”.`,
      );
    tokens.push(
      match[1]
        ? match[1] + (match[2] ? "e" + match[2] : "")
        : match[3] || match[4],
    );
    at = regex.lastIndex;
    if (tokens.length > 128)
      throw new ExpressionError("Expression is too complex.");
  }
  let i = 0,
    depth = 0;
  function atom(): Node {
    if (++depth > 24)
      throw new ExpressionError("Use fewer nested parentheses.");
    const token = tokens[i++];
    let node: Node;
    if (token === "(") {
      node = sum();
      if (tokens[i++] !== ")")
        throw new ExpressionError("Missing closing parenthesis.");
    } else if (token === "x") node = (x) => x;
    else if (token === "pi") node = () => Math.PI;
    else if (token === "e") node = () => Math.E;
    else if (token && Object.hasOwn(functions, token)) {
      if (tokens[i++] !== "(") throw new ExpressionError(`Use ${token}(x).`);
      const arg = sum();
      if (tokens[i++] !== ")")
        throw new ExpressionError("Missing closing parenthesis.");
      node = (x) => functions[token](arg(x));
    } else if (token && /^\d|^\./.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value))
        throw new ExpressionError("Number is too large.");
      node = () => value;
    } else
      throw new ExpressionError(
        `Expected a number, x, or supported function; found ${token ?? "end"}.`,
      );
    depth--;
    return node;
  }
  function power(): Node {
    const a = atom();
    if (tokens[i] === "^") {
      i++;
      const b = unary();
      return (x) => a(x) ** b(x);
    }
    return a;
  }
  function unary(): Node {
    if (tokens[i] === "+" || tokens[i] === "-") {
      const sign = tokens[i++] === "-" ? -1 : 1;
      const a = unary();
      return (x) => sign * a(x);
    }
    return power();
  }
  function product(): Node {
    let a = unary();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++],
        left = a,
        right = unary();
      a = (x) => (op === "*" ? left(x) * right(x) : left(x) / right(x));
    }
    return a;
  }
  function sum(): Node {
    let a = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++],
        left = a,
        right = product();
      a = (x) => (op === "+" ? left(x) + right(x) : left(x) - right(x));
    }
    return a;
  }
  const root = sum();
  if (i !== tokens.length)
    throw new ExpressionError("Unexpected input. Use * for multiplication.");
  return (x) => {
    const value = root(x);
    if (!Number.isFinite(value))
      throw new ExpressionError(
        "The function is undefined in this interval. Try another expression.",
      );
    return Math.max(-1e6, Math.min(1e6, value));
  };
}
