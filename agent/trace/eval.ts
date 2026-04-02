/**
 * Lightweight expression evaluator for the IR's infix expression language.
 *
 * Handles: integer arithmetic, comparisons, boolean logic, `if/then/else`,
 * `m.field` references, and named parameter references.
 */

export type Value = number | boolean | string;
export type Env = Record<string, Value>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluate(expr: string, env: Env): Value {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, env);
  const result = parser.parseExpression();
  if (parser.pos < parser.tokens.length) {
    throw new Error(`Unexpected token "${parser.tokens[parser.pos]!.raw}" at position ${parser.pos}`);
  }
  return result;
}

/**
 * Build an environment from a state (m.field → value) and optional params.
 */
export function buildEnv(
  state: Record<string, Value>,
  params?: Record<string, Value>,
): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(state)) {
    env[`m.${k}`] = v;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      env[k] = v;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
  | "number"
  | "bool"
  | "string"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "if"
  | "then"
  | "else";

type Token = { kind: TokenKind; raw: string; value?: Value };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i]!)) {
      i++;
      continue;
    }

    // String literals
    if (expr[i] === '"') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== '"') j++;
      tokens.push({ kind: "string", raw: expr.slice(i, j + 1), value: expr.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Multi-char operators
    const two = expr.slice(i, i + 3);
    if (two === "==>") {
      tokens.push({ kind: "op", raw: "==>" });
      i += 3;
      continue;
    }

    const pair = expr.slice(i, i + 2);
    if ([">=", "<=", "==", "!=", "&&", "||"].includes(pair)) {
      tokens.push({ kind: "op", raw: pair });
      i += 2;
      continue;
    }

    // Single-char operators and parens
    if ("+-*/><!%".includes(expr[i]!)) {
      tokens.push({ kind: "op", raw: expr[i]! });
      i++;
      continue;
    }

    if (expr[i] === "(") {
      tokens.push({ kind: "lparen", raw: "(" });
      i++;
      continue;
    }
    if (expr[i] === ")") {
      tokens.push({ kind: "rparen", raw: ")" });
      i++;
      continue;
    }

    // Numbers
    if (/\d/.test(expr[i]!)) {
      let j = i;
      while (j < expr.length && /\d/.test(expr[j]!)) j++;
      const raw = expr.slice(i, j);
      tokens.push({ kind: "number", raw, value: parseInt(raw, 10) });
      i = j;
      continue;
    }

    // Identifiers and keywords (including dotted: m.field)
    if (/[A-Za-z_]/.test(expr[i]!)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j]!)) j++;
      const raw = expr.slice(i, j);

      if (raw === "true") {
        tokens.push({ kind: "bool", raw, value: true });
      } else if (raw === "false") {
        tokens.push({ kind: "bool", raw, value: false });
      } else if (raw === "if") {
        tokens.push({ kind: "if", raw });
      } else if (raw === "then") {
        tokens.push({ kind: "then", raw });
      } else if (raw === "else") {
        tokens.push({ kind: "else", raw });
      } else {
        tokens.push({ kind: "ident", raw });
      }
      i = j;
      continue;
    }

    throw new Error(`Unexpected character "${expr[i]}" at position ${i} in expression: ${expr}`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser/evaluator
// ---------------------------------------------------------------------------

class Parser {
  pos = 0;
  constructor(
    public tokens: Token[],
    private env: Env,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(kind: TokenKind, raw?: string): Token {
    const t = this.peek();
    if (!t || t.kind !== kind || (raw !== undefined && t.raw !== raw)) {
      throw new Error(`Expected ${raw ?? kind} but got ${t ? t.raw : "EOF"}`);
    }
    return this.advance();
  }

  // expr → implies
  parseExpression(): Value {
    return this.parseImplies();
  }

  // implies → or ("==>" or)*   (right-associative)
  private parseImplies(): Value {
    let left = this.parseOr();
    while (this.peek()?.raw === "==>") {
      this.advance();
      const right = this.parseOr();
      left = !left || (right as boolean);
    }
    return left;
  }

  // or → and ("||" and)*
  private parseOr(): Value {
    let left = this.parseAnd();
    while (this.peek()?.raw === "||") {
      this.advance();
      const right = this.parseAnd();
      left = (left as boolean) || (right as boolean);
    }
    return left;
  }

  // and → compare ("&&" compare)*
  private parseAnd(): Value {
    let left = this.parseCompare();
    while (this.peek()?.raw === "&&") {
      this.advance();
      const right = this.parseCompare();
      left = (left as boolean) && (right as boolean);
    }
    return left;
  }

  // compare → add ((">="|"<="|">"|"<"|"=="|"!=") add)?
  private parseCompare(): Value {
    let left = this.parseAdd();
    const op = this.peek()?.raw;
    if (op && [">=", "<=", ">", "<", "==", "!="].includes(op)) {
      this.advance();
      const right = this.parseAdd();
      switch (op) {
        case ">=": return (left as number) >= (right as number);
        case "<=": return (left as number) <= (right as number);
        case ">": return (left as number) > (right as number);
        case "<": return (left as number) < (right as number);
        case "==": return left === right;
        case "!=": return left !== right;
      }
    }
    return left;
  }

  // add → mul (("+"|"-") mul)*
  private parseAdd(): Value {
    let left = this.parseMul() as number;
    while (this.peek()?.raw === "+" || this.peek()?.raw === "-") {
      const op = this.advance().raw;
      const right = this.parseMul() as number;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  // mul → unary (("*"|"/"|"%") unary)*
  private parseMul(): Value {
    let left = this.parseUnary() as number;
    while (this.peek()?.raw === "*" || this.peek()?.raw === "/" || this.peek()?.raw === "%") {
      const op = this.advance().raw;
      const right = this.parseUnary() as number;
      if (op === "*") left = left * right;
      else if (op === "/") left = Math.trunc(left / right);
      else left = left % right;
    }
    return left;
  }

  // unary → ("!"|"-") unary | primary
  private parseUnary(): Value {
    if (this.peek()?.raw === "!") {
      this.advance();
      return !this.parseUnary();
    }
    if (this.peek()?.raw === "-" && this.peek()?.kind === "op") {
      // Distinguish unary minus from binary: unary if next is number/ident/lparen
      const next = this.tokens[this.pos + 1];
      if (next && (next.kind === "number" || next.kind === "ident" || next.kind === "lparen")) {
        this.advance();
        return -(this.parseUnary() as number);
      }
    }
    return this.parsePrimary();
  }

  // primary → NUMBER | BOOL | STRING | IDENT | "(" expr ")" | "if" expr "then" expr "else" expr
  private parsePrimary(): Value {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of expression");

    if (t.kind === "number" || t.kind === "bool" || t.kind === "string") {
      this.advance();
      return t.value!;
    }

    if (t.kind === "ident") {
      this.advance();
      if (!(t.raw in this.env)) {
        throw new Error(`Unknown identifier "${t.raw}"`);
      }
      return this.env[t.raw]!;
    }

    if (t.kind === "lparen") {
      this.advance();
      const val = this.parseExpression();
      this.expect("rparen");
      return val;
    }

    if (t.kind === "if") {
      this.advance();
      const cond = this.parseExpression();
      this.expect("then");
      const thenVal = this.parseExpression();
      this.expect("else");
      const elseVal = this.parseExpression();
      return cond ? thenVal : elseVal;
    }

    throw new Error(`Unexpected token "${t.raw}"`);
  }
}
