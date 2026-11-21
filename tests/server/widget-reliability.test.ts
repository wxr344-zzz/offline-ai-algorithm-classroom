import { describe, expect, it, vi } from 'vitest';
import { smokeTestWidget } from '@/lib/server/generation/widget-smoke-test';
import {
  plotRespondsToSliders,
  compileFormula,
  fallbackLanguage,
  normalizeGameSpec,
  normalizeSimulationSpec,
  designShowsChange,
  renderConceptStepsWidget,
  renderGameWidget,
  renderSimulationWidget,
} from '@/lib/server/generation/widget-fallback';
import {
  ensureRunnableWidget,
  extractJsonObject,
  mentionsTopic,
  outlineWithDesign,
  crossCheckGame,
  planSimulationDesign,
  specIsAboutTopic,
  topicCore,
} from '@/lib/server/generation/steps/widget-reliability';
import { inlineTailwind } from '@/lib/server/generation/widget-tailwind';
import type { SceneOutline } from '@/lib/types/generation';

// Each case starts worker threads; allow for a loaded CI machine.
const T = 30_000;

const page = (body: string, head = '') =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

// The two failures reported from a real classroom (切比雪夫/辛钦不等式).
const UNDEFINED_GLOBAL = page(
  `<input id="mean"><button onclick="start()">启动</button><canvas id="c"></canvas>
<script>const ctx=document.getElementById('c').getContext('2d');function start(){ctx.clearRect(0,0,1,1)}
meansInput.addEventListener('input',()=>{});</script>`,
);
const MISSING_ELEMENT_ON_CLICK = page(
  `<button id="startBtn" onclick="startGame()">开始</button><div id="box"></div>
<script>function startGame(){document.getElementById('overlay').remove();}</script>`,
);
const WORKING = page(
  `<input type="range" id="k-slider" min="1" max="5" value="2"><span id="k-display"></span>
<ul class="list"></ul><button id="add-btn">添加</button><canvas id="plot"></canvas>
<script>
const list=document.querySelector('.list');let items=[];
function update(){const k=+document.getElementById('k-slider').value;document.getElementById('k-display').textContent=(1/(k*k)).toFixed(3);
 const ctx=document.getElementById('plot').getContext('2d');ctx.beginPath();ctx.lineTo(k,k);ctx.stroke();}
document.getElementById('k-slider').addEventListener('input',update);
document.getElementById('add-btn').onclick=()=>{items.push(items.length);list.innerHTML=items.map(i=>'<li class="it" data-i="'+i+'">'+i+'</li>').join('');
 list.querySelectorAll('.it').forEach(li=>li.addEventListener('click',e=>e.currentTarget.classList.toggle('on')));document.querySelector('.it:last-child').dataset.last='1';};
window.addEventListener('message',e=>{const {type,state}=e.data||{};if(type==='SET_WIDGET_STATE'&&state){const s=document.getElementById('k-slider');if(s&&state.k!==undefined){s.value=state.k;s.dispatchEvent(new Event('input'));}}});
update();
</script>`,
);

const outline = (widgetType: 'simulation' | 'game' | 'diagram'): SceneOutline =>
  ({
    id: 'sim',
    type: 'interactive',
    title: '切比雪夫不等式模拟',
    description: '观察概率上界如何随 k 变化',
    keyPoints: ['P(|X-μ|≥kσ) ≤ 1/k²', '与分布形状无关'],
    order: 1,
    widgetType,
    widgetOutline: { concept: '切比雪夫不等式' },
  }) as SceneOutline;

const SIM_SPEC = {
  title: '切比雪夫不等式模拟器',
  intro: '拖动 k',
  parameters: [
    { id: 'k', label: 'k', min: 1, max: 5, step: 0.1, default: 2 },
    { id: 's', label: '方差倍数', min: 0.5, max: 1, step: 0.1, default: 1 },
  ],
  outputs: [{ label: '上界 s/k²', expr: 's/k^2', format: 'percent' }],
  observations: ['k 越大上界越小'],
};
const GAME_SPEC = {
  title: '挑战',
  intro: '选择正确答案',
  rounds: [
    { prompt: 'k=2 时上界？', options: ['25%', '50%'], answer: 0, explain: '1/4' },
    { prompt: 'k=3 时上界？', options: ['33%', '11.1%'], answer: 1, explain: '1/9' },
  ],
};

describe('widget runtime smoke test', () => {
  it(
    'reports an undefined global used at load time',
    async () => {
      const result = await smokeTestWidget(UNDEFINED_GLOBAL);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('meansInput is not defined');
    },
    T,
  );

  it(
    'reports a missing element looked up when a button is clicked',
    async () => {
      const result = await smokeTestWidget(MISSING_ELEMENT_ON_CLICK);
      expect(result.errors.join('\n')).toContain(
        "Cannot read properties of null (reading 'remove')",
      );
    },
    T,
  );

  it(
    'runs head scripts before the body exists, like a browser',
    async () => {
      const result = await smokeTestWidget(
        page(
          '<button id="go">go</button>',
          `<script>document.getElementById('go').addEventListener('click',()=>{})</script>`,
        ),
      );
      expect(result.errors.join()).toContain("reading 'addEventListener'");
    },
    T,
  );

  it(
    'reports temporal-dead-zone access and errors raised later by timers',
    async () => {
      const tdz = await smokeTestWidget(
        page(
          `<div id="o"></div><script>init();function init(){o.textContent=label}const label='x';</script>`,
        ),
      );
      expect(tdz.errors.join()).toContain("Cannot access 'label' before initialization");
      const timer = await smokeTestWidget(
        page(
          `<button id="s">s</button><script>s.onclick=()=>setTimeout(()=>{document.querySelector('.result').textContent='x'},500)</script>`,
        ),
      );
      expect(timer.errors.join()).toContain('of null');
    },
    T,
  );

  it(
    'accepts working pages, including id globals and DOM built with innerHTML',
    async () => {
      expect((await smokeTestWidget(WORKING)).errors).toEqual([]);
      const idGlobals = page(
        `<div id="score">0</div><button id="go">go</button><script>go.addEventListener('click',()=>{score.textContent=+score.textContent+1});let total=0;</script><script>total+=1</script>`,
      );
      expect((await smokeTestWidget(idGlobals)).errors).toEqual([]);
    },
    T,
  );

  it(
    'does not count environment gaps (CDN libraries, unknown APIs) as errors',
    async () => {
      const result = await smokeTestWidget(
        page(
          `<div id="m"></div><script src="https://cdn.example/lib.js"></script>
<script>renderMathInElement(document.body);const chart=new Chart(document.getElementById('m'),{});
document.getElementById('m').animate([{opacity:0}],300);new ResizeObserver(()=>{}).observe(document.body);</script>`,
        ),
      );
      expect(result.errors).toEqual([]);
    },
    T,
  );

  it(
    'reports pages that run but show broken values or cannot be operated',
    async () => {
      // A trig "calculator": empty <select>, so the result reads undefined / null.
      const calculator = page(
        `<input id="a" type="range" min="0" max="360"><select id="fn"></select><button id="go">启动</button><div id="out"></div>
<script>document.getElementById('go').onclick=()=>{const f=document.getElementById('fn').value||undefined;
document.getElementById('out').innerHTML='三角函数: '+f+'<br>结果: '+null;};</script>`,
      );
      const errors = (await smokeTestWidget(calculator, 'simulation')).errors.join('\n');
      expect(errors).toContain('下拉框 #fn 没有任何选项');
      expect(errors).toMatch(/显示“(undefined|null)”/);
      const nan = page(
        `<button id="b">go</button><p id="p"></p><script>b.onclick=()=>{p.textContent='x = '+(1/'a')}</script>`,
      );
      expect((await smokeTestWidget(nan, 'simulation')).errors.join()).toContain('显示“NaN”');
      const inert = page('<canvas id="c"></canvas><p>直角三角形</p>');
      expect((await smokeTestWidget(inert, 'simulation')).errors.join()).toContain(
        '没有任何可操作的控件',
      );
      // Ordinary words are not defects, and diagrams need no controls.
      const prose = page(
        '<p>The null hypothesis says nothing changes; nullable and undefinedness are words.</p>',
      );
      expect((await smokeTestWidget(prose, 'diagram')).errors).toEqual([]);
    },
    T,
  );

  it(
    'stops an infinite loop without hanging',
    async () => {
      const result = await smokeTestWidget(page('<script>while(true){}</script>'));
      expect(result.errors).toEqual([]);
      expect(result.inconclusive).toBe(true);
    },
    T,
  );
});

describe('fallback widget formulas and specs', () => {
  it('compiles whitelisted formulas and rejects anything else', () => {
    const js = compileFormula('1/k^2 + sqrt(sigma) - -2', ['k', 'sigma']);
    const f = new Function('p', `return ${js}`) as (p: Record<string, number>) => number;
    expect(f({ k: 2, sigma: 4 })).toBeCloseTo(0.25 + 2 + 2);
    expect(compileFormula('-k^2', ['k'])).toBe('(-Math.pow(p.k,2))');
    for (const bad of [
      'alert(1)',
      'k;1',
      'constructor',
      'toString(k)',
      '__proto__',
      'k[0]',
      'window',
      '1 +',
      'p.k',
    ])
      expect(() => compileFormula(bad, ['k'])).toThrow();
  });

  it('validates simulation and game specs', () => {
    expect(normalizeSimulationSpec(SIM_SPEC)?.parameters[0]?.id).toBe('k');
    expect(
      normalizeSimulationSpec({ ...SIM_SPEC, outputs: [{ label: 'x', expr: 'evil()' }] }),
    ).toBeNull();
    expect(
      normalizeSimulationSpec({
        ...SIM_SPEC,
        parameters: [{ id: 'k', label: 'k', min: 5, max: 1, default: 2 }],
      }),
    ).toBeNull();
    expect(
      normalizeSimulationSpec({ ...SIM_SPEC, outputs: [{ label: 'x', expr: '1/(k-k)' }] }),
    ).toBeNull();
    expect(normalizeGameSpec(GAME_SPEC)?.rounds).toHaveLength(2);
    expect(
      normalizeGameSpec({ rounds: [{ prompt: 'q', options: ['a', 'b'], answer: 5 }] }),
    ).toBeNull();
  });

  it('picks the course language for the fixed page text', () => {
    expect(fallbackLanguage('请使用简体中文', 'x')).toBe('zh-CN');
    expect(fallbackLanguage('使用繁體中文', 'x')).toBe('zh-TW');
    expect(fallbackLanguage('Use English for all content', '切比雪夫')).toBe('en');
    expect(fallbackLanguage('', '切比雪夫')).toBe('zh-CN');
  });

  it(
    'renders fallback pages that pass the runtime check',
    async () => {
      const pages: Array<[string, string]> = [
        [renderSimulationWidget(normalizeSimulationSpec(SIM_SPEC)!, 'zh-CN', 't'), 'simulation'],
        [renderGameWidget(normalizeGameSpec(GAME_SPEC)!, 'en', 't'), 'game'],
        [renderConceptStepsWidget('t', ['a', 'b'], 'zh-TW', 'diagram'), 'diagram'],
        [renderConceptStepsWidget('t', ['a', 'b'], 'zh-CN', 'simulation'), 'simulation'],
      ];
      for (const [html, widgetType] of pages) {
        const result = await smokeTestWidget(html, widgetType);
        expect(result).toEqual({ errors: [], inconclusive: false });
        expect(html).toContain('id="widget-config"');
      }
    },
    T,
  );

  it('extracts JSON from fenced or slightly malformed model output', () => {
    expect(extractJsonObject('说明\n```json\n{"a":1,}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('no json')).toBeNull();
  });
});

describe('ensureRunnableWidget', () => {
  const log = { info: vi.fn(), warn: vi.fn() };

  it(
    'keeps a page that already runs, without calling the model',
    async () => {
      const aiCall = vi.fn();
      const content = { html: WORKING, widgetType: 'simulation' as const };
      const result = await ensureRunnableWidget({
        content,
        outline: outline('simulation'),
        aiCall,
        log,
      });
      expect(result).toBe(content);
      expect(aiCall).not.toHaveBeenCalled();
    },
    T,
  );

  it(
    'repairs a failing page, feeding back the errors and the real element ids',
    async () => {
      const aiCall = vi.fn().mockResolvedValue('修复如下：\n' + WORKING);
      const result = await ensureRunnableWidget({
        content: { html: UNDEFINED_GLOBAL, widgetType: 'simulation' },
        outline: outline('simulation'),
        aiCall,
        log,
        languageDirective: '简体中文',
      });
      expect(aiCall).toHaveBeenCalledTimes(1);
      const prompt = aiCall.mock.calls[0]![1] as string;
      expect(prompt).toContain('meansInput is not defined');
      expect(prompt).toContain('mean');
      expect(result.html).toContain('k-slider');
      expect((await smokeTestWidget(result.html)).errors).toEqual([]);
    },
    T,
  );

  it(
    'replaces a page that stays broken with the native simulation built from a spec',
    async () => {
      const aiCall = vi
        .fn()
        .mockResolvedValueOnce(UNDEFINED_GLOBAL)
        .mockResolvedValueOnce(UNDEFINED_GLOBAL)
        .mockResolvedValueOnce(JSON.stringify(SIM_SPEC));
      // (the fourth call is the design's subject check)
      const result = await ensureRunnableWidget({
        content: { html: UNDEFINED_GLOBAL, widgetType: 'simulation' },
        outline: outline('simulation'),
        aiCall,
        log,
        languageDirective: '简体中文',
      });
      expect(aiCall).toHaveBeenCalledTimes(4);
      expect(result.html).toContain('切比雪夫不等式模拟器');
      expect(result.html).toContain('k-slider');
      expect(result.widgetType).toBe('simulation');
      expect(result.widgetConfig?.type).toBe('simulation');
      expect((await smokeTestWidget(result.html)).errors).toEqual([]);
    },
    T,
  );

  it(
    'builds the native game for a broken game page',
    async () => {
      const aiCall = vi
        .fn()
        .mockResolvedValueOnce('no html')
        .mockResolvedValueOnce('still no html')
        .mockResolvedValueOnce('```json\n' + JSON.stringify(GAME_SPEC) + '\n```');
      const result = await ensureRunnableWidget({
        content: { html: MISSING_ELEMENT_ON_CLICK, widgetType: 'game' },
        outline: outline('game'),
        aiCall,
        log,
      });
      expect(result.html).toContain('k=3 时上界？');
      expect((await smokeTestWidget(result.html)).errors).toEqual([]);
    },
    T,
  );

  it(
    'keeps the scene retryable instead of publishing a fake checklist',
    async () => {
      const aiCall = vi.fn().mockResolvedValue('{"parameters":[]}');
      const regenerate = vi.fn().mockResolvedValue(null);
      await expect(
        ensureRunnableWidget({
          content: null,
          outline: outline('simulation'),
          aiCall,
          log,
          regenerate,
        }),
      ).rejects.toThrow('No verified simulation design');
      expect(regenerate).toHaveBeenCalledTimes(1);
    },
    T,
  );

  it(
    'does not publish unverified content when the local service fails',
    async () => {
      await expect(
        ensureRunnableWidget({
          content: { html: UNDEFINED_GLOBAL, widgetType: 'diagram' },
          outline: outline('diagram'),
          aiCall: vi.fn().mockRejectedValue(new Error('offline')),
          log,
        }),
      ).rejects.toThrow('No verified simulation design');
    },
    T,
  );

  it(
    'skips repairs that would overrun the step and goes straight to the native page',
    async () => {
      const aiCall = vi.fn().mockResolvedValue(JSON.stringify(SIM_SPEC));
      const result = await ensureRunnableWidget({
        content: { html: UNDEFINED_GLOBAL, widgetType: 'simulation' },
        outline: outline('simulation'),
        aiCall,
        log,
        generationMs: 200_000,
        deadlineAt: Date.now() + 120_000,
      });
      // One short spec call and its subject check, no page rewrite.
      expect(aiCall).toHaveBeenCalledTimes(2);
      expect(aiCall.mock.calls[0]![0]).toContain('JSON');
      expect(aiCall.mock.calls[1]![0]).toContain('JSON');
      expect(result.html).toContain('k-slider');
    },
    T,
  );

  it(
    'does not mislabel an instant checklist as a game when its budget is spent',
    async () => {
      const aiCall = vi.fn();
      await expect(
        ensureRunnableWidget({
          content: { html: UNDEFINED_GLOBAL, widgetType: 'game' },
          outline: outline('game'),
          aiCall,
          log,
          deadlineAt: Date.now() + 5_000,
        }),
      ).rejects.toThrow('No verified game design');
      expect(aiCall).not.toHaveBeenCalled();
    },
    T,
  );

  it(
    'aborts a model call that runs past the budget',
    async () => {
      let aborted = false;
      const aiCall = vi.fn(
        (_s: string, _u: string, signal?: AbortSignal) =>
          new Promise<string>((_, reject) => {
            signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      );
      // Virtual clock: checks before the call see 45.3 s left; when the call
      // starts only 0.3 s remain, so its real abort timer fires quickly.
      const started = Date.now();
      const readings = [0, 0];
      await expect(
        ensureRunnableWidget({
          content: { html: UNDEFINED_GLOBAL, widgetType: 'simulation' },
          outline: outline('simulation'),
          aiCall,
          log,
          generationMs: 1_000,
          now: () => started + (readings.length ? readings.shift()! : 45_000),
          deadlineAt: started + 45_300,
        }),
      ).rejects.toThrow('No verified simulation design');
      expect(aborted).toBe(true);
    },
    T,
  );
});

// The reported 反函数 page: runs fine, but is the template's moving-ball example.
const TEMPLATE_BALL = page(
  `<div id="controls"><button id="start-btn">启动</button><button id="reset-btn">重新开始</button>
<input type="range" id="x-slider" min="0" max="100" value="50"><span id="x-display">X值: 50</span></div>
<canvas id="canvas"></canvas>
<script>let state={running:false,posX:50};const ctx=document.getElementById('canvas').getContext('2d');
function draw(){ctx.clearRect(0,0,400,400);ctx.beginPath();ctx.arc(state.posX,200,10,0,7);ctx.fill();}
document.getElementById('start-btn').onclick=()=>{state.running=true;draw();};
document.getElementById('reset-btn').onclick=()=>{state.posX=50;draw();};
document.getElementById('x-slider').addEventListener('input',e=>{state.posX=+e.target.value;document.getElementById('x-display').textContent='X值: '+state.posX;draw();});
draw();</script>`,
);
const INVERSE_SPEC = normalizeSimulationSpec({
  title: '反函数探索',
  intro: '调整斜率与截距',
  parameters: [
    { id: 'a', label: '斜率 a', min: 0.5, max: 4, step: 0.1, default: 2 },
    { id: 'b', label: '截距 b', min: -3, max: 3, step: 0.5, default: 1 },
  ],
  outputs: [{ label: '反函数值 f⁻¹(2)', expr: '(2-b)/a' }],
  observations: ['f(f⁻¹(2)) = 2'],
})!;
const inverseOutline = {
  ...outline('simulation'),
  title: '交互模拟',
  description: '围绕“请为我讲解反函数”设计与主题相符的可操作模拟',
  widgetOutline: { concept: '请为我讲解反函数' },
} as SceneOutline;

describe('offline native simulations: design first, stay on topic', () => {
  const log = { info: vi.fn(), warn: vi.fn() };

  it('extracts the topic from a request', () => {
    expect(topicCore('请为我讲解反函数')).toBe('反函数');
    expect(topicCore('讲解切比雪夫不等式。')).toBe('切比雪夫不等式');
    expect(topicCore('Explain photosynthesis')).toBe('photosynthesis');
    expect(topicCore('勾股定理')).toBe('勾股定理');
  });

  it('plans the design with one short call and hands it to the native template', async () => {
    const aiCall = vi.fn().mockResolvedValue('```json\n' + JSON.stringify(INVERSE_SPEC) + '\n```');
    const spec = await planSimulationDesign({ outline: inverseOutline, aiCall, log });
    expect(spec?.parameters.map((p) => p.id)).toEqual(['a', 'b']);
    expect(aiCall.mock.calls[0]![1]).toContain('主题：反函数');
    const native = outlineWithDesign(inverseOutline, spec!, 'zh-CN');
    expect(native.widgetOutline?.concept).toBe('反函数');
    expect(native.widgetOutline?.keyVariables).toEqual(['斜率 a (a)', '截距 b (b)']);
    expect(native.description).toContain('必须围绕“反函数”');
    expect(native.description).toContain('(2-b)/a');
    expect(native.description).toContain('不要照搬');
  });

  it('skips planning when the step has no time for it', async () => {
    const aiCall = vi.fn();
    const now = () => 0;
    const spec = await planSimulationDesign({
      outline: inverseOutline,
      aiCall,
      log,
      deadlineAt: 100_000,
      now,
    });
    expect(spec).toBeNull();
    expect(aiCall).not.toHaveBeenCalled();
  });

  it('recognises a copied template example as off-topic', () => {
    expect(mentionsTopic(TEMPLATE_BALL, INVERSE_SPEC, '反函数')).toBe(false);
    expect(mentionsTopic(TEMPLATE_BALL.replace('X值', '斜率 a'), INVERSE_SPEC, '反函数')).toBe(
      true,
    );
    expect(mentionsTopic(page('<h1>反函数</h1>'), INVERSE_SPEC, '反函数')).toBe(true);
  });

  it(
    'asks for a topical rewrite, then uses the planned design for the native page',
    async () => {
      const aiCall = vi.fn().mockResolvedValue(TEMPLATE_BALL);
      const result = await ensureRunnableWidget({
        content: { html: TEMPLATE_BALL, widgetType: 'simulation' },
        outline: outlineWithDesign(inverseOutline, INVERSE_SPEC, 'zh-CN'),
        design: INVERSE_SPEC,
        aiCall,
        log,
        languageDirective: '简体中文',
      });
      // Two repairs, no extra spec call: the planned design is reused.
      expect(aiCall).toHaveBeenCalledTimes(2);
      const repair = aiCall.mock.calls[0]![1] as string;
      expect(repair).toContain('页面与主题无关');
      expect(repair).toContain('页面必须实现以下设计');
      expect(result.html).toContain('反函数探索');
      expect(result.html).toContain('a-slider');
      expect((await smokeTestWidget(result.html, 'simulation')).errors).toEqual([]);
    },
    T,
  );

  it(
    'keeps a topical page that runs',
    async () => {
      const topical = TEMPLATE_BALL.replace('X值', '斜率 a');
      const aiCall = vi.fn();
      const content = { html: topical, widgetType: 'simulation' as const };
      const result = await ensureRunnableWidget({
        content,
        outline: inverseOutline,
        design: INVERSE_SPEC,
        aiCall,
        log,
      });
      expect(result).toBe(content);
      expect(aiCall).not.toHaveBeenCalled();
    },
    T,
  );
});

describe('offline Tailwind for native pages', () => {
  it('compiles the classes a page uses into an inline style and drops CDN tags', async () => {
    const html = page(
      `<div class="flex flex-col md:flex-row gap-4 p-6 bg-slate-50"><button class="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">启动</button></div>
<script>document.querySelector('button').classList.add('ring-2 ring-indigo-300')</script>`,
      '<script src="https://cdn.tailwindcss.com"></script><style>.mine{color:red}</style>',
    );
    const out = await inlineTailwind(html);
    expect(out).not.toContain('cdn.tailwindcss.com');
    expect(out).toContain('data-maic-tailwind');
    expect(out).toMatch(/\.bg-indigo-600\s*\{/);
    expect(out).toMatch(/\.md\\:flex-row/);
    expect(out).toContain('ring-indigo-300');
    expect(out.indexOf('data-maic-tailwind')).toBeLessThan(out.indexOf('.mine{'));
    expect(await inlineTailwind(out)).toBe(out);
  });

  it('leaves hand-styled pages untouched', async () => {
    const html = page(
      '<button style="color:red">go</button>',
      '<style>button{padding:8px}</style>',
    );
    expect(await inlineTailwind(html)).toBe(html);
  });
});

describe('function-graph designs', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  const FOURIER = {
    title: '傅里叶级数：用正弦波逼近方波',
    intro: '增加谐波次数，观察部分和逼近方波',
    parameters: [
      { id: 'n', label: '最高谐波次数 N', min: 1, max: 9, step: 2, default: 3 },
      { id: 'A', label: '振幅 A', min: 0.5, max: 2, step: 0.1, default: 1 },
    ],
    plot: {
      xLabel: '时间 t',
      xMin: -6.3,
      xMax: 6.3,
      curves: [
        { label: '目标方波', expr: 'A*sign(sin(x))' },
        { label: '部分和', expr: '4*A/pi*(sin(x)+min(1,max(0,n-2))*sin(3*x)/3)' },
        { label: '无效曲线', expr: 'x ? 1 : 0' },
      ],
    },
    outputs: [],
    observations: ['N 越大越接近方波'],
  };

  it('accepts curves over x, drops invalid ones, and allows a graph without outputs', () => {
    const spec = normalizeSimulationSpec(FOURIER)!;
    expect(spec.plot?.curves.map((c) => c.label)).toEqual(['目标方波', '部分和']);
    expect(spec.outputs).toEqual([]);
  });

  it('rejects copied placeholders instead of real content', () => {
    expect(
      normalizeSimulationSpec({
        ...FOURIER,
        parameters: [{ id: 'k', label: '<参数名称>', min: 0, max: 1, step: 0.1, default: 0.5 }],
      }),
    ).toBeNull();
    expect(normalizeSimulationSpec({ ...FOURIER, title: '<含主题的页面标题>' })).toBeNull();
  });

  it(
    'renders a graph page that passes the runtime check',
    async () => {
      const html = renderSimulationWidget(normalizeSimulationSpec(FOURIER)!, 'zh-CN', 't');
      expect(html).toContain('目标方波');
      expect(html).toContain('class="legend"');
      expect(await smokeTestWidget(html, 'simulation')).toEqual({
        errors: [],
        inconclusive: false,
      });
    },
    T,
  );

  it('asks for placeholders only, never a concrete example topic', async () => {
    const aiCall = vi.fn().mockResolvedValue(JSON.stringify(FOURIER));
    const fourierOutline = {
      ...inverseOutline,
      widgetOutline: { concept: '请为我讲解傅里叶级数' },
    } as SceneOutline;
    await planSimulationDesign({ outline: fourierOutline, aiCall, log });
    const prompt = aiCall.mock.calls[0]![1] as string;
    expect(prompt).toContain('主题：傅里叶级数');
    expect(prompt).not.toMatch(/标准差|切比雪夫|概率上界/);
    expect(prompt).toContain('"plot"');
  });

  it('retries once when the design is about another topic', async () => {
    const offTopic = { ...FOURIER, title: '切比雪夫不等式模拟器', intro: '拖动 k 观察概率上界' };
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(offTopic))
      .mockResolvedValueOnce(JSON.stringify(FOURIER));
    const outlineF = {
      ...inverseOutline,
      widgetOutline: { concept: '傅里叶级数' },
    } as SceneOutline;
    const spec = await planSimulationDesign({ outline: outlineF, aiCall, log });
    // The second design is accepted after its subject check.
    expect(aiCall).toHaveBeenCalledTimes(3);
    expect(spec?.title).toContain('傅里叶级数');
    expect(specIsAboutTopic(normalizeSimulationSpec(offTopic)!, '傅里叶级数')).toBe(false);
  });
});

describe('graphs and canvases that show nothing', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  // The reported 反三角函数 design: curves written in the slider, not in x.
  const FLAT = {
    title: '反三角函数模拟器',
    intro: '拖动角度观察反三角函数',
    parameters: [{ id: 'theta', label: '角度', min: -90, max: 90, step: 1, default: 36 }],
    plot: {
      xLabel: '角度（度）',
      xMin: -180,
      xMax: 180,
      curves: [
        { label: '反正弦', expr: 'asin(sin(theta*pi/180))' },
        { label: '反余弦', expr: 'acos(cos(theta*pi/180))' },
      ],
    },
    outputs: [{ label: 'sin(theta)', expr: 'sin(theta*pi/180)' }],
    observations: [],
  };
  const REAL = {
    ...FLAT,
    plot: {
      xLabel: 'x',
      xMin: -1,
      xMax: 1,
      curves: [
        { label: '反正弦 asin(x)·θ/90', expr: 'asin(x)*theta/90' },
        { label: '参考线 y=π/2', expr: 'pi/2' },
      ],
    },
  };

  it('drops a graph whose curves never depend on x, keeps flat reference lines next to real ones', () => {
    expect(normalizeSimulationSpec(FLAT)?.plot).toBeUndefined();
    expect(normalizeSimulationSpec(REAL)?.plot?.curves).toHaveLength(2);
  });

  it('asks again with the reason when the curves were flat, then keeps the best design', async () => {
    const flatOutline = {
      ...inverseOutline,
      widgetOutline: { concept: '反三角函数' },
    } as SceneOutline;
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(FLAT))
      .mockResolvedValueOnce(JSON.stringify(REAL));
    const spec = await planSimulationDesign({ outline: flatOutline, aiCall, log });
    expect(spec?.plot?.curves[0]!.expr).toBe('asin(x)*theta/90');
    expect(aiCall.mock.calls[1]![1]).toContain('必须包含横轴变量 x');
    // Only flat answers: no design whose graph moves with the slider, so none
    // (the page is then written natively and runtime-checked, never a frozen graph).
    const again = vi.fn().mockResolvedValue(JSON.stringify(FLAT));
    const fallback = await planSimulationDesign({ outline: flatOutline, aiCall: again, log });
    expect(again).toHaveBeenCalledTimes(3);
    expect(fallback).toBeNull();
  });

  it(
    'reports a visible canvas that is never drawn on',
    async () => {
      const blank = page(
        `<input type="range" id="angle-slider"><button onclick="go()">启动</button><canvas id="c"></canvas><div id="info">当前角度: 30°</div>
<script>const ctx=document.getElementById('c').getContext('2d');function go(){document.getElementById('info').textContent='当前角度: 40°';}</script>`,
      );
      expect((await smokeTestWidget(blank, 'simulation')).errors.join()).toContain('从未绘制');
      // Drawing on load, on input or in an animation loop all count.
      expect((await smokeTestWidget(WORKING, 'simulation')).errors).toEqual([]);
      const loop = page(
        `<button onclick="s()">go</button><canvas id="c"></canvas><script>const ctx=document.getElementById('c').getContext('2d');function f(){ctx.fillRect(0,0,1,1);requestAnimationFrame(f)}requestAnimationFrame(f);function s(){}</script>`,
      );
      expect((await smokeTestWidget(loop, 'simulation')).errors).toEqual([]);
    },
    T,
  );
});

describe('photosynthesis simulator (reported: fell back to a blank model page)', () => {
  const PHOTO = {
    title: '光合速率模拟器',
    intro: '拖动滑块观察光照和CO2浓度如何影响光合速率',
    parameters: [
      { id: 'L', label: '光照强度', min: 0, max: 100, step: 1, default: 40 },
      { id: 'C', label: 'CO2浓度', min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: 'bad id', label: '温度', min: 0, max: 40, step: 1, default: 25 },
    ],
    plot: {
      xLabel: '光照强度',
      xMin: 0,
      xMax: 100,
      curves: [{ label: '光合速率', expr: '20*C*x/(30+x)' }],
    },
    outputs: [
      { label: '光合速率', expr: '20*C*L/(30+L)' },
      { label: '温度系数', expr: 'T*2' },
    ],
    observations: ['光照增强到一定程度后速率趋于饱和'],
  };
  it('keeps a design whose title names the topic by a shorter word, minus its broken parts', () => {
    const spec = normalizeSimulationSpec(PHOTO)!;
    expect(spec.parameters.map((p) => p.id)).toEqual(['L', 'C']);
    expect(spec.outputs.map((o) => o.label)).toEqual(['光合速率']);
    expect(specIsAboutTopic(spec, '光合作用的影响因素')).toBe(true);
    expect(specIsAboutTopic(spec, '光合作用')).toBe(true);
    expect(specIsAboutTopic(spec, '傅里叶级数')).toBe(false);
  });
  it('retries after a failed planning call instead of giving up', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const aiCall = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(JSON.stringify(PHOTO));
    const outline = {
      id: 's2',
      type: 'interactive',
      widgetType: 'simulation',
      // Not 光合作用 itself: that topic has a maintained preset and asks no model.
      title: '叶片气体交换模拟器',
      description: '',
      keyPoints: [],
      widgetOutline: { concept: '叶片气体交换速率' },
    } as unknown as SceneOutline;
    const spec = await planSimulationDesign({ outline, aiCall, log });
    expect(aiCall).toHaveBeenCalledTimes(3);
    expect(spec?.title).toBe('光合速率模拟器');
  });
  it(
    'reports a canvas that stays empty until a start button is pressed',
    async () => {
      const late = page(
        `<input type="range" id="light-slider"><button onclick="go()">启动</button><canvas id="c"></canvas>
<script>const ctx=document.getElementById('c').getContext('2d');function draw(){ctx.fillRect(0,0,5,5)}function go(){setInterval(draw,50)}</script>`,
      );
      expect((await smokeTestWidget(late, 'simulation')).errors.join()).toContain(
        '页面打开时是空白的',
      );
    },
    T,
  );
});

describe('graphs that do not move with their slider (reported: 梯度下降 slope page)', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  const SLOPE = {
    title: '梯度下降算法',
    intro: '通过调整参数观察曲线变化',
    parameters: [{ id: 'a', label: '斜率', min: -5, max: 5, step: 1, default: -3 }],
    outputs: [{ label: '斜率 a 的值', expr: 'a' }],
    observations: ['a 增大时曲线变陡'],
  };
  const DESCENT = {
    title: '梯度下降算法',
    intro: '调整学习率，观察损失如何随迭代下降',
    parameters: [
      { id: 'eta', label: '学习率', min: 0.05, max: 0.9, step: 0.05, default: 0.2 },
      { id: 'x0', label: '初始值', min: -5, max: 5, step: 0.5, default: 4 },
    ],
    plot: {
      xLabel: '迭代次数',
      xMin: 0,
      xMax: 20,
      curves: [{ label: '损失 f(x_k)', expr: '(x0*pow(1-2*eta,x))^2' }],
    },
    outputs: [{ label: '每步收缩倍数', expr: 'abs(1-2*eta)' }],
    observations: ['学习率越大下降越快，过大会振荡'],
  };
  it('drops a number that repeats its slider, and never keeps a graph a slider cannot change', () => {
    expect(normalizeSimulationSpec(SLOPE)).toBeNull();
    const oneSlider = {
      ...SLOPE,
      outputs: [{ label: '损失', expr: 'a^2' }],
    };
    expect(designShowsChange(normalizeSimulationSpec(oneSlider)!)).toBe(false);
    expect(designShowsChange(normalizeSimulationSpec(DESCENT)!)).toBe(true);
  });
  it('asks again for a graph that moves with the sliders, and takes it', async () => {
    const outline = {
      id: 's3',
      type: 'interactive',
      widgetType: 'simulation',
      title: '交互模拟',
      description: '',
      keyPoints: [],
      // Not 梯度下降 itself (it has a maintained preset): a related unlisted method.
      widgetOutline: { concept: '请问我讲解梯度法' },
    } as unknown as SceneOutline;
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ ...SLOPE, outputs: [{ label: '损失', expr: 'a^2' }] }),
      )
      .mockResolvedValueOnce(JSON.stringify(DESCENT));
    const spec = await planSimulationDesign({ outline, aiCall, log });
    expect(spec?.title).toBe('梯度下降算法');
    expect(spec?.plot?.curves[0]!.expr).toContain('eta');
    expect(aiCall.mock.calls[1]![1]).toContain('必须给出 "plot"');
    // Algorithms are steered to graph the quantity they work on.
    expect(aiCall.mock.calls[0]![1]).toContain('迭代步数');
  });
});

describe('sequences and barely moving graphs (reported: 学习率 and 初始值 change nothing)', () => {
  const base = {
    title: '梯度下降算法入门',
    intro: '调整学习率和初始值',
    parameters: [
      { id: 'eta', label: '学习率', min: 0.05, max: 1.1, step: 0.05, default: 0.4 },
      { id: 'x0', label: '初始值', min: -5, max: 5, step: 0.5, default: 4 },
    ],
    outputs: [],
    observations: [],
  };
  it('does not count a slider that moves a 0–100 line by a hair', () => {
    const reported = normalizeSimulationSpec({
      ...base,
      plot: {
        xLabel: '迭代次数',
        xMin: 0,
        xMax: 100,
        curves: [{ label: '当前点', expr: 'x + 0.001*eta*x0' }],
      },
    })!;
    expect(reported.plot).toBeDefined();
    expect(designShowsChange(reported)).toBe(false);
  });
  it(
    'draws an iterative method step by step, and the sliders reshape it',
    async () => {
      const descent = normalizeSimulationSpec({
        ...base,
        plot: {
          xLabel: '迭代次数',
          xMin: 0,
          xMax: 15,
          curves: [{ label: '参数 x', start: 'x0', expr: 'y - eta*2*(y-1)' }],
        },
      })!;
      expect(descent.plot?.curves[0]!.start).toBe('x0');
      expect(designShowsChange(descent)).toBe(true);
      const html = renderSimulationWidget(descent, 'zh-CN', '梯度下降');
      expect((await smokeTestWidget(html, 'simulation')).errors).toEqual([]);
      // A sequence must start at step 0 or later.
      expect(
        normalizeSimulationSpec({
          ...base,
          plot: {
            xLabel: 'k',
            xMin: -3,
            xMax: 5,
            curves: [{ label: 'x', start: 'x0', expr: 'y/2' }],
          },
        })?.plot,
      ).toBeUndefined();
    },
    T,
  );
});

describe('canvas that ignores its sliders', () => {
  it(
    'reports a graph drawn once that never redraws when the slider moves',
    async () => {
      const frozen = page(
        `<input type="range" id="slope-slider" min="-5" max="5" value="1"><span id="v"></span><canvas id="c"></canvas>
<script>const ctx=document.getElementById('c').getContext('2d');ctx.beginPath();ctx.lineTo(10,10);ctx.stroke();
document.getElementById('slope-slider').addEventListener('input',e=>{document.getElementById('v').textContent=e.target.value;});</script>`,
      );
      expect((await smokeTestWidget(frozen, 'simulation')).errors.join()).toContain('没有重绘');
      // Redrawing on input passes.
      expect((await smokeTestWidget(WORKING, 'simulation')).errors).toEqual([]);
    },
    T,
  );
});

describe('the last-resort page reads as a positive activity', () => {
  it(
    'is a core-logic breakdown to trace by hand, never a failure notice',
    async () => {
      const html = renderConceptStepsWidget(
        '梯度下降算法',
        ['初始化参数', '计算梯度'],
        'zh-CN',
        'simulation',
        'algorithm',
      );
      expect(html).toContain('算法核心逻辑剖析与手算追踪清单');
      expect(html).toContain('标记为已手算');
      expect(html).not.toMatch(/无法|失败|未能|could not|failed/i);
      expect((await smokeTestWidget(html, 'simulation')).errors).toEqual([]);
      const concept = renderConceptStepsWidget('光合作用', ['光反应'], 'en', 'game');
      expect(concept).toContain('Key Concepts Breakdown');
    },
    T,
  );
});

describe('blank canvas check scope', () => {
  it(
    'does not apply to games',
    async () => {
      const blank = page(
        `<button onclick="go()">开始</button><canvas id="c"></canvas><script>function go(){}</script>`,
      );
      expect((await smokeTestWidget(blank, 'game')).errors).toEqual([]);
    },
    T,
  );
});

describe('graphs defined on part of the axis, and graphs the sliders do not move', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  // The reported page: asin and b*acos drawn on [-5, 5], atan without parameters.
  const REPORTED = {
    title: '反三角函数的实数示例',
    intro: '通过调整参数观察反三角函数的变化',
    parameters: [
      { id: 'a', label: '角度参数', min: -3.14, max: 3.14, step: 0.01, default: -0.47 },
      { id: 'b', label: '倍数参数', min: -3, max: 3, step: 1, default: -1 },
    ],
    plot: {
      xLabel: 'x',
      xMin: -5,
      xMax: 5,
      curves: [
        { label: 'y = asin(x)', expr: 'asin(x)' },
        { label: 'y = b * acos(x)', expr: 'b*acos(x)' },
        { label: 'y = atan(x)', expr: 'atan(x)' },
      ],
    },
    outputs: [{ label: '反余弦值', expr: 'acos(sin(a))' }],
    observations: [],
  };

  it('keeps curves defined on part of the axis', () => {
    const spec = normalizeSimulationSpec(REPORTED)!;
    expect(spec.plot?.curves.map((c) => c.expr)).toEqual(['asin(x)', 'b*acos(x)', 'atan(x)']);
    expect(plotRespondsToSliders(spec)).toBe(true);
  });

  it('narrows the axis to where every curve is defined', () => {
    const only = normalizeSimulationSpec({
      ...REPORTED,
      plot: { ...REPORTED.plot, curves: [{ label: 'asin', expr: 'a*asin(x)' }] },
    })!;
    expect(only.plot!.xMin).toBeGreaterThanOrEqual(-1.2);
    expect(only.plot!.xMax).toBeLessThanOrEqual(1.2);
  });

  it('asks again when no curve follows the sliders', async () => {
    const frozen = {
      ...REPORTED,
      plot: { ...REPORTED.plot, curves: [{ label: 'atan', expr: 'atan(x)' }] },
    };
    expect(plotRespondsToSliders(normalizeSimulationSpec(frozen)!)).toBe(false);
    const outlineF = {
      ...inverseOutline,
      widgetOutline: { concept: '反三角函数' },
    } as SceneOutline;
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(frozen))
      .mockResolvedValueOnce(JSON.stringify(REPORTED));
    const spec = await planSimulationDesign({ outline: outlineF, aiCall, log });
    expect(aiCall.mock.calls[1]![1]).toContain('没有任何曲线使用滑块参数');
    expect(spec?.plot?.curves).toHaveLength(3);
  });
});

describe('reads of page state before it exists', () => {
  it(
    'reports state.running read before state is created, but not unmodelled browser APIs',
    async () => {
      const reported = page(
        `<input type="range" id="angle-slider"><button onclick="start()">启动</button><canvas id="c"></canvas><script>
let state;const ctx=document.getElementById('c').getContext('2d');
function reset(){state={running:false,angle:0};}
function init(){ if(!state.running){ ctx.fillRect(0,0,1,1);} }
function start(){ state.running=true; }
init(); reset();</script>`,
      );
      expect((await smokeTestWidget(reported, 'simulation')).errors.join()).toContain(
        "reading 'running'",
      );
      const gap = page(
        `<button onclick="go()">go</button><canvas id="c"></canvas><script>const ctx=document.getElementById('c').getContext('2d');ctx.fillRect(0,0,1,1);function go(){}
const o={};try{o.missing.ready;}catch(e){} window.someApi && window.someApi.ready;</script>`,
      );
      expect((await smokeTestWidget(gap, 'simulation')).errors).toEqual([]);
    },
    T,
  );
});

describe('game answers are checked before students see them', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  // The reported round: marked 机械能, explained as 化学能.
  const WRONG = {
    title: '光合作用挑战',
    intro: '测试你的知识',
    rounds: [
      {
        prompt: '叶绿体产生的能量类型是什么？',
        options: ['热能', '光能', '化学能', '机械能'],
        answer: 3,
        explain: '叶绿体通过光合作用将光能转化为化学能，储存在糖类中。',
      },
      {
        prompt: '光合作用释放的气体是？',
        options: ['氧气', '二氧化碳', '氮气'],
        answer: 0,
        explain: '光合作用释放氧气。',
      },
      {
        prompt: '光合作用主要发生在？',
        options: ['叶绿体', '线粒体', '细胞核'],
        answer: 1,
        explain: '光反应和暗反应都在细胞器中进行。',
      },
    ],
  };

  it('corrects an answer the explanation contradicts and drops unresolved disagreements', async () => {
    const spec = normalizeGameSpec(WRONG)!;
    const aiCall = vi.fn().mockResolvedValue('{"answers":[2,0,0]}');
    const checked = (await crossCheckGame(spec, { aiCall, log }))!;
    expect(checked.rounds[0]!.answer).toBe(2);
    expect(checked.rounds[0]!.options[2]).toBe('化学能');
    expect(checked.rounds[1]!.answer).toBe(0);
    // Round 3: solver says 叶绿体, author 线粒体, explanation names neither: dropped.
    expect(checked.rounds).toHaveLength(2);
    // The solver never sees the author's answers.
    expect(aiCall.mock.calls[0]![1]).not.toContain('"answer"');
  });

  it('without a usable reply keeps only rounds whose explanation does not contradict the answer', async () => {
    const spec = normalizeGameSpec(WRONG)!;
    const aiCall = vi.fn().mockResolvedValue('no json');
    const checked = (await crossCheckGame(spec, { aiCall, log }))!;
    expect(checked.rounds.map((r) => r.prompt)).not.toContain('叶绿体产生的能量类型是什么？');
    expect(checked.rounds).toHaveLength(2);
  });

  it('returns null when no round survives', async () => {
    const one = normalizeGameSpec({ ...WRONG, rounds: [WRONG.rounds[2], WRONG.rounds[2]] })!;
    const aiCall = vi.fn().mockResolvedValue('{"answers":[0,0]}');
    expect(await crossCheckGame(one, { aiCall, log })).toBeNull();
  });
});

describe("Newton's third law design (reported: the mass slider changed nothing, one curve hidden)", () => {
  const NEWTON = {
    title: '牛顿第三定律模拟',
    intro: '作用力与反作用力大小相等、方向相反。',
    parameters: [
      { id: 'm', label: '物体质量', min: 1, max: 10, step: 0.1, default: 5, unit: 'kg' },
      { id: 'F', label: '作用力', min: 0, max: 10, step: 0.1, default: 4, unit: 'N' },
    ],
    outputs: [],
    plot: {
      xLabel: '时间 (s)',
      xMin: 0,
      xMax: 10,
      curves: [
        { label: '作用力', expr: 'F*x' },
        { label: '反作用力', expr: 'F*x' },
      ],
    },
    observations: [],
  };
  it('leaves out a slider no formula uses, and draws a coinciding curve dashed', () => {
    const spec = normalizeSimulationSpec(NEWTON)!;
    expect(spec.parameters.map((p) => p.id)).toEqual(['F']);
    const html = renderSimulationWidget(spec, 'zh-CN', '牛顿第三定律');
    expect(html).not.toContain('物体质量');
    expect(html).toContain('setLineDash(hidden ? [10, 8] : [])');
  });
});

describe('a broken diagram page (reported: a "我理解了" checklist instead of a simulator)', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  it(
    'becomes a planned simulator on the topic, not a checklist',
    async () => {
      const aiCall = vi
        .fn()
        .mockResolvedValueOnce('no html')
        .mockResolvedValueOnce('still no html')
        .mockResolvedValue(JSON.stringify(SIM_SPEC));
      const result = await ensureRunnableWidget({
        content: { html: UNDEFINED_GLOBAL, widgetType: 'diagram' },
        outline: outline('diagram'),
        aiCall,
        log,
      });
      expect(result.html).toContain('k-slider');
      expect(result.html).not.toContain('我理解了');
    },
    T,
  );
});
