"""Reviewed BST operation contract. No model-generated implementation is run."""
import re
from lab_contracts import LabDraft, TestCase, TeachingStep
from lab_assembly import normalize_generated_draft


BST_BODY = '''        root = None
        def insert(node, key):
            if node is None:
                return [key, None, None]
            if key < node[0]:
                node[1] = insert(node[1], key)
            elif key > node[0]:
                node[2] = insert(node[2], key)
            return node
        def remove(node, key):
            if node is None:
                return None
            if key < node[0]:
                node[1] = remove(node[1], key)
            elif key > node[0]:
                node[2] = remove(node[2], key)
            else:
                if node[1] is None:
                    return node[2]
                if node[2] is None:
                    return node[1]
                successor = node[2]
                while successor[1] is not None:
                    successor = successor[1]
                node[0] = successor[0]
                node[2] = remove(node[2], successor[0])
            return node
        log = []
        for key in nums:
            root = insert(root, key)
            log.append('插入 ' + str(key))
        for key in nums:
            root = remove(root, key)
            log.append('删除 ' + str(key))
        for key in nums:
            current = root
            while current is not None and current[0] != key:
                current = current[1] if key < current[0] else current[2]
            log.append('查找 ' + str(key) + (' 成功' if current is not None else ' 失败'))
        return log
'''


def bst_guide(requirement: str):
    if not re.search(r'二叉排序树|\bBST\b|binary[ -]?search[ -]?tree', requirement, re.I):
        return None
    values = [[5,3,7,2,4,6,8], [10,5,15,3,7,12,18], [1,2,3,4,5], [], [3,3,1,5], [-1,0,-2], [1]]
    cases = [TestCase(case_id=f'bst-{i}', inputs={'nums': nums},
        expected=[f'插入 {v}' for v in nums] + [f'删除 {v}' for v in nums] + [f'查找 {v} 失败' for v in nums],
        description='先依次插入全部值，再依次删除全部值，最后依次查找原输入；空输入无操作。') for i, nums in enumerate(values)]
    return normalize_generated_draft(LabDraft(title='二叉排序树：插入、删除和查找',
        instructions='实现二叉排序树。初始树为空，严格分三轮按 nums 的原始顺序处理：第一轮插入全部值，记录“插入 v”；第二轮删除全部值，记录“删除 v”；第三轮查找全部原输入值，记录“查找 v 成功”或“查找 v 失败”。返回操作日志字符串列表。重复插入不增加节点，但仍记录操作；删除不存在的值不改变树，仍记录操作。第三轮开始时树已清空，因此查找均失败。空 nums 没有任何操作，返回 []，绝不能凭空操作数字0。',
        scaffold_code='class Solution:\n    def solve(self, nums: list[int]) -> list[str]:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution='class Solution:\n    def solve(self, nums: list[int]) -> list[str]:\n' + BST_BODY,
        difficulty='Medium', constraints=['0 <= len(nums) <= 100，元素为-1000到1000的整数；树内不保存重复键'],
        teaching_steps=[TeachingStep(step_id='bst-operations', title='实现三个操作', instruction='插入遵守左小右大；双子节点删除使用中序后继；查找按键值选择子树。')],
        public_test_cases=cases[:4], hidden_test_cases=cases[4:]))
