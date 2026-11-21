"""Bottom-up B / B+ trees, including odd orders. Every mutation is observable."""
from bisect import bisect_left, bisect_right
from math import ceil
from .core import algorithm, require, tree, table, boxes


class Page:
    def __init__(self, serial, leaf=True):
        self.id, self.keys, self.children, self.parent, self.next = str(serial), [], [], None, None
        self.leaf = leaf


class Multiway:
    def __init__(self, t, order, plus):
        self.t, self.m, self.plus, self.serial = t, order, plus, 0
        self.root = self.new()

    def new(self, leaf=True):
        self.serial += 1
        return Page(self.serial, leaf)

    def pages(self):
        out = []
        def walk(p):
            out.append(p)
            for c in p.children: walk(c)
        walk(self.root)
        return out

    def minimum(self, p):
        while p.children: p = p.children[0]
        return p.keys[0]

    def refresh(self):
        def visit(p):
            for c in p.children: c.parent=p; visit(c)
            if self.plus and p.children: p.keys=[self.minimum(c) for c in p.children[1:]]
        visit(self.root)

    def emit(self, label, text, active=None):
        ps=self.pages()
        edges=[dict(source=p.id,target=c.id,label=str(i)) for p in ps for i,c in enumerate(p.children)]
        if self.plus: edges += [dict(source=p.id,target=p.next.id,label='next',kind='thread') for p in ps if p.leaf and p.next]
        self.t.emit(label,text,tree('B+ 树（内部键为右子树最小值）' if self.plus else 'B 树',
            [dict(id=p.id,label='\n'.join(' | '.join(map(str,p.keys[i:i+3])) for i in range(0,len(p.keys),3)) or '空根',mark='active' if p is active else '') for p in ps],edges,[self.root.id]),
            table('页与指针',['页','键','父页','子页','叶 next'],[[p.id,p.keys,p.parent.id if p.parent else '—',[c.id for c in p.children],p.next.id if p.next else '—'] for p in ps]),
            boxes('有序叶链' if self.plus else '当前键集合',{'叶页' if self.plus else '中序键':[p.keys for p in ps if p.leaf] if self.plus else self.contents()}))

    def contents(self):
        def visit(p):
            if not p.children:return p.keys[:]
            if self.plus:return [x for c in p.children for x in visit(c)]
            a=[]
            for i,c in enumerate(p.children):
                a+=visit(c)
                if i<len(p.keys):a.append(p.keys[i])
            return a
        return visit(self.root)

    def find(self,k):
        p=self.root
        while True:
            i=bisect_right(p.keys,k) if self.plus else bisect_left(p.keys,k)
            self.emit('页内查找',f'在页 {p.id} 比较 {k} 与键 {p.keys}；'+(f'沿第 {i} 个孩子下降。' if p.children else '到达叶页。'),p)
            if not self.plus and i<len(p.keys) and p.keys[i]==k:return p,i
            if not p.children:return p,bisect_left(p.keys,k)
            p=p.children[i]

    def insert(self,k):
        p,i=self.find(k)
        if i<len(p.keys) and p.keys[i]==k:self.emit('键已存在','集合索引不重复插入。',p);return
        p.keys.insert(i,k);self.refresh();self.emit('插入叶键',f'将 {k} 插入页 {p.id}；最多允许 {self.m-1} 个键。',p)
        while len(p.keys)>=self.m:
            self.emit('页溢出，准备分裂',f'页有 {len(p.keys)} 个键，超过上限 {self.m-1}。',p)
            r=self.new(p.leaf)
            if self.plus and p.leaf:
                cut=ceil(len(p.keys)/2);r.keys=p.keys[cut:];p.keys=p.keys[:cut]
                r.next=p.next;p.next=r;promote=r.keys[0]
            else:
                mid=len(p.keys)//2;promote=p.keys[mid];r.keys=p.keys[mid+1:];p.keys=p.keys[:mid]
                if p.children:r.children=p.children[mid+1:];p.children=p.children[:mid+1]
            parent=p.parent
            if not parent:
                parent=self.new(False);parent.children=[p];self.root=parent;p.parent=parent
            index=parent.children.index(p);parent.keys.insert(index,promote);parent.children.insert(index+1,r);r.parent=parent
            self.refresh();self.emit('分裂并向父页提升',f'分为页 {p.id}、{r.id}；'+(f'复制右叶最小键 {promote} 到父页，数据仍在叶中。' if self.plus and p.leaf else f'中间键 {promote} 提升到父页。'),parent)
            p=parent

    def low(self,p):
        return ceil((self.m-1)/2) if self.plus and p.leaf else ceil(self.m/2)-1

    def delete(self,k):
        p,i=self.find(k)
        if i>=len(p.keys) or p.keys[i]!=k:self.emit('键不存在','无需删除。',p);return
        if p.children:
            q=p.children[i+1]
            while q.children:q=q.children[0]
            p.keys[i]=q.keys[0];self.emit('后继替换内部键',f'内部键 {k} 由后继 {q.keys[0]} 替换；随后从叶页物理删除。',p);p=q;i=0
        p.keys.pop(i)
        # Empty leaves need repair before separator recomputation.
        self.emit('删除叶键',f'删除 {k}，检查占用下限 {self.low(p)}。',p)
        while p is not self.root and len(p.keys)<self.low(p):
            parent=p.parent;i=parent.children.index(p)
            left=parent.children[i-1] if i else None
            right=parent.children[i+1] if i+1<len(parent.children) else None
            if left and len(left.keys)>self.low(left):
                if self.plus and p.leaf:p.keys.insert(0,left.keys.pop())
                else:
                    p.keys.insert(0,parent.keys[i-1]);parent.keys[i-1]=left.keys.pop()
                    if left.children:p.children.insert(0,left.children.pop())
                self.refresh();self.emit('向左兄弟借键','兄弟有富余；经父分隔键重新分配，保持所有叶深度不变。',p);break
            if right and len(right.keys)>self.low(right):
                if self.plus and p.leaf:p.keys.append(right.keys.pop(0))
                else:
                    p.keys.append(parent.keys[i]);parent.keys[i]=right.keys.pop(0)
                    if right.children:p.children.append(right.children.pop(0))
                self.refresh();self.emit('向右兄弟借键','右兄弟有富余；更新父分隔键。',p);break
            a,b,j=(left,p,i-1) if left else (p,right,i)
            require(b is not None,'下溢页缺少兄弟')
            separator=parent.keys.pop(j);parent.children.pop(j+1)
            if not(self.plus and a.leaf):a.keys.append(separator)
            a.keys+=b.keys;a.children+=b.children
            if self.plus and a.leaf:a.next=b.next
            # Ancestors may temporarily have zero keys; refresh only after root shrink/repair.
            for c in a.children:c.parent=a
            self.emit('合并兄弟页',f'页 {a.id} 与 {b.id} 合并，父页失去一个分隔键；向上检查下溢。',a);p=parent
        if self.root.children and not self.root.keys:
            self.root=self.root.children[0];self.root.parent=None;self.emit('根收缩','空根由唯一孩子替代，树高减一。',self.root)
        self.refresh()

    def check(self,expected):
        require(self.contents()==sorted(expected),'B 树键集合核验失败')
        depths=[];leaves=[]
        def walk(p,depth):
            require(p.keys==sorted(set(p.keys)) and len(p.keys)<self.m,'页键序或上限错误')
            if p is not self.root:require(len(p.keys)>=self.low(p),'页占用下限错误')
            if p.children:
                require(not p.leaf and len(p.children)==len(p.keys)+1,'子指针数错误')
                for c in p.children:require(c.parent is p,'父指针错误');walk(c,depth+1)
                if self.plus:require(p.keys==[self.minimum(c) for c in p.children[1:]],'B+ 分隔键错误')
            else:depths.append(depth);leaves.append(p)
        walk(self.root,0);require(len(set(depths))<=1,'叶深度不一致')
        if self.plus:
            for i,p in enumerate(leaves):require(p.next is (leaves[i+1] if i+1<len(leaves) else None),'叶链错误')


def multiway(t,d):
    m=d.get('order',4);require(type(m)is int and 3<=m<=6,'order 为3…6（最大孩子数）')
    ops=d.get('operations');require(isinstance(ops,list) and len(ops)<=50,'operations至多50项')
    b=Multiway(t,m,t.key=='b-plus-tree');expected=set();found=[]
    b.emit('初始化空根',f'{m} 阶树，非根内部页至少 {ceil(m/2)} 个孩子。')
    for op in ops:
        require(isinstance(op,list) and len(op)==2 and op[0] in('insert','delete','search') and type(op[1])is int and abs(op[1])<=10000,'操作格式 [insert/delete/search, 整数]')
        action,k=op
        if action=='insert':b.insert(k);expected.add(k)
        elif action=='delete':b.delete(k);expected.discard(k)
        else:
            p,i=b.find(k);found.append(i<len(p.keys) and p.keys[i]==k);b.emit('查找完成',f'{k}：'+('找到' if found[-1] else '不存在'),p)
        b.check(expected);b.emit('本次操作完成','已核对全键集合、页占用、所有叶深度与子指针。')
    return t.finish(dict(keys=b.contents(),searchResults=found))

DEFAULT={'order':4,'operations':[['insert',x] for x in [10,20,5,6,12,30,7,17,3,2]]+[['delete',x] for x in [6,7,5,3,2,10]]}
algorithm('b-tree','B 树：分裂、借键与合并',['B树','B-树','B tree'],DEFAULT,'自命题／多路查找树')(multiway)
algorithm('b-plus-tree','B+ 树：索引页与叶链',['B+树','B＋树','B+ tree'],DEFAULT,'自命题／多路查找树')(multiway)
