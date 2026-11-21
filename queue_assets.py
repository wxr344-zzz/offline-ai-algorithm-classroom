"""Audited FIFO exercises; these assets do not control course routing."""
import re
from lab_contracts import LabDraft, TestCase, TeachingStep


def is_linked_queue(text):
    return bool(re.search(r'链队列|linked\s+queue',text,re.I))


REFERENCE='''class Solution:
    def solve(self, operations: list[str]) -> list[str]:
        class Node:
            def __init__(self, value):
                self.value = value
                self.next = None
        head = None
        tail = None
        states = []
        for operation in operations:
            parts = operation.split()
            if parts[0] == 'ENQUEUE':
                node = Node(int(parts[1]))
                if tail is None:
                    head = node
                else:
                    tail.next = node
                tail = node
            elif parts[0] == 'DEQUEUE':
                if head is not None:
                    head = head.next
                    if head is None:
                        tail = None
            elif parts[0] == 'CLEAR':
                head = None
                tail = None
            current = head
            values = []
            while current is not None:
                values.append(str(current.value))
                current = current.next
            states.append(' '.join(values) if values else 'EMPTY')
        return states
'''


def queue_guide(requirement):
    if not is_linked_queue(requirement): return None
    examples=[(['ENQUEUE 3','ENQUEUE 5','DEQUEUE','CLEAR'],['3','3 5','5','EMPTY']),
        (['DEQUEUE','CLEAR'],['EMPTY','EMPTY']),([],[]),
        (['ENQUEUE 1','DEQUEUE','ENQUEUE 2'],['1','EMPTY','2']),
        (['ENQUEUE 0','ENQUEUE 0'],['0','0 0']),
        (['ENQUEUE -2','CLEAR','ENQUEUE 7'],['-2','EMPTY','7']),
        (['ENQUEUE 1','CLEAR','CLEAR'],['1','EMPTY','EMPTY'])]
    cases=[TestCase(case_id=f'fifo-{i}',inputs={'operations':ops},expected=states,
        description='逐条执行操作，核对每一步从队头到队尾的状态。') for i,(ops,states) in enumerate(examples)]
    return LabDraft(title='链队列：入队、出队与清空',
        instructions='使用链表实现队列，初始为空。operations 是操作字符串列表：ENQUEUE x 将整数 x 加入队尾；DEQUEUE 删除队头，空队列时保持为空；CLEAR 清空队列。每执行一条操作，记录从队头到队尾的整数，以一个空格连接；空队列记录 EMPTY。返回所有记录组成的字符串列表，记录数必须等于操作数。空操作列表返回空列表。',
        scaffold_code='class Solution:\n    def solve(self, operations: list[str]) -> list[str]:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=REFERENCE,difficulty='Easy',
        constraints=['0 <= 操作数 <= 100；入队值为 -1000 到 1000 的整数','操作只可能为 ENQUEUE x、DEQUEUE、CLEAR'],
        teaching_steps=[TeachingStep(step_id='enqueue',title='维护队尾',instruction='创建节点并连接到队尾；空队列入队时同时更新头尾。',hint='末节点的 next 为 None。'),
            TeachingStep(step_id='dequeue',title='维护队头',instruction='出队后若队列变空，也要清空尾指针。',hint='删除最后一个节点后 head 和 tail 都为 None。'),
            TeachingStep(step_id='clear',title='清空并记录状态',instruction='清空头尾指针，每次操作后遍历记录队列。',hint='清空之后应仍能再次入队。')],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])


SERVICE_BODY='''lines = stdin.strip().splitlines()
capacity, count = map(int, lines[0].split())
queue = []
registered = set()
output = []
for line in lines[1:count + 1]:
    parts = line.split()
    if parts[0] == 'ARRIVE':
        person = int(parts[1])
        if person in registered:
            output.append('DUPLICATE')
        elif len(queue) == capacity:
            output.append('FULL')
        else:
            registered.add(person)
            queue.append(person)
            output.append('OK')
    elif parts[0] == 'SERVE':
        output.append(str(queue.pop(0)) if queue else 'EMPTY')
    else:
        queue.clear()
        output.append('CLEARED')
return '\\n'.join(output)
'''


def service_examples():
    return [('2 5\nARRIVE 8\nARRIVE 9\nARRIVE 10\nSERVE\nSERVE','OK\nOK\nFULL\n8\n9'),
        ('3 5\nARRIVE 8\nARRIVE 9\nARRIVE 10\nSERVE\nSERVE','OK\nOK\nOK\n8\n9'),
        ('1 4\nARRIVE 7\nSERVE\nARRIVE 7\nSERVE','OK\n7\nDUPLICATE\nEMPTY'),
        ('0 2\nARRIVE 1\nSERVE','FULL\nEMPTY'),
        ('2 4\nARRIVE 1\nCLEAR\nSERVE\nARRIVE 2','OK\nCLEARED\nEMPTY\nOK'),
        ('2 0',''),('1 3\nARRIVE 5\nARRIVE 5\nSERVE','OK\nDUPLICATE\n5')]
