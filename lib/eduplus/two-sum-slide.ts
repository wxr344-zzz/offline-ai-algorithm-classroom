import type { GeneratedSlideContent } from '@/lib/types/generation';

/** Native PPT elements with reviewed algorithm semantics and bounded geometry. */
export function twoSumSlide(phase: boolean | string = false): GeneratedSlideContent {
  const summary = typeof phase === 'boolean' ? phase : /总结|复盘/.test(phase);
  if (typeof phase === 'string' && /代码/.test(phase))
    return {
      background: { type: 'solid', color: '#ffffff' },
      elements: [
        { text: '两数之和：哈希表实现', top: 35, height: 65, size: 32 },
        {
          text: 'def two_sum(nums, target):\n    seen = {}\n    for i, value in enumerate(nums):\n        need = target - value\n        if need in seen:\n            return [seen[need], i]\n        seen[value] = i\n    return []',
          top: 120,
          height: 300,
          size: 22,
        },
        {
          text: '执行顺序：先查补数，再记录当前位置。返回不同下标；重复值也是两个不同位置。',
          top: 445,
          height: 75,
          size: 22,
        },
      ].map((block, i) => ({
        id: `two-sum-code-${i}`,
        type: 'text',
        left: 48,
        top: block.top,
        width: 904,
        height: block.height,
        rotate: 0,
        defaultFontName: i === 1 ? 'Consolas' : 'Microsoft YaHei',
        defaultColor: '#172033',
        content: `<p style="font-size:${block.size}px;line-height:1.3;margin:0">${block.text.replace(/ /g, '&nbsp;').replace(/\n/g, '<br>')}</p>`,
        lineHeight: 1.3,
      })),
    };
  const steps = typeof phase === 'string' && /步骤|思路|过程|算法介绍/.test(phase);
  const transfer = typeof phase === 'string' && /综合练习|迁移/.test(phase);
  const paragraphs = summary
    ? [
        '问题定义：返回两个不同位置的下标，使对应元素之和等于目标值。没有匹配时返回空列表。',
        '核心策略：先在哈希表中查找补数，再记录当前元素和下标，防止复用同一个位置。',
        '引导练习：找到一个下标对。独立迁移：在预算约束下选择最多两件露营物品，综合排序、双指针和边界处理。',
        '自查清单：重复值、负数、空数组、无解；确认返回下标而不是数值，并检查题面要求的顺序。',
      ]
    : transfer
      ? [
          '情境：露营采购，最多选择两件不同位置的物品，价格总和不能超过预算。目标是花费尽可能接近预算。',
          '与引导题的不同：引导题寻找恰好等于 target 的下标；自主题求不超过预算的最大总价，允许只买一件或不买。',
          '输入输出：第一行 n B，第二行 n 个价格；输出一个整数。请独立设计完整程序，不套用引导题函数。',
          '思考清单：排序后如何移动指针？重复价格怎样处理？没有可买物品、空列表和只有一件时应输出什么？',
        ]
      : steps
        ? [
            '初始化：建立空哈希表 seen，按从左到右的顺序读取 nums。',
            '求补数：当前 value = 2，target = 9，需要的数是 7。表中没有 7，记录 2 → 下标 0。',
            '下一步：当前 value = 7，需要的数是 2。表中已有 2 → 下标 0，因此返回 [0, 1]。',
            '边界分析：必须先查再记，不能复用当前位置；重复值可配对，例如 [3, 3]、target = 6。',
          ]
        : [
            '任务：给定整数数组 nums 和目标 target，返回不同下标 [i, j]，使 nums[i] + nums[j] = target。无解返回 []。',
            '示例：nums = [2, 7, 11, 15]，target = 9，答案为 [0, 1]。返回的是下标，不是数值 [2, 7]。',
            '逐步推演：读取当前数 → 计算补数 target − 当前数 → 查询已出现的数 → 未匹配时记录当前数及下标。',
            '为什么先查后记：避免重复使用同一个下标。哈希查找平均 O(1)，整体平均 O(n) 时间、O(n) 额外空间。',
          ];
  return {
    background: { type: 'solid', color: '#ffffff' },
    elements: [
      summary
        ? '两数之和：总结与迁移'
        : transfer
          ? '迁移练习：预算内的采购组合'
          : steps
            ? '两数之和：逐步执行与分支'
            : '两数之和：任务与算法思路',
      ...paragraphs,
    ].map((text, index) => ({
      id: `two-sum-text-${index}`,
      type: 'text' as const,
      left: 48,
      top: index === 0 ? 35 : 125 + (index - 1) * 98,
      width: 904,
      height: index === 0 ? 68 : 88,
      rotate: 0,
      defaultFontName: 'Microsoft YaHei',
      defaultColor: '#172033',
      content: `<p style="font-size:${index === 0 ? 32 : 22}px;line-height:1.4;margin:0">${text}</p>`,
      lineHeight: 1.4,
    })),
  };
}
