/**
 * Maintained simulation designs for topics whose model-planned designs proved
 * unreliable (a small local model wrote a 265% "efficiency" and an oxygen curve
 * that oscillates negative over a day for 光合作用). A preset is rendered by the
 * same tested platform template as a planned design, so the page looks the
 * same; only the science is fixed and checked.
 */
import type { FallbackLanguage, SimulationSpec } from './widget-fallback';

// Simplified leaf model (values illustrative, shapes textbook-correct):
// maximum rate saturates with CO₂ and peaks at an optimum temperature (25 °C);
// gross rate saturates with light; respiration rises with temperature (Q10 = 2);
// net = gross − respiration, negative in the dark, zero at the compensation point.
const PMAX = '40*C/(C+300)*exp(-((T-25)/10)^2)';
const RESP = '2*pow(2,(T-25)/10)';
const gross = (light: string) => `${PMAX}*${light}/(${light}+400)`;

type Text = {
  title: string;
  intro: string;
  light: string;
  co2: string;
  temp: string;
  net: string;
  gross: string;
  resp: string;
  enzyme: string;
  xLabel: string;
  observations: string[];
};

const TEXT: Record<FallbackLanguage, Text> = {
  'zh-CN': {
    title: '光合作用模拟器',
    intro:
      '拖动光照强度、二氧化碳浓度和温度，观察光合速率曲线如何变化；圆点表示当前光照下的速率。速率单位 μmol·m⁻²·s⁻¹（简化模型，数值为示意）。',
    light: '光照强度',
    co2: '二氧化碳浓度',
    temp: '温度',
    net: '净光合速率（CO₂ 吸收）',
    gross: '总光合速率',
    resp: '呼吸速率（CO₂ 释放）',
    enzyme: '酶活性（相对最适温度）',
    xLabel: '光照强度 (μmol·m⁻²·s⁻¹)',
    observations: [
      '光照为 0 时净光合速率为负：叶片只进行呼吸作用，释放 CO₂。',
      '净光合速率曲线与横轴的交点是光补偿点；光照继续增强，速率逐渐趋于饱和（光饱和）。',
      '提高 CO₂ 浓度会抬高曲线的上限；温度偏离 25 °C 时光合速率下降，而呼吸速率随温度升高而增大。',
    ],
  },
  'zh-TW': {
    title: '光合作用模擬器',
    intro:
      '拖動光照強度、二氧化碳濃度和溫度，觀察光合速率曲線如何變化；圓點表示目前光照下的速率。速率單位 μmol·m⁻²·s⁻¹（簡化模型，數值為示意）。',
    light: '光照強度',
    co2: '二氧化碳濃度',
    temp: '溫度',
    net: '淨光合速率（CO₂ 吸收）',
    gross: '總光合速率',
    resp: '呼吸速率（CO₂ 釋放）',
    enzyme: '酵素活性（相對最適溫度）',
    xLabel: '光照強度 (μmol·m⁻²·s⁻¹)',
    observations: [
      '光照為 0 時淨光合速率為負：葉片只進行呼吸作用，釋放 CO₂。',
      '淨光合速率曲線與橫軸的交點是光補償點；光照繼續增強，速率逐漸趨於飽和（光飽和）。',
      '提高 CO₂ 濃度會抬高曲線的上限；溫度偏離 25 °C 時光合速率下降，而呼吸速率隨溫度升高而增大。',
    ],
  },
  en: {
    title: 'Photosynthesis Simulator',
    intro:
      'Drag light intensity, CO₂ concentration and temperature and watch the photosynthesis rate curves change; the dots mark the rate at the current light. Rates in μmol·m⁻²·s⁻¹ (simplified model, illustrative values).',
    light: 'Light intensity',
    co2: 'CO₂ concentration',
    temp: 'Temperature',
    net: 'Net photosynthesis (CO₂ uptake)',
    gross: 'Gross photosynthesis',
    resp: 'Respiration (CO₂ release)',
    enzyme: 'Enzyme activity (vs. optimum)',
    xLabel: 'Light intensity (μmol·m⁻²·s⁻¹)',
    observations: [
      'In the dark the net rate is negative: the leaf only respires and releases CO₂.',
      'Where the net curve crosses zero is the light compensation point; with more light the rate levels off (light saturation).',
      'More CO₂ raises the plateau; away from 25 °C photosynthesis slows, while respiration keeps rising with temperature.',
    ],
  },
};

function photosynthesis(lang: FallbackLanguage): SimulationSpec {
  const t = TEXT[lang];
  return {
    title: t.title,
    intro: t.intro,
    parameters: [
      { id: 'I', label: t.light, min: 0, max: 2000, step: 50, default: 800, unit: 'μmol·m⁻²·s⁻¹' },
      { id: 'C', label: t.co2, min: 0, max: 1200, step: 20, default: 400, unit: 'ppm' },
      { id: 'T', label: t.temp, min: 0, max: 45, step: 1, default: 25, unit: '°C' },
    ],
    outputs: [
      { label: t.net, expr: `${gross('I')}-${RESP}` },
      { label: t.resp, expr: RESP },
      { label: t.enzyme, expr: 'exp(-((T-25)/10)^2)', format: 'percent' },
    ],
    plot: {
      xLabel: t.xLabel,
      xMin: 0,
      xMax: 2000,
      curves: [
        { label: t.net, expr: `${gross('x')}-${RESP}` },
        { label: t.gross, expr: gross('x') },
      ],
      markerParam: 'I',
    },
    observations: t.observations,
  };
}

// Gradient descent on f(x) = (x − 2)², minimum at x* = 2: x ← x − η·f'(x),
// so the error shrinks by |1 − 2η| each step (η < 0.5 smooth, 0.5–1 oscillating,
// above 1 diverging). Drawn step by step as sequences.
const GD_TEXT: Record<
  FallbackLanguage,
  {
    title: string;
    intro: string;
    eta: string;
    x0: string;
    xk: string;
    loss: string;
    opt: string;
    shrink: string;
    after: string;
    xLabel: string;
    observations: string[];
  }
> = {
  'zh-CN': {
    title: '梯度下降模拟器',
    intro:
      '用梯度下降求 f(x)=(x−2)² 的最小值：每一步 x ← x − 学习率 × f′(x)。拖动学习率和初始值，观察每一步的 x 和损失如何变化。',
    eta: '学习率 η',
    x0: '初始值 x₀',
    xk: '参数 x（每步）',
    loss: '损失 f(x)（每步）',
    opt: '最优解 x* = 2',
    shrink: '每步误差收缩倍数 |1−2η|',
    after: '20 步后的损失',
    xLabel: '迭代步数',
    observations: [
      '学习率小于 0.5 时，x 平稳地靠近最优解 2，损失单调下降。',
      '学习率在 0.5 到 1 之间时，x 在最优解两侧来回振荡，但仍会收敛；等于 0.5 时一步就到达最优解。',
      '学习率大于 1 时每一步都越过得更远，算法发散——学习率不能太大。',
    ],
  },
  'zh-TW': {
    title: '梯度下降模擬器',
    intro:
      '用梯度下降求 f(x)=(x−2)² 的最小值：每一步 x ← x − 學習率 × f′(x)。拖動學習率和初始值，觀察每一步的 x 和損失如何變化。',
    eta: '學習率 η',
    x0: '初始值 x₀',
    xk: '參數 x（每步）',
    loss: '損失 f(x)（每步）',
    opt: '最優解 x* = 2',
    shrink: '每步誤差收縮倍數 |1−2η|',
    after: '20 步後的損失',
    xLabel: '迭代步數',
    observations: [
      '學習率小於 0.5 時，x 平穩地靠近最優解 2，損失單調下降。',
      '學習率在 0.5 到 1 之間時，x 在最優解兩側來回振盪，但仍會收斂；等於 0.5 時一步就到達最優解。',
      '學習率大於 1 時每一步都越過得更遠，演算法發散——學習率不能太大。',
    ],
  },
  en: {
    title: 'Gradient Descent Simulator',
    intro:
      'Gradient descent minimising f(x) = (x−2)²: each step x ← x − learning rate × f′(x). Drag the learning rate and the starting value and watch x and the loss step by step.',
    eta: 'Learning rate η',
    x0: 'Starting value x₀',
    xk: 'Parameter x (per step)',
    loss: 'Loss f(x) (per step)',
    opt: 'Optimum x* = 2',
    shrink: 'Error shrink factor per step |1−2η|',
    after: 'Loss after 20 steps',
    xLabel: 'Iteration',
    observations: [
      'Below 0.5, x approaches the optimum 2 smoothly and the loss falls every step.',
      'Between 0.5 and 1, x overshoots back and forth but still converges; at exactly 0.5 it lands in one step.',
      'Above 1 every step overshoots further and the method diverges: the learning rate must not be too large.',
    ],
  },
};

function gradientDescent(lang: FallbackLanguage): SimulationSpec {
  const t = GD_TEXT[lang];
  return {
    title: t.title,
    intro: t.intro,
    parameters: [
      { id: 'eta', label: t.eta, min: 0.05, max: 1.05, step: 0.05, default: 0.2 },
      { id: 'x0', label: t.x0, min: -8, max: 8, step: 0.5, default: 6 },
    ],
    outputs: [
      { label: t.shrink, expr: 'abs(1-2*eta)' },
      { label: t.after, expr: '(x0-2)^2*pow(1-2*eta,40)' },
    ],
    plot: {
      xLabel: t.xLabel,
      xMin: 0,
      xMax: 20,
      curves: [
        { label: t.xk, start: 'x0', expr: 'y-eta*2*(y-2)' },
        { label: t.loss, start: '(x0-2)^2', expr: 'y*(1-2*eta)^2' },
        { label: t.opt, expr: '2+0*x' },
      ],
    },
    observations: t.observations,
  };
}

/** Stoichiometry is exact; the first-order rate law is an illustrative model,
 * not a claim about a measured organism. Oxygen is continuously supplied. */
function cellularRespiration(lang: FallbackLanguage): SimulationSpec {
  const en = lang === 'en';
  const converted = '(G*(1-exp(-0.2*O/(O+1)*x)))';
  return {
    title: en ? 'Aerobic cellular respiration' : '有氧细胞呼吸模拟',
    intro: en
      ? 'C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + released energy. Oxygen concentration is held constant by continuous supply. This simplified kinetic model illustrates substrate consumption, not an exact biological rate or ATP yield.'
      : 'C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + 释放的能量。持续供氧使氧浓度保持恒定；简化动力学仅用于观察底物消耗，不代表真实生物的精确速率或 ATP 产量。',
    parameters: [
      {
        id: 'G',
        label: en ? 'Initial glucose in a 1 L system' : '1 L 体系的初始葡萄糖量',
        min: 0,
        max: 10,
        step: 0.5,
        default: 2,
        unit: 'mmol',
      },
      {
        id: 'O',
        label: en ? 'Maintained oxygen concentration' : '持续维持的氧浓度',
        min: 0,
        max: 10,
        step: 0.5,
        default: 2,
        unit: 'mmol/L',
      },
    ],
    outputs: [
      {
        label: en ? 'Glucose remaining after 10 min (mmol)' : '10 分钟后剩余葡萄糖（mmol）',
        expr: 'G*exp(-0.2*O/(O+1)*10)',
      },
      {
        label: en ? 'CO₂ released after 10 min (mmol)' : '10 分钟后释放的 CO₂（mmol）',
        expr: '6*G*(1-exp(-0.2*O/(O+1)*10))',
      },
    ],
    plot: {
      xLabel: en ? 'Time (min)' : '时间（min）',
      xMin: 0,
      xMax: 20,
      curves: [
        {
          label: en ? 'Glucose remaining (mmol)' : '剩余葡萄糖（mmol）',
          expr: 'G*exp(-0.2*O/(O+1)*x)',
        },
        { label: en ? 'CO₂ released (mmol)' : '释放 CO₂（mmol）', expr: `6*${converted}` },
      ],
    },
    observations: en
      ? [
          'With no supplied oxygen, this aerobic pathway stops; anaerobic pathways are outside this model.',
          'For each mmol of glucose consumed completely, 6 mmol of CO₂ are released. Oxygen concentration is externally maintained, not a finite reservoir.',
          'Energy is released by cellular respiration; this page does not model lung ventilation or blood circulation.',
        ]
      : [
          '氧浓度为 0 时，本模型的有氧途径停止；无氧代谢不在本模型范围内。',
          '每完全分解 1 mmol 葡萄糖释放 6 mmol CO₂；氧浓度由外部供给维持，不能将它误当成有限的氧气库存。',
          '细胞呼吸释放能量；本页不模拟肺部通气或血液循环。',
        ],
  };
}

const PRESETS: Array<{ topic: RegExp; build: (lang: FallbackLanguage) => SimulationSpec }> = [
  { topic: /光合作用|光合速率|光合|photosynthe/i, build: photosynthesis },
  { topic: /梯度下降|gradient\s*descent/i, build: gradientDescent },
  {
    topic: /呼吸作用|细胞呼吸|細胞呼吸|cellular\s+respiration|aerobic\s+respiration|^respiration$/i,
    build: cellularRespiration,
  },
];

/** The maintained design for a simulation about this topic, if there is one. */
export function presetSimulationDesign(
  topic: string,
  lang: FallbackLanguage,
): SimulationSpec | null {
  const preset = PRESETS.find((p) => p.topic.test(topic));
  return preset ? preset.build(lang) : null;
}
