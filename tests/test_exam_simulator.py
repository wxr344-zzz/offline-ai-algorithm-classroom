import copy
import json
import random
import pytest
from exam_simulator import catalog, run_trace, resolve


def test_every_catalog_default_is_data_only_and_immutable():
    for p in catalog():
        original=copy.deepcopy(p['default'])
        trace=run_trace(p['id'],data=p['default'])
        assert p['default']==original
        assert trace['engine']=='python-deterministic' and trace['verified']
        assert trace['frames'] and all(f['views'] for f in trace['frames'])
        json.dumps(trace,allow_nan=False)
        initial=copy.deepcopy(trace['frames'][0])
        trace['frames'][-1]['views'].clear()
        if len(trace['frames'])>1:assert trace['frames'][0]==initial


def test_all_reviewed_english_catalog_titles_are_routable_without_generation():
    from exam_simulator.i18n import localize_text, HAN
    for profile in catalog():
        english=localize_text(profile['title'],'en')
        assert not HAN.search(english)
        assert resolve('Please explain '+english+' for me.')==profile['id']


@pytest.mark.parametrize('topic,key',[
    ('Please explain the Depth-First Search (DFS) algorithm for me.', 'dfs'),
    ('Please explain the Breadth-First Search (BFS) algorithm for me.', 'bfs'),
    ('depth first search','dfs'), ('breadth first search','bfs'),
])
def test_full_english_search_names_keep_the_maintained_graph_executor(topic,key):
    assert resolve(topic)==key
    assert run_trace(topic=topic)['verified']


@pytest.mark.parametrize('profile',catalog(),ids=lambda p:p['id'])
def test_every_registered_name_and_alias_round_trips_through_course_requirements(profile):
    for name in [profile['id'],profile['title']]+profile['aliases']:
        assert resolve(name)==profile['id']
        assert resolve('请为我讲解 '+name+'，并提供编程实验')==profile['id']
        # Polite request wrappers must not turn maintained names into dynamic code.
        assert resolve('Please explain '+name+' for me.')==profile['id']
        assert resolve('Could you explain '+name+' for me?')==profile['id']


@pytest.mark.parametrize('topic,key',[
    ('朴素模式匹配算法','naive-match'),('朴素字符串模式匹配','naive-match'),
    ('ＫＭＰ模式匹配算法','kmp'),('Ａｌｐｈａ－Ｂｅｔａ算法','alpha-beta'),
    ('ＫＭＰ扩展与周期判定','kmp-period'),('Ｂ＋树分裂与合并','b-plus-tree'),
])
def test_textbook_synonyms_and_fullwidth_names_keep_the_correct_executor(topic,key):
    assert resolve(topic)==key


@pytest.mark.parametrize('topic,key',[
    ('Please explain the basic operations of linked lists, including node insertion and deletion.', 'linked-list'),
    ('Please explain linked list for me.', 'linked-list'),
    ('singly linked lists', 'linked-list'),
    ('doubly linked lists', 'doubly-linked'),
    ('circular linked list', 'circular-linked'),
])
def test_natural_english_linked_list_requests_use_verified_operations(topic,key):
    assert resolve(topic)==key
    trace=run_trace(topic=topic,data={'array':[10,20,30],
        'operations':[['insert',2,25],['delete',1]]})
    assert trace['engine']=='python-deterministic'
    assert trace['outcome']==[10,25,30]
    assert trace['verified']


@pytest.mark.parametrize('topic',['primality testing','list intersection','quickselect','shellshock',
    'bidirectional Dijkstra','加权A*算法','双向冒泡排序算法','Fibonacci heap','双权Bellman-Ford算法',
    'Please explain bidirectional Dijkstra for me.', 'persistent linked list',
    'doubly circular linked lists'])
def test_ascii_substrings_do_not_replace_unknown_algorithms(topic):
    assert resolve(topic) is None


@pytest.mark.parametrize('kind',['bst','avl','splay','red-black','b-tree','b-plus-tree'])
def test_search_trees_random_insert_delete_search(kind):
    rng=random.Random(408)
    for trial in range(18):
        values=rng.sample(range(30),16)
        ops=[['insert',x] for x in values]
        rng.shuffle(values)
        ops += [['delete',x] for x in values]+[['search',40],['insert',9],['delete',40]]
        data={'operations':ops}
        if kind.startswith('b-'):data['order']=3+trial%4
        result=run_trace(kind,data=data)['outcome']
        assert result.get('inorder',result.get('keys'))==[9]
        assert result['searchResults']==[False]


@pytest.mark.parametrize('kind',['insertion','binary-insertion','shell','selection','bubble','quick','merge','heap-sort','counting','radix'])
def test_sort_permutations_and_duplicates(kind):
    rng=random.Random(912)
    for n in range(13):
        a=[rng.randrange(-6,7) for _ in range(n)]
        assert run_trace(kind,data={'array':a})['outcome']==sorted(a)


def test_alpha_beta_against_full_minimax_and_cut_condition():
    rng=random.Random(920)
    for _ in range(25):
        data={'tree':[[rng.randrange(-9,10) for _ in range(3)] for _ in range(3)]}
        a=run_trace('alpha-beta',data=data);m=run_trace('minimax',data=data)
        assert a['outcome']['value']==m['outcome']['value']
        for f in a['frames']:
            if '剪枝' in f['label']:
                assert f['state']['alpha']>=f['state']['beta']
    assert resolve('完全背包算法')=='complete-knapsack'


def test_lcs_rejects_hallucinated_subsequence():
    t=run_trace('lcs',data={'a':'ABC','b':'BAC'})
    assert t['outcome']['length']==2


@pytest.mark.parametrize('runs',[[[]],[[2,4]],[[1,3],[0,2],[2,8]], [[],[1],[],[-1,2]]])
def test_loser_tree_non_power_two_and_empty_runs(runs):
    assert run_trace('loser-tree',data={'runs':runs})['outcome']['sorted']==sorted(x for a in runs for x in a)


@pytest.mark.parametrize('kind',['avl','splay','red-black','b-tree','b-plus-tree'])
def test_random_interleaved_search_tree_operations(kind):
    rng=random.Random(845)
    for trial in range(50):
        operations=[[rng.choice(['insert','insert','delete','search']),rng.randrange(16)] for _ in range(35)]
        expected=set();search=[]
        for action,k in operations:
            if action=='insert':expected.add(k)
            elif action=='delete':expected.discard(k)
            else:search.append(k in expected)
        data={'operations':operations,'order':3+trial%4}
        result=run_trace(kind,data=data)['outcome']
        assert result.get('inorder',result.get('keys'))==sorted(expected)
        assert result['searchResults']==search


def test_dijkstra_floyd_mst_and_traversal_random_graphs():
    rng=random.Random(878)
    for _ in range(20):
        n=rng.randrange(2,7)
        edges=[[u,v,rng.randrange(0,12)] for u in range(n) for v in range(u+1,n) if rng.random()<.55]
        data={'n':n,'edges':edges,'directed':False,'start':0,'allComponents':True}
        a=run_trace('dijkstra',data=data)['outcome']['distances']
        f=run_trace('floyd',data=data)['outcome']
        assert a==f[0]
        for kind in ['prim','kruskal','bfs','dfs']:assert run_trace(kind,data=data)['verified']


def test_internal_simulation_api_auth_input_and_no_model_use():
    from fastapi.testclient import TestClient
    from agent_api import create_app,APISettings
    async def forbidden(*args):pytest.fail('模型不可参与确定性推演')
    token='simulator-test-token-at-least-32-characters'
    with TestClient(create_app(APISettings(service_token=token),runner=forbidden,teaching_runner=forbidden)) as c:
        path='/internal/v1/simulations'
        assert c.get(path).status_code==401
        headers={'Authorization':'Bearer '+token}
        assert len(c.get(path,headers=headers).json()['profiles'])>=70
        r=c.post(path+'/trace',headers=headers,json={'topic':'完全背包算法'})
        assert r.status_code==200 and r.json()['algorithm']=='complete-knapsack'
        for body in [{'algorithm':'__import__'},{'algorithm':'alpha-beta','input':{'tree':[False,True]}},{'algorithm':'binary','input':{'array':[3,1],'target':1}},{'code':'print(1)'}]:
            assert c.post(path+'/trace',headers=headers,json=body).status_code==400

@pytest.mark.parametrize('topic,key',[
    ('完全背包算法','complete-knapsack'),('Dijkstra 双权值最短路','dual-dijkstra'),('并查集带权与路径压缩','weighted-dsu'),('B+树分裂与合并','b-plus-tree'),('B-树删除','b-tree'),('AVL树旋转','avl'),('红黑树','red-black'),('KMP扩展与周期判定','kmp-period'),('0/1 背包动态规划算法','knapsack-01'),('Alpha-Beta算法','alpha-beta'),('A*算法','astar'),('矩阵链乘','matrix-chain'),('外排序与败者树','loser-tree'),('迪杰斯特拉算法','dijkstra'),('克鲁斯卡尔算法','kruskal'),('普里姆算法','prim'),('最长公共子序列LCS算法','lcs')])
def test_specific_algorithm_variant_is_never_replaced_by_base(topic,key):
    assert resolve(topic)==key

def test_expression_precedence_parentheses_and_operand_order():
    assert run_trace('expression-stack',data={'expression':'10 - 6 / 2 * (3 - 1)'})['outcome']['value']==4
    for source in ['1 +','1(2)','(1+2','3/0','__import__(x)']:
        with pytest.raises(ValueError):run_trace('expression-stack',data={'expression':source})

def test_frontend_routing_catalog_matches_python_registry():
    from pathlib import Path
    from exam_simulator.catalog_snapshot import snapshot
    path=Path(__file__).resolve().parents[1]/'lib/eduplus/exam-simulator-catalog.json'
    assert json.loads(path.read_text(encoding='utf-8'))==snapshot()


def test_greedy_best_first_expands_by_heuristic_only_and_may_miss_the_shortest_path():
    assert resolve('请为我讲解贪婪最佳优先算法')=='greedy-best-first'
    assert resolve('讲解A*算法')=='astar'
    trace=run_trace('greedy-best-first')
    # h favours node 1 (h=2) over node 2 (h=4): the path costs 12 while the shortest costs 7.
    assert trace['outcome']==[0,1,3,4]
    assert '最短路径代价是7' in trace['frames'][-1]['explanation']
    unreachable=dict(n=3,edges=[[0,1,1]],directed=True,start=0,goal=2,heuristic=[1,1,0])
    assert run_trace('greedy-best-first',data=unreachable)['outcome']==[]
    # Equal h: the smaller node number is expanded first.
    tie=dict(n=4,edges=[[0,2,1],[0,1,1],[1,3,1],[2,3,1]],directed=True,start=0,goal=3,heuristic=[2,1,1,0])
    assert run_trace('greedy-best-first',data=tie)['outcome']==[0,1,3]


def test_app_routing_rules_and_resolutions_match_the_registry():
    from pathlib import Path
    from exam_simulator.catalog_snapshot import resolutions, routing
    root=Path(__file__).resolve().parents[1]
    assert json.loads((root/'lib/eduplus/exam-topic-routing.json').read_text(encoding='utf-8'))==routing()
    assert json.loads((root/'tests/fixtures/exam-topic-resolutions.json').read_text(encoding='utf-8'))==resolutions()
    # Natural phrasings resolve; unknown qualifiers and comparisons do not collapse.
    assert resolve('讲解快速排序算法的原理和实现')=='quick'
    assert resolve('双向BFS') is None
    assert resolve('快速排序和归并排序的比较') is None


def test_tree_traversal_phrasings_and_the_traversal_family():
    # Reported: "请为我讲解二叉树的中序遍历算法" was not recognised (的 between
    # 二叉树 and the traversal), and "二叉树遍历" taught only inorder.
    assert resolve('请为我讲解二叉树的中序遍历算法')=='tree-traversal'
    assert resolve('二叉树的前序遍历')=='preorder'
    assert resolve('讲解二叉树的后序遍历')=='postorder'
    assert resolve('二叉树的层次遍历')=='levelorder'
    assert resolve('Explain binary tree inorder traversal')=='tree-traversal'
    for topic in ('请为我讲解二叉树遍历','二叉树的遍历','二叉树的先序、中序和后序遍历'):
        assert resolve(topic)=='binary-traversals'
    assert resolve('由先序中序重建二叉树')=='tree-rebuild'
    assert resolve('中序线索二叉树')=='threaded-tree'
    assert resolve('二叉树的中序遍历的非递归实现') is None
    assert resolve('图的遍历') is None
    trace=run_trace('binary-traversals')
    assert trace['outcome']=={'preorderSequence':[4,2,1,3,6,5,7],'inorderSequence':[1,2,3,4,5,6,7],
                              'postorderSequence':[1,3,2,5,7,6,4],'levelorderSequence':[4,2,6,1,3,5,7]}
    labels=[f['label'] for f in trace['frames']]
    assert [l for l in labels if l.startswith('开始')]==['开始先序遍历','开始中序遍历','开始后序遍历','开始层序遍历']
    skewed=run_trace('binary-traversals',data={'levelOrder':[1,2,None,3]})['outcome']
    assert skewed=={'preorderSequence':[1,2,3],'inorderSequence':[3,2,1],'postorderSequence':[3,2,1],'levelorderSequence':[1,2,3]}
    assert run_trace('binary-traversals',data={'levelOrder':[]})['outcome']['inorderSequence']==[]
