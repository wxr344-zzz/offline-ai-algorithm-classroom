"""走首页使用的原生 generation-runs 接口，不走独立 EduPlus 生成入口。"""
from __future__ import annotations

import json
from pathlib import Path
import time
import httpx


def main() -> None:
    with httpx.Client(base_url='http://127.0.0.1:3000', timeout=40) as client:
        response = client.post('/api/generation-runs', json={
            'requirement': '生成一节 Python 整数列表求和实验课，空列表返回零。保留原生概念讲解、Canvas 逐步模拟器和拖拽游戏，再嵌入引导编程与独立闯关、随堂检测及总结。精简讲解为一页，Python 编程环节只有一个考点。',
            'interactive': True, 'outlineReview': 'auto',
            'agents': {'mode': 'preset', 'agentIds': ['default-1', 'default-2', 'default-3']},
        })
        response.raise_for_status()
        initial = response.json()
        initial = initial.get('run', initial)
        run_id = initial.get('id', initial.get('runId'))
        assert run_id, initial
        print(json.dumps({'runId': run_id}, ensure_ascii=False), flush=True)
        deadline = time.monotonic() + 1800
        last = None
        while time.monotonic() < deadline:
            result = client.get('/api/generation-runs/' + run_id)
            result.raise_for_status()
            data = result.json()
            data = data.get('run', data)
            current = (data['state'], data.get('step'), data.get('progress'))
            if current != last:
                print(json.dumps({'state': data['state'], 'step': data.get('step'), 'progress': data.get('progress')}, ensure_ascii=False), flush=True)
                last = current
            if data['state'] in ('completed', 'paused', 'ended'):
                root = Path(__file__).resolve().parents[1]
                (root / 'logs/native-lab-run.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
                assert data['state'] == 'completed', data.get('error')
                outlines = data['outline']['outlines']
                phases = [item['eduplus']['phase'] for item in outlines if item.get('eduplus')]
                assert {'guided-lab', 'oj-lab', 'quiz', 'review'}.issubset(phases), phases
                assert any(item.get('widgetType') == 'simulation' for item in outlines)
                assert any(item.get('widgetType') == 'game' for item in outlines)
                assert any(item['type'] == 'slide' for item in outlines)
                print(json.dumps({'stageId': data['stageId'], 'nativeIntegrated': True, 'phases': phases}, ensure_ascii=False), flush=True)
                return
            time.sleep(8)
        raise TimeoutError('原生课程生成超过 30 分钟，保留运行日志以便重试')


if __name__ == '__main__':
    main()
