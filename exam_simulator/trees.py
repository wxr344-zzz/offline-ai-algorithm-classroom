from .core import algorithm, require, ints, tree, table, boxes, seq
from collections import deque
import heapq

class Node:
    def __init__(self,key,identity,color='B'):
        self.key,self.id,self.color=key,str(identity),color
        self.left=self.right=self.parent=None

class Binary:
    def __init__(self,t,rb=False):
        self.t,self.rb,self.serial=t,rb,0
        self.nil=Node(None,'NIL') if rb else None
        if rb:self.nil.left=self.nil.right=self.nil.parent=self.nil
        self.root=self.nil;self.extra=[]
    def live(self,n):return n is not None and n is not self.nil
    def height(self,n):return 0 if not self.live(n) else 1+max(self.height(n.left),self.height(n.right))
    def inorder(self,n=None):
        def walk(x):return [] if not self.live(x) else walk(x.left)+[x.key]+walk(x.right)
        return walk(self.root if n is None else n)
    def emit(self,label,why,current=None):
        nodes=[];edges=[];rows=[];seen=set()
        def walk(n):
            if not self.live(n):return
            require(n.id not in seen,'树结构出现环');seen.add(n.id)
            nodes.append(dict(id=n.id,label=str(n.key),color=('red' if n.color=='R' else 'black') if self.rb else None,mark='active' if n is current else '',height=self.height(n)))
            rows.append([n.id,n.key,n.parent.id if self.live(n.parent) else 'NULL',n.left.id if self.live(n.left) else 'NULL',n.right.id if self.live(n.right) else 'NULL',self.height(n),self.height(n.left)-self.height(n.right),n.color if self.rb else '—'])
            for child,side in ((n.left,'L'),(n.right,'R')):
                if self.live(child):edges.append(dict(source=n.id,target=child.id,label=side));walk(child)
        for r in [self.root]+self.extra:walk(r)
        self.t.emit(label,why,tree('二叉查找结构（NULL叶均为黑色）',nodes,edges,[r.id for r in [self.root]+self.extra if self.live(r)]),table('指针与结点属性',['编号','key','parent','left','right','高度','平衡因子L−R','颜色'],rows))
    def new(self,key,color='B'):
        n=Node(key,self.serial,color);self.serial+=1;n.left=n.right=n.parent=self.nil;return n
    def rotate(self,x,left):
        y=x.right if left else x.left;require(self.live(y),'旋转缺少支点')
        self.emit('旋转前',f'以{x.key}为轴'+('左旋' if left else '右旋')+f'，支点{y.key}。',x)
        if left:
            x.right=y.left
            if self.live(y.left):y.left.parent=x
        else:
            x.left=y.right
            if self.live(y.right):y.right.parent=x
        y.parent=x.parent
        if not self.live(x.parent):self.root=y
        elif x is x.parent.left:x.parent.left=y
        else:x.parent.right=y
        if left:y.left=x
        else:y.right=x
        x.parent=y
        self.emit('旋转后',f'{x.key}的'+('右子←支点左子；支点左子←原轴' if left else '左子←支点右子；支点右子←原轴')+'，同步更新3组父指针；中序顺序不变。',y)
        return y
    def locate(self,key):
        n=self.root;last=self.nil
        while self.live(n):
            last=n;self.emit('查找路径比较',f'{key} 与 {n.key}比较：'+('命中' if key==n.key else '进入左子树' if key<n.key else '进入右子树'),n)
            if key==n.key:return n,last
            n=n.left if key<n.key else n.right
        return self.nil,last
    def link_new(self,key):
        node,last=self.locate(key)
        if self.live(node):self.emit('重复关键字','本演示按集合处理，重复键不插入。',node);return None
        node=self.new(key,'R' if self.rb else 'B');node.parent=last
        if not self.live(last):self.root=node
        elif key<last.key:last.left=node
        else:last.right=node
        self.emit('挂接新叶',f'新结点{node.id}，key={key}，父结点='+('NULL' if not self.live(last) else str(last.key)),node);return node
    def transplant(self,u,v):
        if not self.live(u.parent):self.root=v
        elif u is u.parent.left:u.parent.left=v
        else:u.parent.right=v
        if self.live(v) or self.rb:v.parent=u.parent
    def minimum(self,n):
        while self.live(n.left):n=n.left;self.emit('寻找中序后继','沿左指针下降。',n)
        return n
    def remove_plain(self,n):
        if self.live(n.left) and self.live(n.right):
            successor=self.minimum(n.right);old=n.key;n.key=successor.key
            self.emit('复制后继关键字',f'用后继{successor.key}覆盖待删键{old}，下一步删除后继结点；重复键仅是此中间步骤。',successor);n=successor
        parent=n.parent;child=n.left if self.live(n.left) else n.right;self.transplant(n,child)
        self.emit('摘除结点并接回子树','前驱父链接绕过被删结点，其唯一子树接回原位置。',parent if self.live(parent) else child);return parent
    def avl_repair(self,n):
        while self.live(n):
            bf=self.height(n.left)-self.height(n.right);self.emit('计算平衡因子',f'结点{n.key}：BF=h(L)−h(R)={bf}。',n)
            if bf>1:
                if self.height(n.left.left)<self.height(n.left.right):self.emit('LR 情形','先对子树左旋，再对失衡轴右旋。',n);self.rotate(n.left,True)
                else:self.emit('LL 情形','对失衡轴右旋。',n)
                n=self.rotate(n,False)
            elif bf< -1:
                if self.height(n.right.right)<self.height(n.right.left):self.emit('RL 情形','先对子树右旋，再对失衡轴左旋。',n);self.rotate(n.right,False)
                else:self.emit('RR 情形','对失衡轴左旋。',n)
                n=self.rotate(n,True)
            n=n.parent
    def splay(self,x):
        while self.live(x.parent):
            p=x.parent;g=p.parent
            if not self.live(g):self.emit('Zig 单旋','父为根，旋转一次将访问结点提到根。',x);self.rotate(p,x is p.right)
            elif (x is p.left)==(p is g.left):self.emit('Zig-Zig 同侧双旋','先旋祖父，再旋父；访问结点上升两层。',x);self.rotate(g,p is g.right);self.rotate(p,x is p.right)
            else:self.emit('Zig-Zag 异侧双旋','先旋父，再旋祖父。',x);self.rotate(p,x is p.right);self.rotate(g,x is g.right)
    def rb_insert(self,z):
        while z.parent.color=='R':
            p=z.parent;g=p.parent;left=p is g.left;u=g.right if left else g.left
            if u.color=='R':
                p.color=u.color='B';g.color='R';self.emit('父叔同红：重染色','父与叔变黑，祖父变红；将检查点上移祖父。',g);z=g
            else:
                if z is (p.right if left else p.left):z=p;self.rotate(z,left);p=z.parent;g=p.parent
                p.color='B';g.color='R';self.emit('父叔异色：外侧修复','父变黑，祖父变红，再对祖父旋转。',p);self.rotate(g,not left)
        self.root.color='B';self.emit('根结点置黑','红黑插入修复结束，所有NULL叶仍为黑色。',self.root)
    def rb_delete(self,z):
        y=z;old=y.color
        if not self.live(z.left):x=z.right;self.transplant(z,z.right)
        elif not self.live(z.right):x=z.left;self.transplant(z,z.left)
        else:
            y=self.minimum(z.right);old=y.color;x=y.right
            if y.parent is z:x.parent=y
            else:self.transplant(y,y.right);y.right=z.right;y.right.parent=y
            self.transplant(z,y);y.left=z.left;y.left.parent=y;y.color=z.color
        self.emit('删除结点并移植','若被移除位置原为黑色，需要沿替代位置修复一层黑高亏欠。',x if self.live(x) else x.parent)
        if old=='B':
            while x is not self.root and x.color=='B':
                p=x.parent;left=x is p.left;w=p.right if left else p.left
                if not self.live(w):x=p;continue
                if w.color=='R':
                    w.color='B';p.color='R';self.emit('红兄弟转换','兄弟变黑，父变红，对父旋转，转换为黑兄弟情形。',p);self.rotate(p,left);w=p.right if left else p.left
                near=w.left if left else w.right;far=w.right if left else w.left
                if near.color=='B' and far.color=='B':
                    w.color='R';self.emit('兄弟双黑子：亏欠上移','兄弟染红，黑高亏欠上移到父。',p);x=p
                else:
                    if far.color=='B':
                        near.color='B';w.color='R';self.emit('远侄黑：先旋兄弟','近侄变黑，兄弟变红，旋转兄弟。',w);self.rotate(w,not left);w=p.right if left else p.left;far=w.right if left else w.left
                    w.color=p.color;p.color='B';far.color='B';self.emit('远侄红：最终修复','兄弟继承父色，父与远侄变黑，对父旋转消除亏欠。',p);self.rotate(p,left);x=self.root
            x.color='B'
        if self.live(self.root):self.root.color='B'
        self.nil.color='B';self.emit('红黑删除修复完成','根黑、无连续红结点、各根到NULL路径黑高相同。',self.root)
    def check(self,expected):
        require(self.inorder()==sorted(expected),'中序／集合校验失败')
        def walk(n):
            if not self.live(n):return 1
            for c in (n.left,n.right):
                if self.live(c):require(c.parent is n,'父指针错误')
            if self.t.key=='avl':require(abs(self.height(n.left)-self.height(n.right))<=1,'AVL失衡')
            l,r=walk(n.left),walk(n.right)
            if self.rb:
                require(l==r,'红黑树黑高不等')
                if n.color=='R':require(n.left.color==n.right.color=='B','连续红结点')
            return l+(n.color=='B')
        if self.rb and self.live(self.root):require(self.root.color=='B','根非黑')
        walk(self.root)

TREE_DEFAULT={'operations':[['insert',30],['insert',20],['insert',10],['insert',25],['insert',28],['insert',27],['search',10],['delete',20]]}
def search_tree(t,d):
    operations=d.get('operations');require(isinstance(operations,list) and len(operations)<=36,'树操作至多36条');b=Binary(t,t.key=='red-black');expected=set();results=[]
    b.emit('空树初始化','每个结点编号固定；旋转只改变链接，不改变关键字的中序关系。')
    for op in operations:
        require(isinstance(op,list) and len(op)==2 and op[0]in('insert','delete','search') and type(op[1])is int and abs(op[1])<=10000,'操作为 [insert/delete/search,整数键]');name,key=op
        if name=='insert':
            n=b.link_new(key)
            if n:
                expected.add(key)
                if t.key=='avl':b.avl_repair(n)
                elif t.key=='splay':b.splay(n)
                elif t.key=='red-black':b.rb_insert(n)
        else:
            n,last=b.locate(key);found=b.live(n)
            if t.key=='splay' and b.live(last):b.splay(last)
            if name=='search':results.append(found);b.emit('查找结果','命中' if found else '未找到',n if found else None)
            elif found:
                expected.remove(key)
                if t.key=='red-black':b.rb_delete(n)
                elif t.key=='splay':
                    left,right=n.left,n.right
                    if b.live(left):left.parent=b.nil
                    if b.live(right):right.parent=b.nil
                    b.root=left;b.extra=[right] if b.live(right) else [];b.emit('删除根并拆为左右两树','访问键已伸展到根，删除根后分别保留左右子树。')
                    if not b.live(left):b.root=right;b.extra=[]
                    else:
                        maximum=left
                        while b.live(maximum.right):maximum=maximum.right;b.emit('寻找左树最大键','连接前先定位左树最大键。',maximum)
                        b.splay(maximum);b.root.right=right
                        if b.live(right):right.parent=b.root
                        b.extra=[]
                    b.emit('连接左右树','左树最大键伸展为根后，其右孩子为空，可接上原右树。')
                else:
                    parent=b.remove_plain(n)
                    if t.key=='avl':b.avl_repair(parent)
            else:b.emit('删除键不存在','树保持不变。')
        b.check(expected);b.emit('本次操作完成','已独立核对中序集合、父指针，以及当前树种的结构不变量。')
    return t.finish(dict(inorder=b.inorder(),searchResults=results,root=b.root.key if b.live(b.root) else None))

for _id,_name,_aliases in [('bst','二叉排序树 BST',['二叉查找树','BST','二叉搜索树']),('avl','AVL 平衡树',['AVL','平衡二叉树']),('splay','伸展树 Splay',['伸展树','Splay']),('red-black','红黑树',['红黑树','Red Black','RB树'])]:algorithm(_id,_name,_aliases,TREE_DEFAULT,'408／自命题高级查找树')(search_tree)

def binary_traversal(t,d):
    values=d.get('levelOrder');require(isinstance(values,list) and len(values)<=31 and all(v is None or type(v)is int for v in values),'levelOrder为至多31项整数／null');nodes={i:v for i,v in enumerate(values) if v is not None and (i==0 or (i-1)//2 in {j for j,v in enumerate(values) if v is not None})};require(set(nodes)=={i for i,v in enumerate(values) if v is not None},'空父结点不能有非空子结点')
    visited=[];stack=[];threads=[];pre=None
    def view(current=None):return [tree('二叉树与线索',[dict(id=str(i),label=str(v),mark='active' if i==current else 'done' if i in visited else '') for i,v in nodes.items()],[dict(source=str((i-1)//2),target=str(i),label='L' if i%2 else 'R') for i in nodes if i]+threads,['0'] if 0 in nodes else []),boxes('辅助容器',{'调用栈／队列':stack,'已访问':[nodes[i] for i in visited]})]
    mode=d.get('order','inorder')
    if t.key in ('preorder','postorder','levelorder'):mode={'preorder':'preorder','postorder':'postorder','levelorder':'level'}[t.key]
    require(mode in('preorder','inorder','postorder','level'),'order为preorder/inorder/postorder/level')
    if t.key=='threaded-tree':mode='inorder'
    t.emit('初始化遍历',f'采用{ {"preorder":"先序遍历（根→左→右）","inorder":"中序遍历（左→根→右）","postorder":"后序遍历（左→右→根）","level":"层序遍历（按层从左到右）"}[mode]}，数组空项代表空子树。',*view())
    def output(i):
        nonlocal pre
        visited.append(i)
        if t.key=='threaded-tree':
            if 2*i+1 not in nodes and pre is not None:threads.append(dict(source=str(i),target=str(pre),label='前驱线索',kind='thread'))
            if pre is not None and 2*pre+2 not in nodes:threads.append(dict(source=str(pre),target=str(i),label='后继线索',kind='thread'))
            pre=i
        t.emit('访问结点／建立线索',f'输出{nodes[i]}。'+('仅空孩子指针可改为线索；线索不参与递归。' if t.key=='threaded-tree' else ''),*view(i))
    def dfs(i):
        if i not in nodes:return
        stack.append(i);t.emit('进入递归栈',f'压入结点{nodes[i]}。',*view(i))
        if mode=='preorder':output(i)
        dfs(2*i+1)
        if mode=='inorder':output(i)
        dfs(2*i+2)
        if mode=='postorder':output(i)
        stack.pop();t.emit('递归返回',f'结点{nodes[i]}处理完成，弹栈。',*view(i))
    if mode=='level':
        stack=[0] if 0 in nodes else []
        while stack:
            i=stack.pop(0);output(i)
            for child in (2*i+1,2*i+2):
                if child in nodes:stack.append(child);t.emit('孩子入队',f'将{nodes[child]}加入队尾。',*view(child))
    else:dfs(0)
    require(set(visited)==set(nodes) and len(visited)==len(nodes),'遍历完整性失败');return t.finish(dict(order=[nodes[i] for i in visited],threads=threads))

algorithm('tree-traversal','二叉树中序遍历',['中序遍历','中根遍历','inorder traversal','in-order traversal'],{'levelOrder':[4,2,6,1,3,5,7],'order':'inorder'},'408／树')(binary_traversal)
for _id,_name,_aliases in [('preorder','二叉树先序遍历',['先序遍历','前序遍历','先根遍历','preorder traversal','pre-order traversal']),('postorder','二叉树后序遍历',['后序遍历','后根遍历','postorder traversal','post-order traversal']),('levelorder','二叉树层序遍历',['层序遍历','层次遍历','按层遍历','level order traversal','level-order traversal'])]:algorithm(_id,_name,_aliases,{'levelOrder':[4,2,6,1,3,5,7]},'408／树')(binary_traversal)

TRAVERSAL_ORDERS=(('preorder','先序','根 → 左子树 → 右子树'),('inorder','中序','左子树 → 根 → 右子树'),('postorder','后序','左子树 → 右子树 → 根'),('levelorder','层序','自上而下、每层从左到右'))

# "二叉树遍历" asks for the traversals as a family, not for one of them: the
# same tree is walked in all four orders, one after another, and every
# sequence is checked against an independent iterative walk.
@algorithm('binary-traversals','二叉树遍历（先序/中序/后序/层序）',['二叉树遍历','二叉树的遍历','遍历二叉树','二叉树四种遍历','前中后序遍历','先中后序遍历','前序中序后序遍历','先序中序后序遍历','先序','前序','中序','后序','层序','binary tree traversal','binary tree traversals'],{'levelOrder':[4,2,6,1,3,5,7]},'408／树')
def binary_traversals(t,d):
    values=d.get('levelOrder');require(isinstance(values,list) and len(values)<=31 and all(v is None or type(v)is int for v in values),'levelOrder为至多31项整数／null')
    present={i for i,v in enumerate(values) if v is not None}
    require(all(i==0 or (i-1)//2 in present for i in present),'空父结点不能有非空子结点')
    nodes={i:values[i] for i in sorted(present)};sequences={};visited=[];work=[]
    def view(current=None,label='调用栈'):
        return [tree('二叉树',[dict(id=str(i),label=str(v),mark='active' if i==current else 'done' if i in visited else '') for i,v in nodes.items()],[dict(source=str((i-1)//2),target=str(i),label='L' if i%2 else 'R') for i in nodes if i],['0'] if 0 in nodes else []),
                boxes('遍历状态',{label:[nodes[i] for i in work],'本轮已访问':[nodes[i] for i in visited],**{f'{name}序列':sequences[key] for key,name,_ in TRAVERSAL_ORDERS if key in sequences}})]
    t.emit('初始化','同一棵二叉树依次做先序、中序、后序和层序遍历；数组空项代表空子树。',*view())
    for key,name,rule in TRAVERSAL_ORDERS:
        visited.clear();work.clear()
        t.emit(f'开始{name}遍历',f'{name}遍历的访问顺序：{rule}。',*view(label='队列' if key=='levelorder' else '调用栈'))
        def visit(i):
            visited.append(i);t.emit(f'{name}：访问结点',f'输出{nodes[i]}，{name}序列为{[nodes[j] for j in visited]}。',*view(i,'队列' if key=='levelorder' else '调用栈'))
        def dfs(i):
            if i not in nodes:return
            work.append(i)
            if key=='preorder':visit(i)
            dfs(2*i+1)
            if key=='inorder':visit(i)
            dfs(2*i+2)
            if key=='postorder':visit(i)
            work.pop()
        if key=='levelorder':
            work.extend([0] if 0 in nodes else [])
            while work:
                i=work.pop(0);visit(i)
                work.extend(c for c in (2*i+1,2*i+2) if c in nodes)
        else:dfs(0)
        sequences[key]=[nodes[i] for i in visited]
        t.emit(f'{name}遍历完成',f'{name}序列：{sequences[key]}。',*view())
    # Independent check: explicit-stack walks (no recursion shared with the trace).
    def iterative(order):
        out=[];stack=[];i=0
        if order=='levelorder':
            queue=[0] if 0 in nodes else []
            while queue:
                i=queue.pop(0);out.append(nodes[i]);queue+=[c for c in (2*i+1,2*i+2) if c in nodes]
            return out
        if order=='preorder':
            stack=[0] if 0 in nodes else []
            while stack:
                i=stack.pop();out.append(nodes[i]);stack+=[c for c in (2*i+2,2*i+1) if c in nodes]
            return out
        if order=='postorder':
            stack=[0] if 0 in nodes else []
            while stack:
                i=stack.pop();out.append(nodes[i]);stack+=[c for c in (2*i+1,2*i+2) if c in nodes]
            return out[::-1]
        while stack or i in nodes:
            while i in nodes:stack.append(i);i=2*i+1
            i=stack.pop();out.append(nodes[i]);i=2*i+2
        return out
    for key,name,_ in TRAVERSAL_ORDERS:require(sequences[key]==iterative(key),f'{name}遍历独立校验失败')
    t.emit('四种遍历对比','先序先访问根，后序最后访问根，中序把根放在左右子树之间，层序按层访问；已用非递归遍历独立核对四个序列。',*view())
    return t.finish({f'{key}Sequence':sequences[key] for key,_,_ in TRAVERSAL_ORDERS})
algorithm('threaded-tree','中序线索二叉树',['线索二叉树','线索化'],{'levelOrder':[4,2,6,1,3,5,7]},'408／树')(binary_traversal)

@algorithm('huffman','哈夫曼树与编码',['哈夫曼','霍夫曼','Huffman'],{'weights':[5,9,12,13,16,45]},'408／树')
def huffman(t,d):
    weights=ints(d.get('weights'),12,1,1000);nodes=[];edges=[];heap=[];serial=0;codes={};cost=0
    for i,w in enumerate(weights):nodes.append(dict(id=str(i),label=f'{w}\n符号{i}'));heapq.heappush(heap,(w,i))
    serial=len(nodes)
    def view():return [tree('哈夫曼森林',nodes,edges,[str(i) for w,i in heap]),boxes('最小优先队列',{'候选（权,编号）':sorted(heap)})]
    t.emit('初始化森林','每个符号形成一棵树，每次合并权最小的两棵。',*view())
    while len(heap)>1:
        a,u=heapq.heappop(heap);b,v=heapq.heappop(heap);w=a+b;cost+=w;nodes.append(dict(id=str(serial),label=str(w)));edges.extend([dict(source=str(serial),target=str(u),label='0'),dict(source=str(serial),target=str(v),label='1')]);heapq.heappush(heap,(w,serial));serial+=1
        t.emit('合并两棵最小树',f'{a}+{b}={w}，新树入队，累计WPL增量为{w}。',*view())
    children={}
    for e in edges:children.setdefault(e['source'],[]).append((e['target'],e['label']))
    def walk(i,prefix):
        if str(i) not in children:codes[int(i)]=prefix or '0';return
        for child,bit in children[str(i)]:walk(child,prefix+bit)
    if heap:walk(heap[0][1],'')
    wpl=sum(weights[i]*(len(codes[i]) if len(weights)>1 else 0) for i in codes);require(wpl==cost,'WPL核验失败')
    t.emit('输出编码与WPL','左0右1；单符号编码约定0，但树路径长度为0。',*view(),table('前缀编码',['符号','权','编码'],[[i,weights[i],codes[i]] for i in codes]));return t.finish(dict(codes=codes,wpl=wpl))
