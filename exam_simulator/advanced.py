"""408 auxiliary structures and external-memory algorithms; bounded teaching inputs."""
from bisect import bisect_left
import heapq
from .core import algorithm, require, ints, seq, tree, boxes, table, grid


def heap_trace(t,d):
    a=[];out=[];is_min=t.key=='min-heap'
    def better(x,y):return x<y if is_min else x>y
    def view(active=None):return [seq('堆的顺序存储',a,active=active or []),tree('完全二叉堆',[dict(id=str(i),label=str(x),mark='active' if i in (active or []) else '') for i,x in enumerate(a)],[dict(source=str((i-1)//2),target=str(i)) for i in range(1,len(a))],['0'] if a else []),boxes('已弹出',{'输出':out})]
    ops=d.get('operations');require(isinstance(ops,list) and len(ops)<=45,'operations至多45项')
    t.emit('初始化空堆','父结点始终'+('不大于' if is_min else '不小于')+'孩子。',*view())
    model=[]
    for op in ops:
        require(isinstance(op,list) and op and op[0] in('push','pop','peek'),'操作为 [push,整数]、[pop]、[peek]')
        if op[0]=='push':
            require(len(op)==2 and type(op[1])is int and abs(op[1])<=10000 and len(a)<24,'整数入堆且堆容量最多24')
            a.append(op[1]);model.append(op[1]);i=len(a)-1;t.emit('插到末尾',f'{op[1]} 放在下标 {i}。',*view([i]))
            while i:
                p=(i-1)//2;t.emit('比较父子',f'比较 a[{i}]={a[i]} 与 a[{p}]={a[p]}。',*view([i,p]))
                if not better(a[i],a[p]):break
                a[i],a[p]=a[p],a[i];t.emit('向上交换','交换后继续检查新的父结点。',*view([i,p]));i=p
        elif a and op[0]=='pop':
            v=a[0];out.append(v);model.remove(v);last=a.pop()
            if a:a[0]=last
            t.emit('取出堆顶、末尾补根',f'输出 {v}。',*view([0] if a else []));i=0
            while 2*i+1<len(a):
                c=2*i+1
                if c+1<len(a) and better(a[c+1],a[c]):c+=1
                t.emit('选择更优孩子',f'比较父 {a[i]} 与孩子 {a[c]}。',*view([i,c]))
                if not better(a[c],a[i]):break
                a[i],a[c]=a[c],a[i];t.emit('向下交换','继续筛选直至堆序恢复。',*view([i,c]));i=c
        else:t.emit('查看堆顶' if a else '堆为空',f'堆顶：{a[0] if a else "无"}。',*view())
        require(sorted(a)==sorted(model) and all(not better(a[i],a[(i-1)//2]) for i in range(1,len(a))),'堆不变量错误')
    return t.finish(dict(heap=a,popped=out))

HEAP_DEFAULT={'operations':[['push',v] for v in [7,3,9,1,6,2]]+[['pop'],['pop'],['push',4]]}
algorithm('min-heap','最小堆与优先队列',['最小堆','小根堆','最小优先队列','优先队列'],HEAP_DEFAULT,'408／堆')(heap_trace)
algorithm('max-heap','最大堆维护',['最大堆','大根堆'],HEAP_DEFAULT,'408／堆')(heap_trace)


def disjoint(t,d):
    n=d.get('n');require(type(n)is int and 1<=n<=20,'n为1…20');parent=list(range(n));rank=[0]*n;weight=[0]*n;relations=[];answers=[]
    weighted=t.key=='weighted-dsu';compress=t.key!='disjoint-set-no-compress'
    def view():return [tree('并查集父指针森林',[dict(id=str(i),label=str(i)) for i in range(n)],[dict(source=str(parent[i]),target=str(i),label=f'Δ={weight[i]}') for i in range(n) if parent[i]!=i],[str(i) for i in range(n) if parent[i]==i]),table('parent 与势差',['x','parent[x]','rank','w[x]=P[x]−P[parent]'],[[i,parent[i],rank[i],weight[i]] for i in range(n)])]
    def find(x):
        path=[];u=x
        while parent[u]!=u:path.append(u);u=parent[u];t.emit('沿父指针查找',f'查找 {x} 的根，移动到 {u}。',*view())
        total=0
        for v in reversed(path):
            total+=weight[v]
            if compress:
                parent[v]=u;weight[v]=total;t.emit('路径压缩与权值累加',f'parent[{v}]={u}；P[{v}]−P[{u}]={total}。',*view())
        return u,total
    ops=d.get('operations');require(isinstance(ops,list) and len(ops)<=35,'operations至多35项')
    t.emit('各元素自成集合','势差定义为结点势减父结点势，根权值为0。',*view())
    for op in ops:
        require(isinstance(op,list) and op and op[0] in('union','find','diff'),'操作union/find/diff')
        require(len(op)>1 and all(type(x)is int for x in op[1:]),'操作参数为整数');x=op[1];require(0<=x<n,'结点越界');rx,wx=find(x)
        if op[0]=='find':answers.append(rx);continue
        require(len(op)>2 and 0<=op[2]<n,'第二结点越界');y=op[2];ry,wy=find(y)
        delta=op[3] if weighted and len(op)==4 else 0
        if op[0]=='diff':answers.append(wy-wx if rx==ry else None);t.emit('查询关系',f'P[{y}]−P[{x}]={answers[-1]}（None表示不连通）。',*view());continue
        if rx==ry:
            consistent=(wy-wx==delta) if weighted else True;answers.append(consistent);t.emit('同集合检查',f'新约束与已有势差'+('一致。' if consistent else '矛盾，拒绝加入。'),*view());continue
        if rank[rx]<rank[ry]:parent[rx]=ry;weight[rx]=wy-wx-delta
        else:
            parent[ry]=rx;weight[ry]=delta+wx-wy
            if rank[rx]==rank[ry]:rank[rx]+=1
        relations.append((x,y,delta));t.emit('按秩合并',f'加入约束 P[{y}]−P[{x}]={delta}；同步更新根间势差。',*view())
        # Independent relation-graph traversal validates all accepted equations.
        adj=[[] for _ in range(n)]
        for u,v,w in relations:adj[u].append((v,w));adj[v].append((u,-w))
        potentials={}
        for start in range(n):
            if start in potentials:continue
            potentials[start]=0;pending=[start]
            while pending:
                u=pending.pop()
                for v,w in adj[u]:
                    if v not in potentials:potentials[v]=potentials[u]+w;pending.append(v)
                    require(potentials[v]==potentials[u]+w,'势差约束矛盾')
        for u,v,w in relations:
            ru,wu=find(u);rv,wv=find(v);require(ru==rv and wv-wu==w,'并查集权核验失败')
    return t.finish(dict(parent=parent,weights=weight,answers=answers))

DSU_DEFAULT={'n':6,'operations':[['union',0,1,3],['union',1,2,4],['union',3,4,2],['union',2,4,5],['find',4],['diff',0,4]]}
algorithm('disjoint-set','并查集：按秩合并与路径压缩',['并查集','Union Find','路径压缩'],DSU_DEFAULT,'408／集合')(disjoint)
algorithm('weighted-dsu','带权并查集',['带权并查集','势差并查集'],DSU_DEFAULT,'自命题／集合')(disjoint)


def hashing(t,d):
    capacity=d.get('capacity',7);require(type(capacity)is int and 3<=capacity<=23,'capacity为3…23的素数')
    def prime(x):return x>=2 and all(x%q for q in range(2,int(x**.5)+1))
    require(prime(capacity),'表长需为素数');slots=[None]*capacity;members=set();old=[];answers=[]
    tomb='†'
    def view(i=None):return [seq('散列表',slots,{'probe':i} if i is not None else {}),boxes('再散列迁移',{'旧表':old,'键集合':sorted(members)})]
    def probe(k):
        m=len(slots);seen=set()
        for j in range(m*2):
            if t.key=='quadratic-hash':offset=0 if j==0 else ((j+1)//2)**2*(1 if j%2 else -1)
            elif t.key=='double-hash':offset=j*(1+k%(m-1))
            else:offset=j
            i=(k%m+offset)%m
            if i in seen:continue
            seen.add(i);t.emit('探测地址',f'key={k}，h={k%m}，第{j}次偏移={offset}，地址={i}，当前={slots[i]}。',*view(i));yield i
    def place(k):
        for i in probe(k):
            if slots[i] is None or slots[i]==tomb:slots[i]=k;t.emit('写入空槽',f'{k} 写入地址 {i}。',*view(i));return True
        return False
    def resize(extra=None):
        nonlocal old,slots
        keys=sorted(members|({extra} if extra is not None else set()));old=slots[:];m=len(slots)*2+1
        while not prime(m):m+=1
        require(m<=101,'教学表长超过101');slots=[None]*m;t.emit('扩容再散列',f'新素数表长 {m}，所有键重新计算地址。',*view())
        for k in keys:require(place(k),'再散列失败')
        old=[]
    ops=d.get('operations');require(isinstance(ops,list) and len(ops)<=25,'operations至多25项');t.emit('初始化散列表','†为删除标记，查找遇到删除标记必须继续。',*view())
    for op in ops:
        require(isinstance(op,list) and len(op)==2 and op[0] in('insert','search','delete') and type(op[1])is int and abs(op[1])<=10000,'操作格式[insert/search/delete,整数]');action,k=op
        if action=='insert':
            if k not in members:
                if (len(members)+1)/len(slots)>.65:resize(k)
                elif not place(k):resize(k)
                members.add(k)
        else:
            found=None
            for i in probe(k):
                if slots[i]==k:found=i;break
                if slots[i] is None:break
            require((found is not None)==(k in members),'散列查找与集合不一致')
            if action=='search':answers.append(found is not None)
            elif found is not None:slots[found]=tomb;members.remove(k)
            t.emit('查找／删除完成',f'{k}：'+('找到' if found is not None else '不存在')+'。',*view(found))
        require(sorted(x for x in slots if type(x)is int)==sorted(members),'散列表键集合核验失败')
    return t.finish(dict(slots=slots,keys=sorted(members),searchResults=answers))

HASH_DEFAULT={'capacity':7,'operations':[['insert',v] for v in [10,17,24,31,38,45]]+[['delete',24],['search',38],['insert',52]]}
for _id,_name,_aliases in [('linear-hash','哈希表：线性探测与再散列',['线性探测','散列表','哈希表','再散列']),('quadratic-hash','哈希表：二次探测',['二次探测','平方探测']),('double-hash','哈希表：双散列',['双散列','双重散列','double hashing'])]:algorithm(_id,_name,_aliases,HASH_DEFAULT,'408／散列')(hashing)


def external(t,d):
    runs=d.get('runs');require(isinstance(runs,list) and 1<=len(runs)<=8,'runs为1…8个有序归并段')
    runs=[ints(a,16) for a in runs];require(all(a==sorted(a) for a in runs),'每个初始归并段必须非降序')
    k=1
    while k<len(runs):k*=2
    pos=[0]*len(runs);winner=[None]*(2*k);loser=[None]*k;out=[]
    def value(i):return (runs[i][pos[i]],i) if i is not None and i<len(runs) and pos[i]<len(runs[i]) else (float('inf'),i if i is not None else k)
    def view():
        nodes=[dict(id=str(i),label=f'败者段：{loser[i]}\n'+('冠军' if i==1 else '胜者上送')+f'：{winner[i]}') for i in range(1,k)]+[dict(id=str(k+i),label=f'段{i}: '+('∞' if value(i)[0]==float('inf') else str(value(i)[0]))) for i in range(k)]
        return [tree('败者树（内部保留本场败者，另标胜者）',nodes,[dict(source=str(i//2),target=str(i)) for i in range(2,2*k)],['1'] if k>1 else ['1']),boxes('归并段与输出',{**{f'段{i} 已读{pos[i]}':a[pos[i]:] for i,a in enumerate(runs)},'输出':out}),table('内部比赛',['结点','胜者段','败者段'],[[i,winner[i],loser[i]] for i in range(1,k)])]
    for i in range(k):winner[k+i]=i
    def contest(i):
        a,b=winner[2*i],winner[2*i+1]
        winner[i],loser[i]=(a,b) if value(a)<=value(b) else (b,a)
        t.emit('比较两路并记录败者',f'结点{i}：{value(a)} 对 {value(b)}；胜者段{winner[i]}上送，败者段{loser[i]}保存在本结点。',*view())
    t.emit('初始化多路段','用 (键,段号) 处理相等键，空段视为正无穷。',*view())
    for i in range(k-1,0,-1):contest(i)
    while value(winner[1])[0]!=float('inf'):
        i=winner[1];out.append(runs[i][pos[i]]);pos[i]+=1;t.emit('输出全局最小记录',f'冠军段{i}推进一条记录，只重赛该叶到根的路径。',*view())
        j=(k+i)//2
        while j:contest(j);j//=2
    require(out==sorted(x for a in runs for x in a),'归并结果错误');return t.finish(dict(sorted=out))

algorithm('loser-tree','外排序：败者树多路归并',['败者树','多路归并','外排序','外部排序'],{'runs':[[1,7,12],[2,7,10],[0,8,15],[3,6,11]]},'408／外排序')(external)


@algorithm('replacement-selection','外排序：置换选择生成初始段',['置换选择','replacement selection'],{'array':[8,3,10,1,7,2,9,4,6,0,5],'memory':4},'408／外排序')
def replacement(t,d):
    data=ints(d.get('array'),40);m=d.get('memory');require(type(m)is int and 1<=m<=10,'memory为1…10');active=data[:m];heapq.heapify(active);frozen=[];runs=[[]];p=min(m,len(data))
    def view():return [seq('尚未读入',data,{'read':p}),boxes('活动／冻结／输出',{'活动最小堆':sorted(active),'冻结至下一段':sorted(frozen),**{f'段{i}':a for i,a in enumerate(runs)}})]
    t.emit('填充内存','输出当前活动区最小值，新记录小于刚输出值时冻结到下一段。',*view())
    while active or frozen:
        if not active:active,frozen=frozen,[];heapq.heapify(active);runs.append([]);t.emit('开始下一归并段','活动区耗尽，冻结记录解冻。',*view())
        x=heapq.heappop(active);runs[-1].append(x);t.emit('输出活动区最小值',f'输出{x}。',*view())
        if p<len(data):
            y=data[p];p+=1;heapq.heappush(active if y>=x else frozen,y);t.emit('补入并决定冻结',f'{y} '+('不小于' if y>=x else '小于')+f' {x}，进入'+('活动区。' if y>=x else '冻结区。'),*view())
    require(all(a==sorted(a) for a in runs) and sorted(x for a in runs for x in a)==sorted(data),'初始段核验失败');return t.finish(dict(runs=runs))


@algorithm('sparse-transpose','稀疏矩阵快速转置',['快速转置','稀疏矩阵','三元组'],{'matrix':[[0,4,0],[2,0,3],[0,0,5],[6,0,0]]},'408／数组矩阵')
def sparse(t,d):
    a=d.get('matrix');require(isinstance(a,list) and 1<=len(a)<=8,'矩阵行数1…8');a=[ints(r,8) for r in a];require(a[0] and all(len(r)==len(a[0]) for r in a),'矩阵须为非空矩形');n=len(a[0]);triples=[(i,j,v) for i,r in enumerate(a) for j,v in enumerate(r) if v];count=[0]*n;start=[0]*n;out=[None]*len(triples);b=[[0]*len(a) for _ in range(n)]
    def view(active=None):return [grid('原矩阵',a,active=active or []),grid('转置矩阵',b),table('列计数与下一个存放位置',['原列','num','cpot'],[[j,count[j],start[j]] for j in range(n)]),boxes('三元组',{'原三元组':triples,'目标三元组':out})]
    t.emit('初始化','按原列计数，定位转置后每行在三元组表的起始下标。',*view())
    for i,j,v in triples:count[j]+=1;t.emit('统计原列非零数',f'num[{j}]={count[j]}。',*view([[i,j]]))
    for j in range(1,n):start[j]=start[j-1]+count[j-1];t.emit('计算起始位置',f'cpot[{j}]=cpot[{j-1}]+num[{j-1}]={start[j]}。',*view())
    for i,j,v in triples:
        p=start[j];out[p]=(j,i,v);b[j][i]=v;start[j]+=1;t.emit('定位并写入',f'原({i},{j},{v})写到三元组位置{p}，对应转置格({j},{i})。',*view([[i,j]]))
    require(b==[list(r) for r in zip(*a)],'转置核验失败');return t.finish(dict(matrix=b,triples=out))


@algorithm('bracket-stack','栈应用：括号匹配',['括号匹配','括号检查'],{'text':'{[()]}()'},'408／栈应用')
def brackets(t,d):
    text=d.get('text');require(type(text)is str and len(text)<=60,'text至多60字符');stack=[];valid=True
    for i,ch in enumerate(text):
        if ch in '([{':stack.append(ch);ex=f'左括号{ch}入栈。'
        elif ch in ')]}':
            if not stack or stack[-1]!='([{'[')]}'.index(ch)]:valid=False;ex=f'{ch} 与栈顶不匹配。'
            else:stack.pop();ex=f'{ch} 匹配并弹出栈顶。'
        else:ex='非括号字符跳过。'
        t.emit('括号扫描',ex,seq('输入',text,{'i':i}),boxes('括号栈',{'栈底→栈顶':stack}))
        if not valid:break
    if not text:t.emit('空输入','空串括号平衡。',seq('输入',[]))
    return t.finish(dict(valid=valid and not stack))
