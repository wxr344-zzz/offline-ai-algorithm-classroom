from .core import algorithm, require, ints, seq, grid, boxes, table, graph
import heapq
import math
from collections import deque

DEFAULT={'n':6,'edges':[[0,1,8],[0,2,2],[2,1,1],[1,3,3],[2,3,9],[3,4,1]],'directed':True,'start':0}
MST={'n':5,'edges':[[0,1,1],[1,2,2],[0,2,3],[2,3,4],[1,3,6],[3,4,2]],'directed':False,'start':0}

def graph_trace(t,d):
    n=d.get('n');edges=d.get('edges');directed=d.get('directed',True);start=d.get('start',0)
    require(type(n)is int and 1<=n<=12 and type(directed)is bool and type(start)is int and 0<=start<n,'n 为1…12，start为结点编号，directed为布尔值')
    require(isinstance(edges,list) and len(edges)<=40 and all(isinstance(e,list) and 2<=len(e)<=4 and all(type(x)is int for x in e) and 0<=e[0]<n and 0<=e[1]<n and all(abs(w)<=10000 for w in e[2:]) for e in edges),'边为 [u,v,w] 或双权 [u,v,距离,费用]，至多40条')
    edges=[e[:2]+([1] if len(e)==2 else e[2:]) for e in edges];arcs=[]
    for i,e in enumerate(edges):
        u,v,w=e[:3];cost=e[3] if len(e)>3 else 0;arcs.append((u,v,w,cost,i))
        if not directed:arcs.append((v,u,w,cost,i))
    adj=[sorted([e for e in arcs if e[0]==u],key=lambda e:(e[1],e[2],e[3],e[4])) for u in range(n)]
    marked=set();selected=set();kind=t.key
    def g(current=None):return graph('图：边编号对应输入序号',n,edges,directed,current,sorted(selected),sorted(marked))
    def bf(source):
        dist=[math.inf]*n;dist[source]=0
        for _ in range(n-1):
            for u,v,w,_,_ in arcs:dist[v]=min(dist[v],dist[u]+w)
        return dist,any(dist[u]+w<dist[v] for u,v,w,_,_ in arcs)
    if kind=='graph-storage':
        matrix=[[0 if i==j else math.inf for j in range(n)] for i in range(n)]
        t.emit('初始化邻接矩阵','对角线为0，无边为∞；因此权重0不会被误判为无边。',g(),grid('邻接矩阵',matrix))
        for u,v,w,c,eid in arcs:
            matrix[u][v]=min(matrix[u][v],w);selected.add(eid)
            t.emit('写入邻接矩阵并连接边结点',f'边{eid}：{u}→{v}，权重{w}；平行边矩阵单元取最小权。邻接表保留每条边。',g(u),grid('邻接矩阵',matrix,active=[[u,v]]),table('邻接表',['结点','有序出边（目标,权重,边号）'],[[i,[(e[1],e[2],e[4]) for e in adj[i] if e[4] in selected]] for i in range(n)]))
        return t.finish(matrix)
    if kind in ('bfs','dfs'):
        order=[];work=[];done=[];all_components=d.get('allComponents',False);require(type(all_components)is bool,'allComponents须为布尔值')
        roots=[start]+([i for i in range(n) if i!=start] if all_components else [])
        def view(u=None):return [g(u),boxes('工作集合流转',{'队列／调用栈':work,'已输出':order,'已完成':done}),table('发现状态',['结点','已发现'],[[i,i in marked] for i in range(n)])]
        t.emit('初始化遍历','邻居按编号升序；发现时立即标记，防止环和重复边造成重复加入。',*view())
        if kind=='bfs':
            for root in roots:
                if root in marked:continue
                marked.add(root);work.append(root);t.emit('新分量起点入队',f'{root}入队并标记。',*view(root))
                while work:
                    u=work.pop(0);order.append(u);t.emit('队首出队',f'取队首{u}，先进先出。',*view(u))
                    for _,v,w,c,eid in adj[u]:
                        fresh=v not in marked
                        if fresh:marked.add(v);work.append(v)
                        t.emit('检查邻接结点',f'边{eid}到{v}：'+('首次发现，标记并入队' if fresh else '已发现，跳过'),*view(u))
                    done.append(u);t.emit('本结点处理完毕',f'{u}的出边已全部检查。',*view(u))
        else:
            def visit(u):
                marked.add(u);work.append(u);order.append(u);t.emit('递归进入并输出',f'发现{u}，压入调用栈。',*view(u))
                for _,v,w,c,eid in adj[u]:
                    t.emit('检查邻接结点',f'边{eid}到{v}：'+('已发现，跳过' if v in marked else '未发现，准备递归'),*view(u))
                    if v not in marked:visit(v)
                work.pop();done.append(u);t.emit('递归返回',f'{u}处理完毕，弹栈并回到父结点。',*view(u))
            for root in roots:
                if root not in marked:visit(root)
        reachable=set(range(n)) if all_components else {start}
        if not all_components:
            for _ in range(n):
                for u,v,*_ in arcs:
                    if u in reachable:reachable.add(v)
        require(set(order)==reachable and len(order)==len(set(order)),'遍历校验失败');return t.finish(order)
    if kind in ('dijkstra','dual-dijkstra','astar','bellman-ford'):
        dual=kind=='dual-dijkstra';astar=kind=='astar';goal=d.get('goal',n-1);require(type(goal)is int and 0<=goal<n,'goal编号无效')
        if kind!='bellman-ford':require(all(e[2]>=0 and (not dual or e[3]>=0) for e in arcs),'Dijkstra／A* 的边权必须非负')
        h=d.get('heuristic',[0]*n) if astar else [0]*n;require(isinstance(h,list) and len(h)==n and all(type(v)is int and v>=0 for v in h),'heuristic须有n个非负整数')
        if astar:require(h[goal]==0 and all(h[u]<=w+h[v] for u,v,w,_,_ in arcs),'当前 A* 采用一致启发式：h(goal)=0 且 h(u)≤w+h(v)')
        dist=[(math.inf,math.inf) if dual else math.inf for _ in range(n)];dist[start]=(0,0) if dual else 0;pre=[None]*n;queue=[]
        def view(u=None,before=None):
            rows=[[i,dist[i],pre[i],i in marked]+([h[i],dist[i]+h[i]] if astar else []) for i in range(n)]
            cols=['结点','(距离,费用)' if dual else 'g／距离','前驱','已确定']+(['h','f=g+h'] if astar else [])
            return [g(u),table('最短路状态表',cols,rows,[] if u is None else [u]),boxes('开放／关闭集合',{'开放候选（按优先级排序）':sorted(queue),'已确定':sorted(marked),**({'弹出前队列':before} if before is not None else {})})]
        if kind=='bellman-ford':
            t.emit('初始化距离','起点0，其余∞；最多n−1轮松弛。',*view())
            for round in range(n-1):
                changed=False
                for u,v,w,c,eid in arcs:
                    old=dist[v];candidate=dist[u]+w
                    if candidate<old:dist[v]=candidate;pre[v]=u;changed=True
                    t.emit('逐边松弛',f'第{round+1}轮边{eid}：{dist[u]}+{w}={candidate}，与旧值{old}比较，'+('更新' if candidate<old else '保持'),*view(v))
                if not changed:t.emit('提前结束','本轮没有更新，距离已稳定。',*view());break
            negative=any(dist[u]+w<dist[v] for u,v,w,_,_ in arcs)
            t.emit('负环检查','第n轮仍可松弛：'+str(negative)+'。有起点可达负环时不输出伪造的有限最短路。',*view());return t.finish({'negativeCycle':True} if negative else dist)
        first=(h[start],0,start) if astar else ((0,0),start) if dual else (0,start);heapq.heappush(queue,first)
        t.emit('初始化开放集','最小候选优先弹出；双权使用(距离,费用)字典序，A*使用f=g+h。',*view())
        while queue:
            before=sorted(queue);entry=heapq.heappop(queue)
            if astar:_,du,u=entry
            else:du,u=entry
            if du!=dist[u] or u in marked:t.emit('跳过过期候选',f'条目{entry}已过期，不扩展。',*view(u,before));continue
            marked.add(u);t.emit('取最小候选并确定',f'从{before}取出{entry}。',*view(u,before))
            if astar and u==goal:break
            for _,v,w,c,eid in adj[u]:
                candidate=(du[0]+w,du[1]+c) if dual else du+w;old=dist[v]
                if candidate<old:
                    dist[v]=candidate;pre[v]=u;heapq.heappush(queue,(candidate+h[v],candidate,v) if astar else (candidate,v))
                t.emit('比较候选并更新',f'边{eid}：通过{u}的候选={candidate}，旧值={old}；'+('更优，更新前驱并入队' if candidate<old else '不更优，保持')+('；同距离才比较费用' if dual else ''),*view(v))
        if dual:
            reference=[(math.inf,math.inf)]*n;reference[start]=(0,0)
            for _ in range(n-1):
                for u,v,w,c,eid in arcs:reference[v]=min(reference[v],(reference[u][0]+w,reference[u][1]+c))
            require(reference==dist,'双权独立校验失败')
        else:require(not bf(start)[1] and (dist[goal]==bf(start)[0][goal] if astar else dist==bf(start)[0]),'最短路独立校验失败')
        path=[];u=goal
        if dist[goal]!=(math.inf,math.inf) and dist[goal]!=math.inf:
            while u is not None and len(path)<=n:path.insert(0,u);u=pre[u]
            require(len(path)<=n and path[0]==start,'前驱链错误')
        t.emit('结束并重建路径',(f'沿前驱从目标{goal}回溯：{path}。' if path else f'目标{goal}从起点{start}不可达（距离为∞），不存在路径。'),*view(goal),seq('起点到目标路径',path));return t.finish(dict(distances=dist,path=path))
    if kind=='greedy-best-first':
        goal=d.get('goal',n-1);require(type(goal)is int and 0<=goal<n,'goal编号无效')
        require(all(e[2]>=0 for e in arcs),'贪婪最佳优先搜索的边权必须非负（边权只用于统计路径代价）')
        h=d.get('heuristic');require(isinstance(h,list) and len(h)==n and all(type(v)is int and 0<=v<=10000 for v in h),'heuristic须有n个非负整数')
        pre=[None]*n;queue=[(h[start],start)];found={start};order=[]
        def view(u=None,before=None):
            rows=[[i,h[i],pre[i],i in found,i in marked] for i in range(n)]
            return [g(u),table('搜索状态表',['结点','h(估价)','前驱','已发现','已扩展'],rows,[] if u is None else [u]),boxes('开放／关闭集合',{'开放候选（按 h 排序）':sorted(queue),'已扩展顺序':order,**({'弹出前开放集':before} if before is not None else {})})]
        t.emit('初始化开放集',f'起点{start}入开放集。贪婪最佳优先只按估价 h(n) 选点，不累计已走代价 g；h 相同时选编号小的结点。',*view(start))
        reached=False
        while queue:
            before=sorted(queue);entry=heapq.heappop(queue);u=entry[1]
            marked.add(u);order.append(u)
            t.emit('取 h 最小的候选扩展',f'从{before}取出(h={entry[0]}, 结点{u})。',*view(u,before))
            if u==goal:reached=True;t.emit('到达目标',f'目标{goal}被取出，立即停止搜索（不再比较其他路径）。',*view(u));break
            for _,v,w,c,eid in adj[u]:
                fresh=v not in found
                if fresh:found.add(v);pre[v]=u;heapq.heappush(queue,(h[v],v))
                t.emit('检查邻接结点',f'边{eid}到{v}：'+(f'首次发现，记前驱{u}，以 h={h[v]} 加入开放集' if fresh else '已发现过，不重复加入'),*view(v))
        path=[]
        if reached:
            u=goal
            while u is not None and len(path)<=n:path.insert(0,u);u=pre[u]
        # Independent check: a path exists exactly when the goal is reachable,
        # and every step of the reported path is a real edge.
        reach={start}
        for _ in range(n):
            for a,b,*_ in arcs:
                if a in reach:reach.add(b)
        weight={}
        for a,b,w,_,_ in arcs:weight[(a,b)]=min(weight.get((a,b),math.inf),w)
        require(bool(path)==(goal in reach),'贪婪最佳优先独立校验失败：可达性不一致')
        require(not path or (path[0]==start and path[-1]==goal and all((a,b) in weight for a,b in zip(path,path[1:]))),'贪婪最佳优先独立校验失败：路径含不存在的边')
        cost=sum(weight[(a,b)] for a,b in zip(path,path[1:])) if path else math.inf
        best=bf(start)[0][goal] if not bf(start)[1] else None
        note=(f'找到路径{path}，路径代价{cost}。' if path else f'开放集为空，目标{goal}不可达，返回空路径。')
        if path and best is not None:note+=('与最短路径代价相同。' if cost==best else f'最短路径代价是{best}：贪婪最佳优先只看估价，不保证找到最短路径。')
        t.emit('结束并重建路径',note,*view(goal if path else None),seq('找到的路径',path))
        return t.finish(path)
    if kind=='floyd':
        require(n<=6,'Floyd 手算教学最多6个结点，逐一保留每个(i,j,k)判断')
        matrix=[[0 if i==j else math.inf for j in range(n)] for i in range(n)];route=[[None]*n for _ in range(n)]
        for u,v,w,_,_ in arcs:
            if w<matrix[u][v]:matrix[u][v]=w;route[u][v]=v
        t.emit('初始化距离矩阵','对角线0，无边∞，平行边取最小权。',g(),grid('D',matrix),grid('下一跳',route))
        for k in range(n):
            for i in range(n):
                for j in range(n):
                    left,right=matrix[i][k],matrix[k][j];candidate=left+right;old=matrix[i][j]
                    if candidate<old:matrix[i][j]=candidate;route[i][j]=route[i][k]
                    t.emit('逐格检查中间点',f'k={k},i={i},j={j}：{left}+{right}={candidate}，旧值{old}；'+('更新' if candidate<old else '保持'),g(k),grid('D',matrix,active=[[i,j]],dependencies=[[i,k],[k,j]]),grid('下一跳',route,active=[[i,j]]))
            if any(matrix[i][i]<0 for i in range(n)):
                require(any(bf(s)[1] for s in range(n)),'负环校验失败');t.emit('发现负权环','存在D[i][i]<0，受影响路径没有有限最小值。',g(),grid('D',matrix));return t.finish({'negativeCycle':True})
        require(all(matrix[i]==bf(i)[0] for i in range(n)),'Floyd 独立校验失败');return t.finish(matrix)
    if kind in ('prim','kruskal'):
        require(not directed,'最小生成树使用无向图');parent=list(range(n));weight=0;chosen=[]
        def find(x):
            while parent[x]!=x:x=parent[x]
            return x
        def view(current=None,candidates=None):return [g(current),table('分量与选边',['结点','并查集代表'],[[i,find(i)] for i in range(n)]),boxes('候选与已选边',{'候选':candidates or [],'已选边':chosen})]
        if kind=='kruskal':
            candidates=sorted(enumerate(edges),key=lambda item:(item[1][2],item[0]));t.emit('按权排序','依次检查边，只有代表不同才接纳。',*view(candidates=candidates))
            for pos,(eid,(u,v,w,*_)) in enumerate(candidates):
                a,b=find(u),find(v);accept=a!=b
                if accept:parent[a]=b;weight+=w;selected.add(eid);chosen.append([u,v,w]);marked.update((u,v))
                t.emit('接纳边' if accept else '拒绝成环边',f'边{eid}：find({u})={a}，find({v})={b}；'+('合并分量' if accept else '同分量，不能接纳'),*view(u,candidates[pos+1:]))
        else:
            for root in range(n):
                if root in marked:continue
                marked.add(root);t.emit('开始新连通分量',f'将{root}加入集合U。',*view(root))
                while True:
                    candidates=sorted([e for e in arcs if e[0]in marked and e[1]not in marked],key=lambda e:(e[2],e[4],e[1]))
                    t.emit('生成跨割候选集','候选必须一端在U、一端不在U；在候选中选择最小权。',*view(candidates=candidates))
                    if not candidates:break
                    u,v,w,c,eid=candidates[0];marked.add(v);selected.add(eid);chosen.append([u,v,w]);weight+=w;parent[find(u)]=find(v)
                    t.emit('最小边入树并扩张U',f'边{eid}：{u}—{v}，权{w}，当前总权{weight}。',*view(v,candidates))
        # Independent Boruvka reference.
        roots=list(range(n))
        def root(x):
            while roots[x]!=x:x=roots[x]
            return x
        reference=0
        while True:
            cheapest={}
            for u,v,w,*_ in edges:
                a,b=root(u),root(v)
                if a==b:continue
                for r in (a,b):
                    if r not in cheapest or w<cheapest[r][2]:cheapest[r]=(u,v,w)
            merges=0
            for u,v,w in cheapest.values():
                a,b=root(u),root(v)
                if a!=b:roots[a]=b;reference+=w;merges+=1
            if not merges:break
        require(reference==weight,'生成森林独立校验失败');components=n-len(chosen);t.emit('生成树／森林完成',f'总权{weight}，分量数{components}；'+('图连通' if components==1 else '图不连通，只能得到最小生成森林'),*view());return t.finish(dict(edges=chosen,total=weight,components=components))
    if kind in ('topological','critical-path'):
        require(directed,'拓扑和AOE需要有向图');degree=[0]*n
        for u,v,*_ in arcs:degree[v]+=1
        q=[i for i in range(n) if degree[i]==0];order=[];ve=[0]*n
        def view(u=None):return [g(u),table('入度／事件最早发生时刻',['结点','入度','ve'],[[i,degree[i],ve[i]] for i in range(n)]),boxes('拓扑集合流转',{'零入度队列':q,'已输出':order})]
        t.emit('初始化入度与起点','入度0的结点入队，ve初始为0。',*view())
        while q:
            u=q.pop(0);order.append(u);marked.add(u);t.emit('输出零入度结点',f'{u}出队。',*view(u))
            for _,v,w,c,eid in adj[u]:
                old=ve[v];ve[v]=max(ve[v],ve[u]+w);degree[v]-=1
                if degree[v]==0:q.append(v)
                t.emit('删除出边／更新最早时刻',f'边{eid}：indegree[{v}]减1→{degree[v]}；ve[{v}]=max({old},{ve[u]}+{w})={ve[v]}。',*view(v))
        if len(order)!=n:t.emit('检测到有向环','未输出所有结点，无法给出拓扑序或关键路径。',*view());return t.finish(dict(cycle=True,partial=order))
        require(all(order.index(u)<order.index(v) for u,v,*_ in arcs),'拓扑校验失败')
        if kind=='topological':return t.finish(order)
        require(all(e[2]>=0 for e in arcs),'AOE活动持续时间非负');duration=max(ve);vl=[duration]*n
        for u in reversed(order):
            for _,v,w,c,eid in adj[u]:
                old=vl[u];vl[u]=min(vl[u],vl[v]-w);t.emit('逆拓扑更新最迟时刻',f'vl[{u}]=min({old},{vl[v]}−{w})={vl[u]}。',*view(u),table('最迟发生时刻',['结点','vl'],[[i,vl[i]] for i in range(n)]))
        activity=[]
        for eid,(u,v,w,*_) in enumerate(edges):
            earliest,latest=ve[u],vl[v]-w;critical=earliest==latest
            if critical:selected.add(eid)
            activity.append([eid,u,v,w,earliest,latest,latest-earliest,critical]);t.emit('逐活动计算时间余量',f'活动{eid}：e=ve[{u}]={earliest}，l=vl[{v}]−{w}={latest}，余量={latest-earliest}；'+('关键活动' if critical else '非关键活动'),g(u),table('活动时间表',['边号','u','v','持续','最早e','最迟l','余量','关键'],activity))
        return t.finish(dict(duration=duration,ve=ve,vl=vl,critical=[e[0] for e in activity if e[-1]]))
    raise ValueError('图算法编号无效')

for _id,_name,_aliases,_default,_section in [
 ('graph-storage','图的邻接矩阵与邻接表',['邻接矩阵','邻接表','图的存储'],DEFAULT,'408／图'),
 ('bfs','广度优先遍历 BFS',['广度搜索','广度遍历','宽度优先','BFS','breadth-first search','breadth first search','breadth-first traversal','breadth first traversal'],{**DEFAULT,'allComponents':True},'408／图'),
 ('dfs','深度优先遍历 DFS',['深度遍历','深度搜索','DFS','depth-first search','depth first search','depth-first traversal','depth first traversal'],{**DEFAULT,'allComponents':True},'408／图'),
 ('dijkstra','Dijkstra 最短路径',['迪杰斯特拉','狄克斯特拉','Dijkstra'],{**DEFAULT,'goal':4},'408／图'),
 ('dual-dijkstra','双权值 Dijkstra',['双权','双权值','距离与费用','距离和费用'],{'n':4,'edges':[[0,1,2,8],[0,2,1,1],[2,1,1,2],[1,3,2,1],[2,3,3,8]],'directed':True,'start':0,'goal':3},'浙江／最短路'),
 ('floyd','Floyd 全源最短路',['Floyd','弗洛伊德'],{'n':4,'edges':[[0,1,4],[0,2,10],[1,2,2],[2,3,1]],'directed':True},'408／图'),
 ('bellman-ford','Bellman-Ford',['Bellman','负权最短路'],{'n':4,'edges':[[0,1,4],[0,2,5],[1,2,-2],[2,3,3]],'directed':True},'常见扩展／图'),
 ('astar','A* 启发式搜索',['A*','A-star','启发式搜索'],{**DEFAULT,'goal':4,'heuristic':[6,3,4,1,0,0]},'AI／搜索'),
 ('greedy-best-first','贪婪最佳优先搜索',['贪婪最佳优先搜索','贪心最佳优先搜索','贪婪最佳优先','贪心最佳优先','最佳优先搜索','greedy best-first search','greedy best first search','greedy best-first','GBFS'],{**DEFAULT,'goal':4,'heuristic':[5,2,4,1,0,3]},'AI／搜索'),
 ('prim','Prim 最小生成树',['普里姆','Prim'],MST,'408／图'),('kruskal','Kruskal 最小生成树',['克鲁斯卡尔','Kruskal'],MST,'408／图'),
 ('topological','拓扑排序',['Topological','拓扑'],{'n':5,'edges':[[0,2,1],[1,2,1],[2,3,1],[2,4,1]],'directed':True},'408／图'),
 ('critical-path','AOE 关键路径',['关键路径','AOE'],{'n':6,'edges':[[0,1,3],[0,2,2],[1,3,2],[2,3,4],[2,4,3],[3,5,2],[4,5,3]],'directed':True},'408／图')]:algorithm(_id,_name,_aliases,_default,_section)(graph_trace)
