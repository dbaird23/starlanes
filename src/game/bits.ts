/**
 * EV Nova control bit (ncb) expressions.
 *
 * Test expressions: `b13 & !(b25 | b31)` — operators ! & | ( ), terms b<n>.
 * Set expressions: space-separated ops — `b511` set, `!b511` clear, `^b511`
 * toggle, plus side-effect ops we forward to the game: S<id> start mission,
 * A<id> abort mission, G<id> grant outfit, D<id> remove outfit. Unknown ops
 * are ignored (the full engine has many more).
 */

export type Bits = Record<string, boolean>;

/**
 * Extra state test expressions can ask about beyond control bits:
 * Oxxx (owns an outfit), Exxx (has explored a system), G (gender),
 * Pxxx (game registered — always true here, we're not shareware).
 */
export interface TestContext {
  outfits?: Record<string, number>;
  explored?: string[];
  male?: boolean;
}

export interface SetOpHandlers {
  startMission?: (misnId: number) => void;
  abortMission?: (misnId: number) => void;
  failMission?: (misnId: number) => void;
  grantOutfit?: (outfId: number) => void;
  removeOutfit?: (outfId: number) => void;
  /** move the player: keepPos=false puts them at the first stellar */
  moveToSystem?: (systemId: number, keepPos: boolean) => void;
  /** swap the player's ship; see Cxxx/Exxx/Hxxx in the Nova Bible */
  changeShip?: (shipId: number, keepOutfits: boolean, grantDefaults: boolean) => void;
  playSound?: (sndId: number) => void;
  activateRank?: (rankId: number) => void;
  deactivateRank?: (rankId: number) => void;
  /** Qxxx/Txxx: show a dësc resource to the player */
  showDesc?: (descId: number) => void;
  /** Yxxx: wipe a stellar object off the map */
  destroyStellar?: (spobId: number) => void;
}

/** Evaluate a control bit test expression. Empty expressions are true. */
export function evalTest(expr: string, bits: Bits, ctx: TestContext = {}): boolean {
  const src = expr.trim();
  if (!src) return true;
  let pos = 0;

  const readNumber = (): string => {
    let num = "";
    while (pos < src.length && src[pos] >= "0" && src[pos] <= "9") num += src[pos++];
    return num;
  };

  const skipWs = () => {
    while (pos < src.length && src[pos] === " ") pos++;
  };

  // grammar: orExpr := andExpr ('|' andExpr)* ; andExpr := unary (('&'|adjacent) unary)*
  const parseOr = (): boolean => {
    let v = parseAnd();
    for (;;) {
      skipWs();
      if (src[pos] === "|") {
        pos++;
        const rhs = parseAnd();
        v = v || rhs;
      } else break;
    }
    return v;
  };

  const parseAnd = (): boolean => {
    let v = parseUnary();
    for (;;) {
      skipWs();
      if (src[pos] === "&") {
        pos++;
        const rhs = parseUnary();
        v = v && rhs;
      } else if (src[pos] === "!" || src[pos] === "(" || src[pos] === "b" || src[pos] === "B") {
        // Nova allows implicit AND: "b13 !b25"
        const rhs = parseUnary();
        v = v && rhs;
      } else break;
    }
    return v;
  };

  const parseUnary = (): boolean => {
    skipWs();
    if (src[pos] === "!") {
      pos++;
      return !parseUnary();
    }
    if (src[pos] === "(") {
      pos++;
      const v = parseOr();
      skipWs();
      if (src[pos] === ")") pos++;
      return v;
    }
    const ch = src[pos];
    if (ch === "b" || ch === "B") {
      pos++;
      return bits[readNumber()] === true;
    }
    if (ch === "p" || ch === "P") {
      // "is the game paid for" — this engine is always registered
      pos++;
      readNumber();
      return true;
    }
    if (ch === "o" || ch === "O") {
      pos++;
      const id = readNumber();
      return (ctx.outfits?.[id] ?? 0) > 0;
    }
    if (ch === "e" || ch === "E") {
      pos++;
      const id = readNumber();
      return ctx.explored?.includes(id) ?? false;
    }
    if (ch === "g" || ch === "G") {
      pos++;
      return ctx.male !== false;
    }
    // unparseable token: skip a char to avoid an infinite loop, treat as true
    pos++;
    return true;
  };

  try {
    return parseOr();
  } catch {
    return false;
  }
}

/**
 * Split a set expression into tokens, resolving Nova's `R(<op> <op>)` random
 * choice by picking one branch. Nested R() is not used by the game data.
 */
function tokenizeSet(expr: string): string[] {
  const out: string[] = [];
  const re = /R\(([^)]*)\)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m[1] !== undefined) {
      const choices = m[1].trim().split(/\s+/).filter(Boolean);
      if (choices.length > 0) out.push(choices[Math.floor(Math.random() * choices.length)]);
    } else if (m[2] !== undefined) {
      out.push(m[2]);
    }
  }
  return out;
}

/** Apply a control bit set expression, mutating bits and firing op handlers. */
export function applySet(expr: string, bits: Bits, handlers: SetOpHandlers = {}): void {
  const tokens = tokenizeSet(expr);
  for (const token of tokens) {
    const m = /^(!|\^)?([bB])(\d+)$/.exec(token);
    if (m) {
      const num = m[3];
      if (m[1] === "!") delete bits[num];
      else if (m[1] === "^") {
        if (bits[num]) delete bits[num];
        else bits[num] = true;
      } else bits[num] = true;
      continue;
    }
    const op = /^([SAFGDMNCEHPKLQTY])(\d+)$/.exec(token);
    if (op) {
      const id = parseInt(op[2], 10);
      switch (op[1]) {
        case "S": handlers.startMission?.(id); break;
        case "A": handlers.abortMission?.(id); break;
        case "F": handlers.failMission?.(id); break;
        case "G": handlers.grantOutfit?.(id); break;
        case "D": handlers.removeOutfit?.(id); break;
        case "M": handlers.moveToSystem?.(id, false); break;
        case "N": handlers.moveToSystem?.(id, true); break;
        // C keeps outfits and grants nothing; E keeps and grants; H replaces
        case "C": handlers.changeShip?.(id, true, false); break;
        case "E": handlers.changeShip?.(id, true, true); break;
        case "H": handlers.changeShip?.(id, false, true); break;
        case "P": handlers.playSound?.(id); break;
        case "K": handlers.activateRank?.(id); break;
        case "L": handlers.deactivateRank?.(id); break;
        // Q and T both pop a dësc up at the player. Every operand the stock
        // scenario uses (25040-25076) names a dësc these data files don't
        // carry, so in practice this is a no-op until a plug-in supplies them.
        case "Q": case "T": handlers.showDesc?.(id); break;
        case "Y": handlers.destroyStellar?.(id); break;
      }
    }
    // X<spob> is left alone: it appears only in the tutorial missions, and its
    // operands (Earth, Alt, Fermia...) don't line up with those missions'
    // destinations, so its meaning can't be pinned down from the data alone.
  }
}
