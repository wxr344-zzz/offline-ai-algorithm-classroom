from .core import algorithm, require, ints, seq, grid, boxes, table, tree
from functools import lru_cache
from itertools import product, combinations
import math

def knapsack(t,d):
    w=ints(d.get('weights'),6,1,50);v=ints(d.get('values'),6,0,1000);cap=d.get('capacity');require(len(w)==len(v) and type(cap)is int and 0<=cap<=40,'重量价值须等长，容量0…40')
    counts=ints(d.get('counts',[1]*len(w)),6,0,5) if t.key=='bounded-knapsack' else [cap//x if t.key=='complete-knapsack' else 1 for x in w]
    require(len(counts)==len(w),'counts须等长');n=len(w);dp=[[0]*(cap+1) for _ in range(n+1)]
    rows=['不用物品']+[f'物品{i}:w={w[i-1]},v={v[i-1]}' for i in range(1,n+1)]
    def view(i=0,c=0,deps=None):return grid('背包 DP：行=允许物品，列=容量',dp,rows,list(range(cap+1)),[[i,c]],deps or [])
    t.emit('初始化边界','dp[0][c]=0；最多使用前0件物品时价值为0。',view(),table('物品表',['物品（从1编号）','重量','价值','可用件数'],[[i+1,w[i],v[i],counts[i]] for i in range(n)]))
    for i in range(1,n+1):
        for c in range(cap+1):
            dp[i][c]=dp[i-1][c]
            if t.key=='bounded-knapsack':
                for k in range(min(counts[i-1],c//w[i-1])+1):
                    candidate=dp[i-1][c-k*w[i-1]]+k*v[i-1];old=dp[i][c];dp[i][c]=max(old,candidate)
                    t.emit('枚举本物品件数',f'k={k}：dp[{i-1}][{c-k*w[i-1]}]+{k}×{v[i-1]}={candidate}；max({old},{candidate})={dp[i][c]}。',view(i,c,[[i-1,c-k*w[i-1]]]))
            else:
                row=i if t.key=='complete-knapsack' else i-1
                candidate=dp[row][c-w[i-1]]+v[i-1] if c>=w[i-1] else None
                if candidate is not None:dp[i][c]=max(dp[i][c],candidate)
                why=f'容量{c}不足重量{w[i-1]}，沿用上一行{dp[i-1][c]}' if candidate is None else f'不选={dp[i-1][c]}；选择=dp[{row}][{c-w[i-1]}]+{v[i-1]}={candidate}；取较大值{dp[i][c]}。'+('选择项来自本行，允许重复使用。' if row==i else '选择项来自上一行，禁止重复使用。')
                deps=[[i-1,c]]+([[row,c-w[i-1]]] if candidate is not None else [])
                t.emit('逐格计算',why,view(i,c,deps))
    @lru_cache(None)
    def reference(i,c):
        if i==n:return 0
        return max(k*v[i]+reference(i+1,c-k*w[i]) for k in range(min(counts[i],c//w[i])+1))
    require(dp[n][cap]==reference(0,cap),'背包参考求解失败')
    t.emit('最优值确定','独立递归枚举各物品件数与 DP 一致。',view(n,cap));return t.finish(dict(value=dp[n][cap],dp=dp))

for _id,_name,_aliases in [('knapsack-01','0-1 背包',['01背包','0/1背包','零一背包','0-1 knapsack']),('complete-knapsack','完全背包',['无限背包','unbounded knapsack','complete knapsack']),('bounded-knapsack','多重背包',['有限背包','bounded knapsack'])]:algorithm(_id,_name,_aliases,{'weights':[2,3,4],'values':[3,5,6],'capacity':8,'counts':[2,1,2]},'自命题／动态规划')(knapsack)

@algorithm('lcs','最长公共子序列',['LCS','longest common subsequence'],{'a':'ABCBDAB','b':'BDCABA'},'自命题／动态规划')
def lcs(t,d):
    a,b=d.get('a'),d.get('b');require(type(a)is str and type(b)is str and len(a)<=14 and len(b)<=14,'a、b至多14字符');m,n=len(a),len(b);dp=[[0]*(n+1) for _ in range(m+1)]
    def view(i=0,j=0,deps=None):return grid('LCS 前缀 DP',dp,['∅']+list(a),['∅']+list(b),[[i,j]],deps or [])
    t.emit('初始化空前缀','第0行、第0列为0。',view())
    for i in range(1,m+1):
        for j in range(1,n+1):
            same=a[i-1]==b[j-1];dp[i][j]=dp[i-1][j-1]+1 if same else max(dp[i-1][j],dp[i][j-1])
            t.emit('比较字符并写表',f'{a[i-1]} 与 {b[j-1]} '+(f'相同：dp[{i-1}][{j-1}]+1={dp[i][j]}' if same else f'不同：max({dp[i-1][j]},{dp[i][j-1]})={dp[i][j]}'),view(i,j,[[i-1,j-1]] if same else [[i-1,j],[i,j-1]]))
    i,j=m,n;out=[]
    while i and j:
        if a[i-1]==b[j-1]:out.insert(0,a[i-1]);why=f'收录字符{a[i-1]}，移向左上';i-=1;j-=1
        elif dp[i-1][j]>=dp[i][j-1]:why='上方不小于左方，向上回溯';i-=1
        else:why='左方更大，向左回溯';j-=1
        t.emit('回溯最优解',why,view(i,j),seq('已经重建的子序列',out))
    @lru_cache(None)
    def ref(i,j):
        if i==m or j==n:return 0
        return 1+ref(i+1,j+1) if a[i]==b[j] else max(ref(i+1,j),ref(i,j+1))
    require(len(out)==ref(0,0),'LCS 独立校验失败');t.emit('完成','输出一个合法最长子序列；相同最优值可以对应多个答案。',view(m,n),seq('最长子序列',out));return t.finish(dict(length=len(out),subsequence=''.join(out),dp=dp))

@algorithm('edit-distance','编辑距离',['Levenshtein','最小编辑距离'],{'a':'kitten','b':'sitting'},'自命题／动态规划')
def edit(t,d):
    a,b=d.get('a'),d.get('b');require(type(a)is str and type(b)is str and max(len(a),len(b))<=14,'字符串至多14字符');m,n=len(a),len(b);dp=[[0]*(n+1) for _ in range(m+1)]
    def view(i,j,deps=None):return grid('编辑距离：删除／插入／替换代价均为1',dp,['∅']+list(a),['∅']+list(b),[[i,j]],deps or [])
    for i in range(m+1):dp[i][0]=i;t.emit('初始化删除边界',f'{i}个字符变空串需要删除{i}次。',view(i,0))
    for j in range(1,n+1):dp[0][j]=j;t.emit('初始化插入边界',f'空串变{j}个字符需要插入{j}次。',view(0,j))
    for i in range(1,m+1):
        for j in range(1,n+1):
            delete=dp[i-1][j]+1;insert=dp[i][j-1]+1;replace=dp[i-1][j-1]+(a[i-1]!=b[j-1]);dp[i][j]=min(delete,insert,replace)
            t.emit('比较三种转移',f'删除={delete}，插入={insert}，'+('匹配' if a[i-1]==b[j-1] else '替换')+f'={replace}；取最小={dp[i][j]}。',view(i,j,[[i-1,j],[i,j-1],[i-1,j-1]]))
    @lru_cache(None)
    def ref(x,y):
        if not x or not y:return len(x)+len(y)
        return min(ref(x[1:],y)+1,ref(x,y[1:])+1,ref(x[1:],y[1:])+(x[0]!=y[0]))
    require(dp[m][n]==ref(a,b),'编辑距离校验失败');return t.finish(dict(distance=dp[m][n],dp=dp))

def interval(t,d):
    matrix=t.key=='matrix-chain';a=ints(d.get('dimensions') if matrix else d.get('weights'),9,1,100);n=len(a)-1 if matrix else len(a);require(n>=1 and n<=8,'需1…8个对象');dp=[[None]*n for _ in range(n)];split=[[None]*n for _ in range(n)]
    for i in range(n):dp[i][i]=0
    def views(i,j,k=None):return [grid('区间最小代价',dp,active=[[i,j]],dependencies=[] if k is None else [[i,k],[k+1,j]]),grid('最优划分点 k',split,active=[[i,j]]),seq('矩阵维数' if matrix else '石子重量',a)]
    t.emit('初始化区间长度1','单个矩阵无需相乘；单堆石子无需合并，代价均为0。',*views(0,0))
    for length in range(2,n+1):
        for i in range(n-length+1):
            j=i+length-1;best=math.inf
            for k in range(i,j):
                extra=a[i]*a[k+1]*a[j+1] if matrix else sum(a[i:j+1]);candidate=dp[i][k]+dp[k+1][j]+extra
                why=f'k={k}：{dp[i][k]}+{dp[k+1][j]}+'+(f'{a[i]}×{a[k+1]}×{a[j+1]}' if matrix else f'sum({a[i:j+1]})={extra}')+f'={candidate}；之前最小值={best}。'
                if candidate<best:best=candidate;dp[i][j]=candidate;split[i][j]=k
                t.emit('枚举划分点并比较',why,*views(i,j,k))
    @lru_cache(None)
    def ref(i,j):
        if i==j:return 0
        return min(ref(i,k)+ref(k+1,j)+(a[i]*a[k+1]*a[j+1] if matrix else sum(a[i:j+1])) for k in range(i,j))
    require(dp[0][n-1]==ref(0,n-1),'区间DP校验失败')
    def expr(i,j):return f'A{i+1}' if i==j else '('+expr(i,split[i][j])+'·'+expr(split[i][j]+1,j)+')'
    return t.finish(dict(cost=dp[0][n-1],split=split,dp=dp,parenthesization=expr(0,n-1)))

algorithm('matrix-chain','矩阵链乘',['矩阵链','matrix chain'],{'dimensions':[10,30,5,60]},'自命题／区间DP')(interval)
algorithm('interval-dp','区间 DP 石子合并',['区间DP','石子合并'],{'weights':[4,3,3,4]},'自命题／区间DP')(interval)

@algorithm('lis','最长递增子序列',['LIS','最长上升子序列'],{'array':[3,1,2,5,4,6]},'自命题／动态规划')
def lis(t,d):
    a=ints(d.get('array'),14);dp=[1]*len(a);pre=[-1]*len(a)
    t.emit('初始化','每个非空位置自身组成长度1子序列。',seq('输入',a),seq('dp',dp),seq('前驱',pre))
    for i in range(len(a)):
        for j in range(i):
            candidate=dp[j]+1 if a[j]<a[i] else None
            if candidate is not None and candidate>dp[i]:dp[i]=candidate;pre[i]=j
            t.emit('检查前驱位置',f'a[{j}]={a[j]} < a[{i}]={a[i]}：{a[j]<a[i]}；候选={candidate}，dp[{i}]={dp[i]}。',seq('输入',a,{'j':j,'i':i}),seq('dp',dp,{'更新':i}),seq('前驱',pre))
    length=max(dp,default=0);pos=dp.index(length) if a else -1;out=[]
    while pos>=0:out.insert(0,a[pos]);pos=pre[pos];t.emit('回溯子序列','沿前驱下标回溯。',seq('输入',a,{'下一前驱':pos}),seq('已重建',out))
    reference=max((len(c) for r in range(len(a)+1) for c in combinations(a,r) if all(c[i]<c[i+1] for i in range(len(c)-1))),default=0);require(length==reference,'LIS 校验失败');return t.finish(dict(length=length,subsequence=out))

@algorithm('fibonacci','斐波那契数列',['Fibonacci','Fibonacci sequence','Fibonacci numbers','斐波那契'],{'n':7},'常见扩展／递推')
def fibonacci(t,d):
    n=d.get('n');require(type(n)is int and 0<=n<=50,'n 为0…50');dp=[0]*(n+1)
    if n:dp[1]=1
    t.emit('基例','F(0)=0，F(1)=1。',seq('递推表',dp))
    for i in range(2,n+1):dp[i]=dp[i-1]+dp[i-2];t.emit('递推计算',f'F({i})=F({i-1})+F({i-2})={dp[i-1]}+{dp[i-2]}={dp[i]}。',seq('递推表',dp,{'i-2':i-2,'i-1':i-1,'i':i}))
    return t.finish(dp[n])

def game_search(t,d):
    source=d.get('tree');nodes=[];edges=[];visited=set();pruned=set();scores={};windows={};stack=[]
    def build(x,parent=None,maximum=True):
        require(len(nodes)<80,'博弈树至多80结点');index=len(nodes);nodes.append(dict(id=str(index),label='MAX' if isinstance(x,list) and maximum else 'MIN' if isinstance(x,list) else str(x),maximum=maximum,children=[]))
        if parent is not None:edges.append(dict(source=str(parent),target=str(index)))
        if isinstance(x,list):
            require(0<len(x)<=6,'内部结点有1…6个子结点')
            for child in x:nodes[index]['children'].append(build(child,index,not maximum))
        else:require(type(x)in(int,float) and math.isfinite(x),'叶子须为有限数值');nodes[index]['utility']=x
        return index
    build(source)
    def views(current):
        shown=[dict(id=n['id'],label=n['label']+('\n当前界='+str(scores[int(n['id'])]) if int(n['id']) in scores else ''),mark='pruned' if int(n['id']) in pruned else 'active' if int(n['id'])==current else 'done' if int(n['id']) in visited else '') for n in nodes]
        return [tree('博弈树：MAX/MIN 交替',shown,edges,['0']),table('各结点窗口',['结点','α','β','当前值'],[[i,*windows[i],scores.get(i,'待求值')] for i in windows]),boxes('递归调用栈',{'栈底→栈顶':stack})]
    def mark(i):
        pruned.add(i)
        for c in nodes[i]['children']:mark(c)
    def search(i,alpha,beta):
        visited.add(i);stack.append(i);windows[i]=[alpha,beta];n=nodes[i]
        t.emit('进入结点',f'结点{i}继承窗口 α={alpha}，β={beta}。',*views(i))
        if 'utility'in n:
            value=n['utility'];scores[i]=value;t.emit('叶子求值',f'效用={value}，返回父结点。',*views(i));stack.pop();return value
        best=-math.inf if n['maximum'] else math.inf
        for pos,c in enumerate(n['children']):
            value=search(c,alpha,beta);best=max(best,value) if n['maximum'] else min(best,value);scores[i]=best
            if n['maximum']:alpha=max(alpha,best)
            else:beta=min(beta,best)
            windows[i]=[alpha,beta];remaining=n['children'][pos+1:]
            t.emit('回传并更新边界',f'子结点{c}返回{value}；当前值={best}，α={alpha}，β={beta}。',*views(i))
            if t.key=='alpha-beta' and alpha>=beta and remaining:
                for child in remaining:mark(child)
                t.emit('满足条件后剪枝',f'α={alpha} ≥ β={beta}，跳过未访问分支{remaining}。剪枝结点当前值可能只是界，不能当作完整极值。',*views(i),alpha=alpha,beta=beta,prunedRoots=remaining);break
            if remaining:t.emit('继续搜索',('Minimax 不剪枝，继续枚举。' if t.key=='minimax' else f'α={alpha} < β={beta}，不满足剪枝条件。'),*views(i))
        stack.pop();return best
    result=search(0,-math.inf,math.inf)
    def full(i):return nodes[i]['utility'] if 'utility'in nodes[i] else (max if nodes[i]['maximum'] else min)(full(c) for c in nodes[i]['children'])
    require(result==full(0) and not(visited&pruned),'博弈搜索校验失败');t.emit('搜索结束',f'根值={result}；与完整 Minimax 校验一致。',*views(0));return t.finish(dict(value=result,visited=sorted(visited),pruned=sorted(pruned)))

algorithm('alpha-beta','Alpha-Beta 剪枝',['AlphaBeta','Alpha-Beta','αβ','阿尔法贝塔'],{'tree':[[3,5],[2,9],[4,6]]},'AI／博弈搜索')(game_search)
algorithm('minimax','极小极大搜索',['Minimax','最大最小博弈','极大极小'],{'tree':[[3,5],[2,9],[4,6]]},'AI／博弈搜索')(game_search)
