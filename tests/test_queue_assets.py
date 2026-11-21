"""Execute only developer-owned fixtures, with an independent deque oracle."""
from collections import deque
from itertools import product
from queue_assets import queue_guide
from autonomous_tasks import contextual_task
from lab_assembly import normalize_generated_draft, assemble_lab


def test_linked_queue_reference_covers_every_short_operation_sequence():
    draft=normalize_generated_draft(queue_guide('链队列入队出队清空'))
    scope={};exec(draft.reference_solution,scope)
    solve=scope['Solution']().solve
    for size in range(5):
        for ops in product(['ENQUEUE 0','ENQUEUE -2','DEQUEUE','CLEAR'],repeat=size):
            queue=deque();states=[]
            for op in ops:
                if op.startswith('ENQUEUE'):queue.append(int(op.split()[1]))
                elif op=='DEQUEUE':
                    if queue:queue.popleft()
                else:queue.clear()
                states.append(' '.join(map(str,queue)) if queue else 'EMPTY')
            assert solve(list(ops))==states
    for case in draft.public_test_cases+draft.hidden_test_cases:
        assert solve(**case.inputs)==case.expected
    assert assemble_lab(draft,'fifo-review')


def test_applied_queue_has_distinct_rules_and_consistent_examples():
    base=queue_guide('链队列')
    task=contextual_task(base,'链队列')
    scope={};exec(task.reference_solution,scope)
    for case in task.public_test_cases+task.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs)==case.expected
    assert task.public_test_cases[0].inputs!=task.public_test_cases[1].inputs
    assert task.public_test_cases[0].expected!=task.public_test_cases[1].expected
    assert task.title!=base.title
    assert queue_guide('优先队列最短路径') is None
