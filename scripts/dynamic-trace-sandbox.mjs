// Host-side watchdog. Generated Python only runs in a disposable WASM worker.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if (isMainThread) {
  let input = '';
  for await (const part of process.stdin) {
    input += part;
    if (input.length > 100000) throw new Error('Sandbox payload too large');
  }
  const worker = new Worker(new URL(import.meta.url), {
    workerData: JSON.parse(input),
    env: {},
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
  });
  let timeout = setTimeout(() => {
    void worker.terminate();
    process.stdout.write(JSON.stringify({ error: '沙箱运行时启动超时（70秒）' }));
    process.exitCode = 1;
  }, 70000);
  worker.on('message', (result) => {
    if (result.ready) {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        void worker.terminate();
        process.stdout.write(JSON.stringify({ error: '沙箱执行超时（20秒）' }));
        process.exitCode = 1;
      }, 20000);
      return;
    }
    clearTimeout(timeout);
    process.stdout.write(JSON.stringify(result));
    void worker.terminate();
  });
  worker.once('error', () => {
    clearTimeout(timeout);
    process.stderr.write('WASM worker failed');
    process.exitCode = 1;
  });
} else {
  try {
    const { loadPyodide } = await import('../public/vendor/eduplus/pyodide/pyodide.mjs');
    const indexURL = fileURLToPath(new URL('../public/vendor/eduplus/pyodide/', import.meta.url));
    const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {}, jsglobals: {} });
    const driver = await readFile(
      new URL('../exam_simulator/sandbox_driver.py', import.meta.url),
      'utf8',
    );
    await py.runPythonAsync(driver);
    parentPort.postMessage({ ready: true });
    py.globals.set('_job_json', JSON.stringify(workerData));
    const result = await py.runPythonAsync(
      'json.dumps(run_job(json.loads(_job_json)), ensure_ascii=False, allow_nan=False)',
    );
    if (result.length > 2500000) throw new Error('Trace too large');
    parentPort.postMessage({ result: JSON.parse(result) });
  } catch (error) {
    parentPort.postMessage({ error: String(error.message ?? error).slice(-1800) });
  }
}
