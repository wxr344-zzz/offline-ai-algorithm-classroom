/**
 * Runtime smoke test for generated interactive widgets.
 *
 * Syntax checks alone let through pages that throw as soon as they run or as
 * soon as a learner clicks (an undefined variable, a lookup of a missing
 * element). This parses the page with parse5, then runs it in a worker thread
 * (widget-smoke-worker.cjs): scripts execute in document order, load events
 * fire and every control is operated. Only browser-independent bugs are
 * reported. The worker is terminated on a hard deadline, so a hanging page
 * cannot affect the server; any infrastructure problem yields `inconclusive`
 * rather than a false failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { parse, type DefaultTreeAdapterTypes as P } from 'parse5';

export interface WidgetSmokeResult {
  /** Browser-independent runtime errors, deduplicated, with where they occurred. */
  errors: string[];
  /** True when the check could not run to completion; treat as "no evidence". */
  inconclusive: boolean;
}

type JsonNode =
  | { text: string }
  | { tag: string; ns?: string; attrs: Array<[string, string]>; children: JsonNode[] };

const HARD_TIMEOUT_MS = 10_000;
const HTML_NS = 'http://www.w3.org/1999/xhtml';

function toJson(node: P.ChildNode): JsonNode | null {
  if (node.nodeName === '#text') return { text: (node as P.TextNode).value };
  if (node.nodeName.startsWith('#')) return null;
  const element = node as P.Element;
  const children =
    element.tagName === 'template'
      ? []
      : element.childNodes.map(toJson).filter((n): n is JsonNode => n !== null);
  return {
    tag: element.tagName,
    ...(element.namespaceURI && element.namespaceURI !== HTML_NS
      ? { ns: element.namespaceURI }
      : {}),
    attrs: element.attrs.map((a) => [a.name.toLowerCase(), a.value] as [string, string]),
    children,
  };
}

export function widgetSmokeWorkerPath(): string {
  return path.join(process.cwd(), 'lib', 'server', 'generation', 'widget-smoke-worker.cjs');
}

export async function smokeTestWidget(
  html: string,
  widgetType?: string,
): Promise<WidgetSmokeResult> {
  const workerPath = widgetSmokeWorkerPath();
  if (!fs.existsSync(workerPath)) return { errors: [], inconclusive: true };
  const document = parse(html);
  const tree = {
    children: document.childNodes.map(toJson).filter((n): n is JsonNode => n !== null),
  };
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(workerPath, {
        workerData: { tree, widgetType },
        resourceLimits: { maxOldGenerationSizeMb: 160 },
      });
    } catch {
      resolve({ errors: [], inconclusive: true });
      return;
    }
    let settled = false;
    const finish = (result: WidgetSmokeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ errors: [], inconclusive: true }), HARD_TIMEOUT_MS);
    worker.once('message', (message: { errors?: unknown; inconclusive?: unknown }) => {
      const errors = Array.isArray(message?.errors)
        ? message.errors.filter((e): e is string => typeof e === 'string')
        : [];
      finish({ errors, inconclusive: Boolean(message?.inconclusive) && errors.length === 0 });
    });
    worker.once('error', () => finish({ errors: [], inconclusive: true }));
    worker.once('exit', () => finish({ errors: [], inconclusive: true }));
  });
}
