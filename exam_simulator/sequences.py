from .core import algorithm, require, ints, seq, grid, boxes, table, tree
from collections import deque
import bisect
import heapq

SORT_DEFAULT = {'array':[7,3,5,3,1,8,2]}

def sort_trace(t,d):
    a=ints(d.get('array')); original=a[:]; key=t.key
    def emit(label,why,p=None,*extra): t.emit(label,why,seq('待排序序列',a,p or {}),*extra)
    emit('初始序列','所有下标从 0 开始；每次比较、移动、交换都保留真实快照。')
    if key in ('insertion','binary-insertion','shell'):
        gaps=d.get('gaps',[len(a)//2**i for i in range(1,len(a).bit_length()+1) if len(a)//2**i] if key=='shell' else [1])
        require(isinstance(gaps,list) and all(type(g) is int and g>0 for g in gaps) and (len(a)<=1 or bool(gaps) and gaps[-1]==1), '增量必须为正整数且最后为 1')
        for gap in gaps:
            for i in range(gap,len(a)):
                value=a[i]; j=i; target=None
                if key=='binary-insertion':
                    lo,hi=0,i
                    while lo<hi:
                        mid=(lo+hi)//2
                        emit('折半定位插入点',f'{a[mid]} ≤ {value} 时向右，保证重复值的稳定顺序。',{'lo':lo,'hi(开)':hi,'mid':mid,'待插入':i})
                        if a[mid]<=value: lo=mid+1
                        else: hi=mid
                    target=lo
                a[i]=None
                emit('暂存关键字',f'暂存 key={value}，下标 {i} 是空位；增量 gap={gap}。',{'空位':j},boxes('辅助存储',{'key':[value]}))
                while j>=gap and (j>target if target is not None else a[j-gap]>value):
                    emit('比较前驱',f'前驱 a[{j-gap}]={a[j-gap]}，key={value}，需要右移。',{'前驱':j-gap,'空位':j},boxes('辅助存储',{'key':[value]}))
                    a[j]=a[j-gap]; a[j-gap]=None; j-=gap
                    emit('右移并更新空位',f'元素移动到 {j+gap}，空位移至 {j}。',{'空位':j},boxes('辅助存储',{'key':[value]}))
                a[j]=value
                emit('插入关键字',f'a[{j}]={value}；本增量分组的有序前缀扩大。',{'插入点':j,'扫描':i})
    elif key=='selection':
        for i in range(len(a)):
            m=i
            for j in range(i+1,len(a)):
                old=m
                if a[j]<a[m]:m=j
                emit('选择最小关键字',f'比较 a[{j}]={a[j]} 与 a[{old}]={a[old]}，min={m}。',{'i':i,'j':j,'min':m})
            a[i],a[m]=a[m],a[i]; emit('交换到有序区',f'交换 {i} 与 {m}，前缀 [0,{i}] 已确定。',{'已确定':i})
    elif key=='bubble':
        for end in range(len(a)-1,0,-1):
            changed=False
            for j in range(end):
                emit('相邻比较',f'{a[j]} > {a[j+1]}：{a[j]>a[j+1]}。',{'left':j,'right':j+1,'本轮终点':end})
                if a[j]>a[j+1]:
                    a[j],a[j+1]=a[j+1],a[j]; changed=True; emit('交换逆序对','本轮最大值向右移动。',{'left':j,'right':j+1})
            if not changed: emit('提前结束','本轮无交换，整个序列已有序。'); break
    elif key=='quick':
        def quick(l,r):
            if l>=r:return
            pivot=a[(l+r)//2]; i,j=l,r
            emit('选择划分基准',f'Hoare 双指针划分 [{l},{r}]，pivot={pivot}。',{'i':i,'j':j},boxes('暂存',{'pivot':[pivot]}))
            while i<=j:
                while a[i]<pivot:
                    emit('左指针右移',f'a[{i}]={a[i]} < {pivot}，i 从 {i} 移到 {i+1}。',{'i':i,'j':j}); i+=1
                while a[j]>pivot:
                    emit('右指针左移',f'a[{j}]={a[j]} > {pivot}，j 从 {j} 移到 {j-1}。',{'i':i,'j':j}); j-=1
                if i<=j:
                    a[i],a[j]=a[j],a[i]; emit('交换并推进双指针',f'交换下标 {i} 和 {j}；随后 i++、j--，相等关键字也推进，避免死循环。',{'i':i,'j':j}); i+=1;j-=1
            emit('划分完成',f'递归处理 [{l},{j}] 与 [{i},{r}]。',{'下一段左':i,'上一段右':j})
            quick(l,j);quick(i,r)
        quick(0,len(a)-1)
    elif key=='merge':
        def merge(l,r):
            if r-l<2:return
            m=(l+r)//2; emit('划分归并区间',f'[{l},{r}) 分为 [{l},{m})、[{m},{r})。',{'left':l,'mid':m,'right(开)':r});merge(l,m);merge(m,r)
            left,right=a[l:m],a[m:r]; i=j=0; out=[]
            while i<len(left) or j<len(right):
                takeleft=j==len(right) or (i<len(left) and left[i]<=right[j])
                why='左段耗尽' if i==len(left) else '右段耗尽' if j==len(right) else f'{left[i]} ≤ {right[j]}：{takeleft}'
                if takeleft:out.append(left[i]);i+=1
                else:out.append(right[j]);j+=1
                t.emit('双路归并取值',why+'；相等时先取左段，保持稳定性。',seq('左有序段',left,{'i':i}),seq('右有序段',right,{'j':j}),seq('归并缓冲区',out))
            for k,v in enumerate(out):a[l+k]=v;emit('写回原序列',f'a[{l+k}]={v}。',{'写入':l+k})
        merge(0,len(a))
    elif key=='heap-sort':
        def view(size):return tree('大根堆',[dict(id=str(i),label=str(v),mark='done' if i>=size else '') for i,v in enumerate(a)],[dict(source=str((i-1)//2),target=str(i)) for i in range(1,size)])
        def sift(root,size):
            while 2*root+1<size:
                c=2*root+1
                if c+1<size:
                    emit('比较两个子节点',f'{a[c]} 与 {a[c+1]}，选择较大子节点。',{'父':root,'左子':c,'右子':c+1},view(size))
                    if a[c+1]>a[c]:c+=1
                emit('父子比较',f'a[{root}]={a[root]} ≥ a[{c}]={a[c]}：{a[root]>=a[c]}。',{'父':root,'子':c},view(size))
                if a[root]>=a[c]:break
                a[root],a[c]=a[c],a[root];emit('下沉交换',f'交换 {root} 和 {c}。',{'父':root,'子':c},view(size));root=c
        for i in range(len(a)//2-1,-1,-1):sift(i,len(a))
        for end in range(len(a)-1,0,-1):
            a[0],a[end]=a[end],a[0];emit('堆顶输出到有序后缀',f'最大值放到 {end}；堆范围缩小到 [0,{end})。',{'输出位置':end},view(end));sift(0,end)
    elif key=='counting':
        lo=min(a,default=0); hi=max(a,default=0);require(hi-lo<=100,'计数范围至多 100')
        counts=[0]*(hi-lo+1)
        for i,v in enumerate(a):counts[v-lo]+=1;emit('统计频数',f'count[{v}] 增为 {counts[v-lo]}。',{'扫描':i},seq('关键字频数',counts,{'更新':v-lo}))
        a=[]
        for k,c in enumerate(counts):
            for _ in range(c):a.append(k+lo);emit('按关键字顺序输出',f'输出 {k+lo}。',{},seq('频数表',counts))
    elif key=='radix':
        shift=max(0,-min(a,default=0)); place=1
        while max((v+shift for v in a),default=0)//place:
            buckets={str(i):[] for i in range(10)}
            for v in a:
                digit=((v+shift)//place)%10;buckets[str(digit)].append(v)
                t.emit('按当前位分配',f'位权={place}，偏移={shift}，({v}+{shift})//{place}%10={digit}。',seq('本轮输入',a),boxes('0…9 号桶',buckets))
            a=[]
            for b in buckets.values():
                for v in b:a.append(v);t.emit('稳定收集',f'按桶号及桶内原顺序收集 {v}。',seq('已收集序列',a),boxes('分配结果',buckets))
            place*=10
    require(a==sorted(original),'排序独立校验失败')
    emit('排序完成','已核对有序性、元素与重复次数。')
    return t.finish(a)

for _id,_name,_aliases in [
 ('insertion','直接插入排序',['插入排序','insertion sort']),('binary-insertion','折半插入排序',['二分插入排序','binary insertion']),('shell','希尔排序',['Shell']),('selection','简单选择排序',['选择排序','selection sort']),('bubble','冒泡排序',['bubble']),('quick','快速排序',['快排','quicksort']),('merge','二路归并排序',['归并排序','merge sort']),('heap-sort','堆排序',['heapsort']),('counting','计数排序',['counting sort']),('radix','基数排序',['radix'])]:
    algorithm(_id,_name,_aliases,SORT_DEFAULT,'408／排序')(sort_trace)

@algorithm('binary','折半查找',['二分查找','binary search'],{'array':[1,3,5,7,9,11],'target':7},'408／查找')
def binary(t,d):
    a=ints(d.get('array'));target=d.get('target');require(type(target)is int and a==sorted(a),'输入须升序且 target 为整数')
    l,r=0,len(a)-1;result=-1
    while l<=r:
        m=(l+r)//2;t.emit('中点比较',f'mid=({l}+{r})//2={m}，a[mid]={a[m]}，target={target}。',seq('有序表',a,{'left':l,'mid':m,'right':r}))
        if a[m]==target:result=m;break
        if a[m]<target:l=m+1
        else:r=m-1
        t.emit('更新查找区间',f'新的闭区间 [{l},{r}]。',seq('有序表',a,{'left':l,'right':r}))
    require((result==-1 and target not in a) or (0<=result<len(a) and a[result]==target),'查找校验失败')
    t.emit('查找结束','空区间代表不存在；命中时返回一个合法下标。',seq('有序表',a,{'结果':result}));return t.finish(result)

@algorithm('sequential','顺序查找',['顺序查找','线性查找'],{'array':[9,2,7,4],'target':7},'408／查找')
def sequential(t,d):
    a=ints(d.get('array'));target=d.get('target');result=-1
    for i,v in enumerate(a):
        t.emit('逐项比较',f'a[{i}]={v} == {target}：{v==target}。',seq('顺序表',a,{'i':i}))
        if v==target:result=i;break
    t.emit('结束',f'返回 {result}。',seq('顺序表',a,{'命中':result}));return t.finish(result)

@algorithm('two-pointer','双指针两数之和',['双指针','两数之和','two sum'],{'array':[1,2,4,6,9],'target':10},'常见扩展／双指针')
def two_pointer(t,d):
    a=ints(d.get('array'));require(a==sorted(a) and type(d.get('target')) is int,'双指针示例要求升序和整数 target');l,r=0,len(a)-1;answer=[]
    while l<r:
        s=a[l]+a[r];t.emit('双指针比较',f'{a[l]}+{a[r]}={s}，目标 {d["target"]}。',seq('有序序列',a,{'left':l,'right':r}))
        if s==d['target']:answer=[l,r];break
        if s<d['target']:l+=1;why='总和偏小，左指针右移以增大和'
        else:r-=1;why='总和偏大，右指针左移以减小和'
        t.emit('移动指针',why,seq('有序序列',a,{'left':l,'right':r}))
    require(bool(answer)==any(a[i]+a[j]==d['target'] for i in range(len(a)) for j in range(i+1,len(a))),'双指针校验失败')
    t.emit('结束',f'下标对：{answer}。',seq('有序序列',a,{'left':l,'right':r}));return t.finish(answer)

@algorithm('linked-list','链表插入删除与逆置',['单链表','链表','链表逆置','链表反转','linked list','linked lists','singly linked list','singly linked lists'],{'array':[1,3,5],'operations':[['insert',1,2],['delete',2],['reverse']]},'408／线性表')
def linked(t,d):
    a=ints(d.get('array'));nodes=[dict(id=str(i),value=v) for i,v in enumerate(a)];nextid=len(a)
    def view():
        edges=[dict(source=nodes[i]['id'],target=nodes[i+1]['id'],label='next') for i in range(len(nodes)-1)]
        if t.key=='doubly-linked':edges += [dict(source=nodes[i]['id'],target=nodes[i-1]['id'],label='prev',kind='thread') for i in range(1,len(nodes))]
        if t.key=='circular-linked' and nodes:edges.append(dict(source=nodes[-1]['id'],target=nodes[0]['id'],label='尾 next → head',kind='thread'))
        return tree('链式结点（稳定编号）',[dict(id=n['id'],label=f'{n["id"]}: {n["value"]}') for n in nodes],edges,[nodes[0]['id']] if nodes else [])
    t.emit('头指针初始化','空链表 head=NULL；非空 head 指向第一个结点。',view(),seq('逻辑顺序',[n['value'] for n in nodes]))
    ops=d.get('operations',[]);require(isinstance(ops,list) and len(ops)<=20,'操作至多 20 条')
    for op in ops:
        require(isinstance(op,list) and op,'操作格式错误')
        if op[0]=='insert':
            require(len(op)==3 and type(op[1])is int and 0<=op[1]<=len(nodes) and type(op[2])is int,'insert 格式：[insert,位置,值]');p=op[1]
            t.emit('定位插入前驱',f'位置 {p}；先令新结点 next 指向原后继，再令前驱 next 指向新结点，不能反序丢链。',view(),boxes('待接入结点',{'new':[op[2]]}))
            nodes.insert(p,dict(id=str(nextid),value=op[2]));nextid+=1
        elif op[0]=='delete':
            require(len(op)==2 and type(op[1])is int and 0<=op[1]<len(nodes),'delete 位置无效');p=op[1]
            t.emit('定位删除结点',f'记录位置 {p} 的后继，前驱 next 将绕过该结点。',view(),seq('逻辑顺序',[n['value'] for n in nodes],{'待删':p}));nodes.pop(p)
        elif op[0]=='reverse':
            old=nodes[:];result=[]
            while old:
                current=old.pop(0);result.insert(0,current)
                t.emit('头插法逆置',f'先保存后继，再将结点 {current["id"]} 接到逆置区表头。',boxes('两条链的流转',{'待处理':[n['value'] for n in old],'已逆置':[n['value'] for n in result]}))
            nodes=result
        else:raise ValueError('仅支持 insert、delete、reverse')
        t.emit('指针更新完成','快照保留真实结点编号，插入删除不会重编号。',view(),seq('逻辑顺序',[n['value'] for n in nodes]))
    return t.finish([n['value'] for n in nodes])

algorithm('doubly-linked','双向链表',['双链表','双向链表','doubly linked list','doubly linked lists'],{'array':[1,3,5],'operations':[['insert',1,2],['delete',2],['reverse']]},'408／线性表')(linked)
algorithm('circular-linked','循环链表',['循环链表','circular linked list','circular linked lists'],{'array':[1,3,5],'operations':[['insert',1,2],['delete',2],['reverse']]},'408／线性表')(linked)

@algorithm('sequence-list','顺序表操作',['顺序表','顺序表插入','线性表基本操作'],{'array':[2,4,6],'operations':[['insert',1,3],['delete',2]]},'408／线性表')
def sequence_list(t,d):
    a=ints(d.get('array'));ops=d.get('operations',[]);require(isinstance(ops,list) and len(ops)<=20,'操作至多20条')
    t.emit('初始化','顺序表在连续下标中存放元素。',seq('顺序表',a))
    for op in ops:
        require(isinstance(op,list) and len(op)>=2 and type(op[1])is int,'操作需给出整数位置');p=op[1]
        if op[0]=='insert':
            require(len(op)==3 and type(op[2])is int and 0<=p<=len(a) and len(a)<40,'插入参数错误');a.append(None)
            for i in range(len(a)-1,p,-1):a[i]=a[i-1];a[i-1]=None;t.emit('元素右移',f'a[{i}]=a[{i-1}]，空位左移。',seq('顺序表',a,{'空位':i-1}))
            a[p]=op[2]
        elif op[0]=='delete':
            require(0<=p<len(a),'删除位置无效');a[p]=None
            for i in range(p,len(a)-1):a[i]=a[i+1];a[i+1]=None;t.emit('元素左移',f'a[{i}]=a[{i+1}]。',seq('顺序表',a,{'空位':i+1}))
            a.pop()
        else:raise ValueError('顺序表支持 insert、delete')
        t.emit('操作完成',f'长度={len(a)}。',seq('顺序表',a))
    return t.finish(a)

def containers(t,d):
    operations=d.get('operations',[]);require(isinstance(operations,list) and len(operations)<=40,'操作至多40条');a=[];out=[];capacity=d.get('capacity',5)
    require(type(capacity)is int and 1<=capacity<=20,'capacity 为1…20');front=rear=0;ring=[None]*capacity
    def views():
        if t.key=='circular-queue':return [seq('循环队列物理存储',ring,{'front':front,'rear(下次写入)':rear}),boxes('队首到队尾',{'逻辑队列':a,'输出':out})]
        return [boxes('容器流转',{'栈底→栈顶' if t.key=='stack' else '队首→队尾':a,'输出':out})]
    introduction = {
        'stack': '栈的基本操作只作用于栈顶并遵循后进先出规则。',
        'queue': '队列在队尾入队并在队首出队以遵循先进先出规则。',
        'circular-queue': '循环队列通过计数区分空与满并允许使用全部容量。',
        'deque': '双端队列允许从两端插入和删除元素。',
    }
    t.emit('初始化',introduction[t.key],*views(),count=0)
    for raw in operations:
        op=raw.split() if isinstance(raw,str) else raw;require(isinstance(op,list) and op,'操作格式错误');name=op[0]
        allowed={'stack':{'push','pop','peek','empty'},'queue':{'enqueue','dequeue','peek','empty'},'circular-queue':{'enqueue','dequeue','peek','empty'},'deque':{'push-left','push-right','pop-left','pop-right','peek','empty'}}
        require(name in allowed[t.key],'该容器不支持此操作')
        if name in ('push','enqueue','push-left','push-right'):
            require(len(op)==2 and (type(op[1])is int or isinstance(op[1],str) and op[1].lstrip('-').isdigit()),'插入值须整数');v=int(op[1])
            if t.key=='circular-queue' and len(a)==capacity:out.append('满队列');why='count==capacity，拒绝入队，不覆盖有效元素'
            else:
                if name=='push-left':a.insert(0,v)
                else:a.append(v)
                if t.key=='circular-queue':ring[rear]=v;old=rear;rear=(rear+1)%capacity;why=f'写入位置 {old}，rear=({old}+1)%{capacity}={rear}'
                else:why=f'插入 {v}'
        elif name in ('pop','dequeue','pop-left','pop-right','peek','empty'):
            if name=='empty':out.append(not a);why='只检查是否为空，不修改容器'
            elif not a:out.append('空容器');why='容器为空，拒绝读取／移除'
            elif name=='peek':out.append(a[-1] if t.key=='stack' else a[0]);why='读取端点但不移除'
            else:
                last=t.key=='stack' or name=='pop-right';v=a.pop(-1 if last else 0);out.append(v);why=f'移除端点 {v}'
                if t.key=='circular-queue':ring[front]=None;old=front;front=(front+1)%capacity;why+=f'；front=({old}+1)%{capacity}={front}'
        else:raise ValueError('操作不在容器规范中')
        t.emit('执行 '+str(raw),why,*views(),count=len(a))
    return t.finish(dict(data=a,output=out,front=front,rear=rear))

for _id,_name,_aliases,_ops in [('stack','栈基本操作',['栈相关基础','stack','栈算法','栈'],['push 3','push 7','peek','pop','empty']),('queue','队列基本操作',['链队列','队列算法','queue','队列'],['enqueue 3','enqueue 7','dequeue','peek']),('circular-queue','循环队列',['环形队列','circular queue'],['enqueue 1','enqueue 2','dequeue','enqueue 3','enqueue 4','enqueue 5']),('deque','双端队列',['deque'],['push-left 2','push-right 3','pop-left','pop-right'])]:algorithm(_id,_name,_aliases,{'operations':_ops,'capacity':4},'408／栈和队列')(containers)

def kmp(t,d):
    pattern=d.get('pattern','');text=d.get('text','');require(type(pattern)is str and type(text)is str and len(pattern)<=24 and len(text)<=40,'模式至多24字符，文本至多40字符');p=list(pattern);lps=[0]*len(p);j=0
    for i in (range(1,len(p)) if t.key!='naive-match' else []):
        while j and p[i]!=p[j]:
            t.emit('前缀失配回退',f'p[{i}]={p[i]} ≠ p[{j}]={p[j]}，j=lps[{j-1}]={lps[j-1]}。',seq('模式',p,{'i':i,'j':j}),seq('lps',lps));j=lps[j-1]
        if p[i]==p[j]:j+=1
        lps[i]=j;t.emit('写入前缀长度',f'lps[{i}]={j}。',seq('模式',p,{'i':i,'j':j}),seq('lps',lps,{'更新':i}))
    nxt=[-1]+lps[:-1] if p else [];nv=nxt[:]
    for i in (range(1,len(p)) if t.key!='naive-match' else []):
        k=nxt[i];nv[i]=nv[k] if k>=0 and p[i]==p[k] else k
        t.emit('nextval 优化',f'next[{i}]={k}；相等字符导致重复失配时，直接继承更早回退位置 {nv[i]}。',seq('模式',p,{'i':i,'回退':k}),seq('next（首项 −1）',nxt),seq('nextval',nv))
    if t.key=='kmp-period':
        period=len(p)-lps[-1] if p else 0;cyclic=period if period and len(p)%period==0 else len(p)
        t.emit('判定最小循环节',f'n−lps[n−1]={period}；只有整除 n 才能整串重复，否则循环节为 n。',seq('模式',p),seq('前缀函数',lps));return t.finish(dict(lps=lps,next=nxt,nextval=nv,period=cyclic))
    if t.key=='naive-match':
        result=-1
        for start in range(len(text)-len(p)+1):
            i=0
            while i<len(p):
                t.emit('朴素逐字符比较',f'text[{start+i}] 与 pattern[{i}] 比较。',seq('文本',list(text),{'i':start+i}),seq('模式',p,{'j':i}))
                if text[start+i]!=p[i]:break
                i+=1
            if i==len(p):result=start;break
    else:
        i=j=0;result=0 if not p else -1
        while p and i<len(text):
            t.emit('KMP 字符比较',f'text[{i}]={text[i]}，pattern[{j}]={p[j]}。文本指针不回退。',seq('文本',list(text),{'i':i}),seq('模式',p,{'j':j}),seq('lps',lps))
            if text[i]==p[j]:i+=1;j+=1
            elif j:j=lps[j-1]
            else:i+=1
            if j==len(p):result=i-j;break
    require(result==text.find(pattern),'匹配独立校验失败')
    t.emit('匹配完成',f'首次匹配下标 {result}，已与独立原生查找校验。',seq('文本',list(text),{'匹配起点':result}),seq('模式',p),seq('lps',lps));return t.finish(dict(index=result,lps=lps,next=nxt,nextval=nv))

for _id,_name,_aliases in [('kmp','KMP 模式匹配',['KMP算法','KMP匹配']),('kmp-period','KMP 周期与 nextval',['周期判定','nextval','KMP扩展','最小循环节']),('naive-match','朴素字符串匹配',['BF匹配','暴力匹配'])]:algorithm(_id,_name,_aliases,{'text':'ABABABCABAB','pattern':'ABABC'},'408／串')(kmp)
