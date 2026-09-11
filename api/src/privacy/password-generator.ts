/**
 * Readable passphrase generator for the "suggest a password" feature
 * (`GET /profile/suggest-password`). An applicant can use the suggestion
 * as-is or type their own (min. 8 chars, enforced in profile.validator.ts).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE WORDLIST LIVES IN SOURCE CONTROL, NOT A DATABASE OR ENV VAR
 * ──────────────────────────────────────────────────────────────────────────
 *
 * The instinct "this code is public, so hackers can enumerate the list" is
 * reasonable to *raise*, but it doesn't hold up — and hiding the list would
 * make the system worse, not better. Two separate arguments:
 *
 * 1. Kerckhoffs's Principle (1883, cryptography's oldest design rule):
 *    "A cryptosystem should be secure even if everything about the system,
 *    except the key, is public knowledge." Applied here: the *wordlist* is
 *    the algorithm. The *random choice* of words is the key. Security must
 *    rest entirely on the unpredictability of the random draw (see §3
 *    below), never on the attacker not knowing which words exist. A scheme
 *    that breaks the moment its source code leaks was never secure — it was
 *    just unaudited. This is precisely why AES, RSA, and every other
 *    standard cipher publish their full specification: hiding a *design*
 *    is brittle (one leak, one disgruntled employee, one decompiled binary,
 *    and the "secret" is gone forever, with no way to detect the leak or
 *    rotate the secret); a design that's secure *despite* being public is
 *    robust by construction.
 *
 * 2. Concretely, for THIS wordlist: it's the Electronic Frontier
 *    Foundation's published "short wordlist #1" (see eff-wordlist.ts) —
 *    one of the most widely known passphrase wordlists in existence,
 *    already bundled into password-cracking dictionaries (hashcat, John
 *    the Ripper rule sets, etc.) industry-wide. Moving our copy of it into
 *    a database or an env var would not remove it from a single attacker's
 *    toolkit — it is already there. All that change would buy us is:
 *      - A network round-trip (DB) or process-start dependency (env var)
 *        on every password suggestion, for a 7 KB static array.
 *      - A new failure mode: DB unreachable ⇒ can't suggest a password.
 *      - Worse auditability: a `git log` on a .ts file shows every edit
 *        with a reviewed PR; a DB row does not, by default.
 *      - Zero additional bits of entropy (see the math below — entropy is
 *        a property of the *draw*, not of whether you can read the menu).
 *
 *    The only way list-secrecy would add real entropy is if the list were
 *    BOTH custom (not the famous EFF list) AND provably never leaked, for
 *    the entire lifetime of every password generated from it. That is not
 *    a property you can engineer or verify — it can only ever be hoped
 *    for, and "hoped-for" is not a security property. This is the formal
 *    distinction between "security through obscurity" (relying on secrecy
 *    of design) and real security (relying on a quantifiable, defendable
 *    property like key length) — OWASP and NIST both explicitly advise
 *    against the former as a primary control.
 *
 * The actual, quantifiable, defensible security property is ENTROPY, and
 * that's a function of (a) the size of the wordlist and (b) how many words
 * you draw — both of which are right here, in the open, where you can do
 * the math on them yourselves. That's the whole point.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE MATH: HOW MUCH ENTROPY DOES THIS ACTUALLY HAVE?
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Let N = EFF_WORDLIST.length (1295) and L = the number of words drawn.
 *
 * Combinatorics — sampling WITH replacement:
 *   Each word is drawn independently and uniformly from all N words, and a
 *   word CAN repeat across positions (we never remove a picked word from
 *   the pool). Total possible outputs:
 *
 *       possibilities = N^L
 *
 *   (If we instead sampled WITHOUT replacement — i.e. each word usable only
 *   once per passphrase — the count would be the falling factorial
 *   N·(N-1)·(N-2)·...·(N-L+1) = N! / (N-L)!, which is *smaller* than N^L
 *   and adds bookkeeping for a security benefit too small to matter at
 *   these values of N. Sampling with replacement is both simpler and
 *   strictly the higher-entropy choice — there's no tradeoff here.)
 *
 * Information-theoretic entropy (Shannon, 1948):
 *   Each draw is one of N equally likely outcomes, so it carries log2(N)
 *   bits of information (this is literally the definition of entropy for
 *   a uniform distribution: H = log2(number of equally likely outcomes)).
 *   L independent draws sum their entropy:
 *
 *       H(L words) = L × log2(N) bits
 *
 *   With N = 1295: log2(1295) ≈ 10.34 bits per word.
 *
 *       L=4 words → ~41.4 bits  (2.8 × 10^12 possibilities)
 *       L=5 words → ~51.7 bits  (3.6 × 10^15 possibilities)
 *       L=6 words → ~62.0 bits  (4.7 × 10^18 possibilities)  ← DEFAULT
 *       L=7 words → ~72.4 bits  (6.1 × 10^21 possibilities)
 *
 *   Why 6 is the default: the classic "diceware" passphrase standard
 *   (Reinhold, 1995) targets ≥60 bits as the floor for a passphrase that
 *   should resist offline cracking for the foreseeable future even against
 *   well-resourced attackers; 6 words clears that with margin. The
 *   previous implementation here used 4 words from a smaller, non-public
 *   182-word list (~30 bits total) — only ~2^30 (≈1.07 billion)
 *   combinations, which is small enough that a single modern GPU can
 *   exhaust it against a fast hash in hours; even against a deliberately
 *   slow hash (bcrypt/argon2id, as used in this app via `Bun.password`),
 *   30 bits is uncomfortably close to "crackable in an afternoon" rather
 *   than "crackable never." Going from 4→6 words multiplies the search
 *   space by N² ≈ 1.68 million — entropy is exponential in word count,
 *   which is why a small change in L has such an outsized effect, and why
 *   "add one more word" is almost always a better lever than any other
 *   tweak you could make to a passphrase scheme.
 *
 * Why we don't also force digits/symbols (no "Tile7-Mango!-Crisp9"):
 *   NIST SP 800-63B (the current US federal digital-identity guideline)
 *   explicitly recommends AGAINST mandatory composition rules (must
 *   contain a digit/symbol/uppercase letter) in favor of (1) high minimum
 *   length, (2) checking against breach/blocklists, and (3) letting users
 *   pick long, memorable passphrases. Composition rules push humans toward
 *   predictable substitutions ("password" → "P@ssw0rd") that *look* more
 *   complex but barely raise real entropy, while making passphrases harder
 *   to type and remember. Five or six random dictionary words already beat
 *   most composition-rule passwords on actual entropy (see numbers above)
 *   while staying easy to read aloud or type on a phone keyboard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY crypto.randomInt() AND NOT Math.random()
 * ──────────────────────────────────────────────────────────────────────────
 *
 * All of the entropy math above assumes the draw is *actually* uniform and
 * *actually* unpredictable. Two distinct failure modes to avoid:
 *
 * 1. Math.random() is not cryptographically secure. It's backed by an
 *    internal PRNG (xorshift128+ in V8) whose state is finite and, in some
 *    engines/versions, has been demonstrated to be recoverable from a
 *    handful of observed outputs — meaning a sufficiently motivated
 *    attacker who can observe some generated passwords could, in
 *    principle, predict future ones. Node/Bun's `crypto.randomInt` is
 *    backed by the OS's cryptographically secure RNG (CSPRNG) — its output
 *    is computationally infeasible to predict even with full knowledge of
 *    all previous outputs.
 *
 * 2. Naively mapping random bytes onto a non-power-of-two range introduces
 *    MODULO BIAS: `randomByte() % 1295` is NOT uniform, because 256 (a
 *    byte's range) isn't an exact multiple of 1295 — the last partial
 *    "wraparound" segment of the byte range gets picked slightly more
 *    often than the rest, subtly skewing some words to be more likely than
 *    others (and therefore *reducing* real entropy below the log2(N) figure
 *    derived above, since that formula assumes a perfectly uniform draw).
 *    `crypto.randomInt(max)` avoids this via rejection sampling: it
 *    requests random bits, and *discards and re-draws* any value that
 *    would fall in the biased leftover range, guaranteeing a perfectly
 *    uniform result. This is why we call `randomInt` directly rather than
 *    hand-rolling `randomBytes(1)[0] % N` — the latter is a classic,
 *    easy-to-miss correctness bug in DIY random-selection code.
 */
import { randomInt } from "crypto";
import { EFF_WORDLIST } from "./eff-wordlist.js";

/** 6 words ≈ 62 bits of entropy — clears the ~60-bit diceware floor. See module docs above. */
export const DEFAULT_WORD_COUNT = 6;

/**
 * Entropy, in bits, of a passphrase drawn from EFF_WORDLIST with `wordCount`
 * independent, uniformly-random, with-replacement word picks.
 * H = wordCount × log2(|wordlist|) — see the entropy derivation above.
 */
export function passphraseEntropyBits(wordCount: number = DEFAULT_WORD_COUNT): number {
  return wordCount * Math.log2(EFF_WORDLIST.length);
}

/**
 * Generates a passphrase of `wordCount` random words from EFF_WORDLIST,
 * joined with "-". Uses a CSPRNG with rejection sampling (see module docs)
 * so every word is drawn uniformly — no word is more likely than another.
 */
export function generateReadablePassword(wordCount: number = DEFAULT_WORD_COUNT): string {
  const words = Array.from(
    { length: wordCount },
    () => EFF_WORDLIST[randomInt(EFF_WORDLIST.length)]
  );
  return words.join("-");
}
