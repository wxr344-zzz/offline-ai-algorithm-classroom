"""Owned AVL insertion kernel shared by teaching and compiled applications.

Only narratives are generated. Rotations, height maintenance and answers are
not delegated to a language model.
"""
import re
from lab_contracts import LabDraft, TestCase, TeachingStep
from lab_assembly import normalize_generated_draft


AVL_HELPERS = '''        def height(node):
            return 0 if node is None else node[3]
        def update(node):
            node[3] = 1 + max(height(node[1]), height(node[2]))
        def rotate_left(node):
            child = node[2]
            node[2] = child[1]
            child[1] = node
            update(node)
            update(child)
            return child
        def rotate_right(node):
            child = node[1]
            node[1] = child[2]
            child[2] = node
            update(node)
            update(child)
            return child
        def insert(node, key):
            if node is None:
                return [key, None, None, 1]
            if key < node[0]:
                node[1] = insert(node[1], key)
            elif key > node[0]:
                node[2] = insert(node[2], key)
            else:
                return node
            update(node)
            balance = height(node[1]) - height(node[2])
            if balance > 1:
                if key > node[1][0]:
                    node[1] = rotate_left(node[1])
                return rotate_right(node)
            if balance < -1:
                if key < node[2][0]:
                    node[2] = rotate_right(node[2])
                return rotate_left(node)
            return node
'''


def avl_guide(requirement):
    if not re.search(r'(?<![a-z])AVL(?![a-z])|平衡二叉树', requirement, re.I):
        return None
    # Four rotation families plus duplicates, empty and negative keys. These
    # expected root histories are independently hand calculated constants.
    examples = [([30,20,10],[30,30,20]), ([10,20,30],[10,10,20]),
                ([30,10,20],[30,30,20]), ([10,30,20],[10,10,20]),
                ([],[]), ([5,5,5],[5,5,5]), ([-1,-3,-2],[-1,-1,-2]),
                ([20,10,30,5,15,25,35],[20,20,20,20,20,20,20])]
    cases = [TestCase(case_id=f'avl-root-{i}', inputs={'nums': values}, expected=roots,
        description='按输入顺序插入；每次完成高度更新及必要旋转后记录当前根键，重复键不新增节点。')
        for i,(values,roots) in enumerate(examples)]
    body = AVL_HELPERS + '''        root = None
        roots = []
        for key in nums:
            root = insert(root, key)
            roots.append(root[0])
        return roots
'''
    return normalize_generated_draft(LabDraft(title='AVL 动态插入与根节点变化',
        instructions='从空 AVL 树开始，按 nums 的顺序逐一插入整数键。重复键不新增节点。每次插入后先更新高度，再自底向上检查平衡；平衡因子为左子树高度减右子树高度，绝对值超过1才旋转，分别处理 LL、RR、LR、RL。每次操作完成后记录根节点键，返回这一整数列表，长度等于输入长度。空输入返回 []。',
        scaffold_code='class Solution:\n    def solve(self, nums: list[int]) -> list[int]:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution='class Solution:\n    def solve(self, nums: list[int]) -> list[int]:\n'+body,
        difficulty='Medium', constraints=['至多200个整数键，范围-10000到10000；树中重复键只保留一个。'],
        teaching_steps=[TeachingStep(step_id='avl-insert',title='插入与旋转',
            instruction='先按二叉搜索树插入，再更新高度；只在平衡因子绝对值超过1时执行对应单旋或双旋。')],
        public_test_cases=cases[:4], hidden_test_cases=cases[4:]))


def avl_order_body(name, descending):
    # Index tie-breaks give every record a unique key, so duplicate measurements
    # are retained even though the guide teaches a set of distinct keys.
    return AVL_HELPERS + f'''        root = None
        for i in range(len({name})):
            root = insert(root, ({'-' if descending else ''}{name}[i], i))
        order = []
        pending = []
        node = root
        while node is not None or pending:
            while node is not None:
                pending.append(node)
                node = node[1]
            node = pending.pop()
            order.append(node[0][1])
            node = node[2]
'''
