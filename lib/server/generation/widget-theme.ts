/**
 * Native-style default theme for model-written interactive pages.
 *
 * OpenMAIC's native game and simulation templates expect the model to style
 * the page. A small local model often writes little or no CSS, so buttons,
 * inputs and status lines render with browser defaults. This stylesheet gives
 * those unstyled elements the same visual language as the platform's own
 * pages (accent colour, cards, rounded controls, status pills).
 *
 * It changes appearance only, never behaviour, and never wins over the page.
 * Nothing that feeds game logic is touched: no box-sizing changes (element
 * sizes used for hit tests stay the same) and no canvas resizing (pointer
 * coordinates stay aligned with drawing coordinates).
 * - every selector is wrapped in :where(), so its specificity stays minimal;
 * - it lives in its own cascade layer ordered after Tailwind's preflight but
 *   before Tailwind's components/utilities, and all unlayered page CSS beats
 *   any layer.
 * Platform-owned pages (algorithm demos, Labs, platform simulations) never pass
 * through here.
 */

const LAYER_ORDER = '@layer theme, base, maic-theme, components, utilities;';

const THEME = `
@layer maic-theme {
  :where(html) { color-scheme: light; }
  /* No padding or centering: content keeps its position, so pages that map
     window coordinates straight onto a canvas still hit what they draw. */
  :where(body) {
    background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
    color: #1f2937;
    font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  :where(h1) { font-size: 24px; line-height: 1.3; margin: 4px 0 8px; color: #111827; text-align: center; }
  :where(h2) { font-size: 19px; margin: 16px 0 8px; color: #111827; }
  :where(h3) { font-size: 16px; margin: 12px 0 6px; }
  :where(p) { margin: 6px 0; }
  :where(button, input[type="button"], input[type="submit"], input[type="reset"]) {
    min-height: 42px;
    padding: 0 18px;
    margin: 4px;
    border: 1px solid #7c3aed;
    border-radius: 10px;
    background: #7c3aed;
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    transition: background-color .15s, transform .1s, box-shadow .15s;
    box-shadow: 0 1px 2px rgba(124, 58, 237, .25);
  }
  :where(button:hover:not(:disabled)) { background: #6d28d9; }
  :where(button:active:not(:disabled)) { transform: translateY(1px); }
  :where(button:disabled) { opacity: .45; cursor: not-allowed; }
  :where(button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible) {
    outline: 3px solid rgba(124, 58, 237, .35);
    outline-offset: 2px;
  }
  :where(input:not([type]), input[type="text"], input[type="number"], select, textarea) {
    min-height: 40px;
    padding: 6px 12px;
    margin: 4px;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    background: #fff;
    color: inherit;
    font: inherit;
  }
  :where(input[type="range"]) { accent-color: #7c3aed; min-width: 160px; height: 28px; vertical-align: middle; }
  :where(input[type="checkbox"], input[type="radio"]) { accent-color: #7c3aed; }
  :where(label) { font-weight: 600; margin: 0 6px; }
  /* Canvas: rounded and lifted, but never resized or moved (overlays sit on it). */
  :where(canvas) {
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, .08), 0 0 0 1px rgba(15, 23, 42, .06);
  }
  :where(table) { border-collapse: collapse; margin: 10px auto; background: #fff; border-radius: 10px; overflow: hidden; }
  :where(th, td) { border: 1px solid #e5e7eb; padding: 6px 10px; }
  :where(th) { background: #f5f3ff; }
  /* Status read-outs the native templates name score / level / lives / timer. */
  :where([id*="score" i], [id*="level" i], [id*="lives" i], [id*="timer" i], [id*="round" i], [class*="score" i]):where(span, strong, b, output, div:not(:has(*)), p:not(:has(*))) {
    display: inline-block;
    margin: 4px;
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(124, 58, 237, .14);
    color: inherit;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Feedback lines (message / feedback / result / status). */
  :where([id*="message" i], [id*="feedback" i], [id*="result" i], [id*="status" i]):where(div, p, span, output):not(:has(div, canvas, button, input, svg, table)) {
    margin: 10px auto;
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(124, 58, 237, .08);
    border: 1px solid rgba(124, 58, 237, .2);
    color: inherit;
    font-size: 17px;
    font-weight: 600;
    text-align: center;
  }
  :where([id*="message" i], [id*="feedback" i], [id*="result" i], [id*="status" i]):where(div, p, span, output):empty { display: none; }
  :where(.hidden, [hidden]) { display: none; }
}
`;

/** Add the native-style default theme to a model-written page (idempotent). */
export function applyNativeTheme(html: string): string {
  // Platform-owned pages carry their own complete styling.
  if (!html || html.includes('data-maic-theme') || html.includes('data-maic-platform')) return html;
  const style = `<style data-maic-theme>\n${LAYER_ORDER}\n${THEME}</style>`;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.replace(head[0], `${head[0]}\n${style}`);
  if (/<html\b[^>]*>/i.test(html))
    return html.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>${style}</head>`);
  return `${style}\n${html}`;
}
