"""Standard index search, linear-list merging and tree transformations."""
from .core import algorithm,require,ints,seq,boxes,table,tree

@algorithm('block-search','分块查找',['分块查找','索引顺序查找'],{'blocks':[[3,1,5],[8,6,10],[14,11,17]],'target':6},'408／查找')
def block_search(t,d):
    blocks=d.get('blocks');require(isinstance(blocks,list) and 1<=len(blocks)<=8,'blocks为1…8个非空块');blocks=[ints(a,8) for a in blocks];require(all(blocks),'块不能为空');require(all(max(blocks[i])<min(blocks[i+1]) for i in range(len(blocks)-1)),'块间须有序，块内可无序');target=d.get('target');require(type(target)is int,'target为整数');index=[max(a) for a in blocks];result=None
    def view(i=None,j=None):return [seq('块最大关键字索引',index,{'block':i} if i is not None else {}),boxes('各数据块',{f'块{k}':a for k,a in enumerate(blocks)}),seq('当前块',blocks[i] if i is not None else [],{'j':j} if j is not None else {})]
    t.emit('初始化索引','先定位候选块，再在块内顺序查找。',*view())
    for i,maximum in enumerate(index):
        t.emit('查索引',f'{target} ≤ {maximum}：{target<=maximum}。',*view(i))
        if target>maximum:continue
        for j,v in enumerate(blocks[i]):
            t.emit('块内查找',f'{v} == {target}：{v==target}。',*view(i,j))
            if v==target:result=[i,j];break
        break
    require(bool(result)==any(target in a for a in blocks),'索引查找校验失败');return t.finish(result)

@algorithm('chained-hash','哈希表：拉链法',['拉链法','链地址法','分离链接'],{'capacity':5,'operations':[['insert',7],['insert',12],['insert',2],['delete',12],['search',2]]},'408／散列')
def chained_hash(t,d):
    m=d.get('capacity');require(type(m)is int and 1<=m<=20,'capacity为1…20');buckets=[[] for _ in range(m)];ops=d.get('operations');require(isinstance(ops,list) and len(ops)<=35,'operations至多35项');expected=set();answers=[]
    def view(i=None,j=None):return [boxes('桶与链',{f'桶{k}':a for k,a in enumerate(buckets)}),seq('当前桶链',buckets[i] if i is not None else [],{'结点':j} if j is not None else {})]
    t.emit('初始化桶','冲突键链接到同一个桶的链中。',*view())
    for op in ops:
        require(isinstance(op,list) and len(op)==2 and op[0] in('insert','delete','search') and type(op[1])is int,'操作为[insert/delete/search,整数]');action,k=op;i=k%m;t.emit('计算桶号',f'{k} % {m} = {i}。',*view(i));found=None
        for j,x in enumerate(buckets[i]):
            t.emit('沿链比较',f'{x} == {k}：{x==k}。',*view(i,j))
            if x==k:found=j;break
        if action=='insert' and found is None:buckets[i].append(k);expected.add(k)
        elif action=='delete' and found is not None:buckets[i].pop(found);expected.remove(k)
        elif action=='search':answers.append(found is not None)
        t.emit('更新桶链',f'{action}({k})完成。',*view(i));require(sorted(x for a in buckets for x in a)==sorted(expected),'桶链集合错误')
    return t.finish(dict(buckets=buckets,searchResults=answers))

@algorithm('sorted-list-merge','有序双表归并',['双表合并','合并有序链表','有序表合并','有序链表合并'],{'left':[1,3,5,7],'right':[2,3,6]},'408／线性表')
def list_merge(t,d):
    a=ints(d.get('left'));b=ints(d.get('right'));require(a==sorted(a) and b==sorted(b),'两个输入表均须有序');i=j=0;out=[]
    def view():return [seq('左表',a,{'i':i}),seq('右表',b,{'j':j}),seq('结果表',out)]
    t.emit('初始化双表','两个读指针独立推进，相等先取左表。',*view())
    while i<len(a) or j<len(b):
        take=j==len(b) or (i<len(a) and a[i]<=b[j]);why='右表已空' if j==len(b) else '左表已空' if i==len(a) else f'{a[i]} ≤ {b[j]}：{take}';t.emit('比较表首',why,*view())
        if take:out.append(a[i]);i+=1
        else:out.append(b[j]);j+=1
        t.emit('取值并推进',f'追加{out[-1]}，对应读指针加一。',*view())
    require(out==sorted(a+b),'双表归并校验失败');return t.finish(out)

@algorithm('tree-rebuild','由先序中序重建二叉树',['重建二叉树','先序中序','先序和中序','前序与中序'],{'preorder':[1,2,4,5,3,6],'inorder':[4,2,5,1,3,6]},'408／树')
def rebuild(t,d):
    pre=ints(d.get('preorder'),20);ino=ints(d.get('inorder'),20);require(len(pre)==len(ino) and len(set(pre))==len(pre) and set(pre)==set(ino),'结点键须唯一，两序列集合一致');nodes=[];edges=[];stack=[];index={x:i for i,x in enumerate(ino)}
    def view():return [seq('先序',pre),seq('中序',ino),tree('构造中的二叉树',nodes,edges,[str(pre[0])] if pre else []),boxes('递归区间',{'调用栈':stack})]
    t.emit('初始化','先序首项是根，中序根位置划分左右子树。',*view())
    def visit(p,l,r,parent=None,side=''):
        if l>=r:return None
        root=pre[p];mid=index[root];require(l<=mid<r,'先序与中序不对应同一棵树');stack.append([p,l,r]);nodes.append(dict(id=str(root),label=str(root)))
        if parent is not None:edges.append(dict(source=str(parent),target=str(root),label=side))
        t.emit('确定根并划分区间',f'pre[{p}]={root}，中序位置{mid}；左[{l},{mid})、右[{mid+1},{r})。',*view())
        left=visit(p+1,l,mid,root,'L');right=visit(p+1+mid-l,mid+1,r,root,'R');stack.pop();t.emit('子树返回',f'{root}的左右子树已完成。',*view());return [root,left,right]
    return t.finish(dict(tree=visit(0,0,len(pre))))

@algorithm('forest-conversion','树与森林的孩子兄弟表示',['孩子兄弟','森林转换','树转二叉树','森林转二叉树'],{'parent':[-1,0,0,0,1,1,-1,6]},'408／树和森林')
def forest(t,d):
    parent=ints(d.get('parent'),24,-1,23);n=len(parent);require(all(p==-1 or 0<=p<n and p!=i for i,p in enumerate(parent)),'父指针越界或自环');children={i:[] for i in range(n)};roots=[];left=[None]*n;right=[None]*n;converted=[]
    for i,p in enumerate(parent):
        if p<0:roots.append(i)
        else:children[p].append(i)
        seen=set();u=i
        while u>=0:require(u not in seen,'父指针中存在环');seen.add(u);u=parent[u]
    original=[dict(source=str(p),target=str(i)) for i,p in enumerate(parent) if p>=0];nodes=[dict(id=str(i),label=str(i)) for i in range(n)]
    def view():return [tree('原森林',nodes,original,[str(i) for i in roots]),tree('左孩子右兄弟表示',nodes,converted,[str(roots[0])] if roots else []),table('指针表',['结点','firstChild','nextSibling'],[[i,left[i],right[i]] for i in range(n)])]
    t.emit('初始化','同一父结点的孩子按编号排列，各根也视为兄弟。',*view())
    for p,kids in list(children.items())+[(-1,roots)]:
        if p>=0 and kids:left[p]=kids[0];converted.append(dict(source=str(p),target=str(kids[0]),label='左：首孩子'));t.emit('连接首孩子',f'{p}.left={kids[0]}。',*view())
        for a,b in zip(kids,kids[1:]):right[a]=b;converted.append(dict(source=str(a),target=str(b),label='右：兄弟'));t.emit('连接下个兄弟',f'{a}.right={b}。',*view())
    return t.finish(dict(firstChild=left,nextSibling=right))

@algorithm('expression-stack','栈应用：中缀转后缀与求值',['表达式求值','中缀转后缀','逆波兰','后缀表达式'],{'expression':'3 + 4 * (2 - 1)'},'408／栈应用')
def expression(t,d):
    import re
    source=d.get('expression');require(type(source)is str and len(source)<=100,'expression至多100字符');tokens=re.findall(r'\d+|[()+*/-]',source);require(''.join(tokens)==re.sub(r'\s+','',source),'仅支持整数、二元+-*/与括号');ops=[];output=[];values=[];priority={'+':1,'-':1,'*':2,'/':2};expect=True
    def view(i=None):return [seq('输入 token',tokens,{'i':i} if i is not None else {}),boxes('工作栈与输出',{'运算符栈':ops,'后缀序列':output,'求值栈':values})]
    t.emit('初始化表达式','二元运算，负数写为(0-x)；乘除优先于加减，同级左结合。',*view())
    for i,tok in enumerate(tokens):
        if tok.isdigit():require(expect,'缺少运算符');output.append(int(tok));expect=False
        elif tok=='(':require(expect,'左括号前缺少运算符');ops.append(tok)
        elif tok==')':
            require(not expect,'缺少操作数')
            while ops and ops[-1]!='(':output.append(ops.pop());t.emit('弹出括号内运算符','右括号触发弹栈。',*view(i))
            require(ops and ops[-1]=='(','括号不匹配');ops.pop();expect=False
        else:
            require(not expect,'二元运算缺少左操作数')
            while ops and ops[-1]!='(' and priority[ops[-1]]>=priority[tok]:output.append(ops.pop());t.emit('优先级弹栈','栈顶优先级不小于当前运算符，先输出栈顶。',*view(i))
            ops.append(tok);expect=True
        t.emit('处理 token',f'处理{tok}。',*view(i))
    require(not expect,'表达式不完整')
    while ops:require(ops[-1]!='(','括号不匹配');output.append(ops.pop());t.emit('清空符号栈','输入结束，输出剩余运算符。',*view())
    for tok in output:
        if type(tok)is int:values.append(tok)
        else:
            require(len(values)>=2,'操作数不足');b=values.pop();a=values.pop();require(tok!='/' or b!=0,'除数不能为0');values.append(a+b if tok=='+' else a-b if tok=='-' else a*b if tok=='*' else a/b)
        t.emit('后缀求值',f'读取{tok}；运算时先弹右操作数，再弹左操作数。',*view())
    require(len(values)==1,'求值栈错误');return t.finish(dict(postfix=output,value=values[0]))
