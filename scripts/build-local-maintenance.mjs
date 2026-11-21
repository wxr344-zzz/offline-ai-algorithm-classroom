// Bundle trusted local maintenance tools without changing workspace packages.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const name = process.argv[2];
if (
  ![
    'repair-reviewed-quality',
    'refresh-algorithm-widgets',
    'repair-algorithm-teaching',
    'repair-lecture-content',
    'retry-paused-classroom',
    'repair-legacy-labs',
    'audit-classroom-modes',
  ].includes(name)
)
  throw new Error('Specify a reviewed local maintenance tool');
await build({
  entryPoints: [`scripts/${name}.ts`],
  outfile: `logs/${name}.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [
    {
      name: 'workspace-esm',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(server|headers)$/ }, (args) => ({
          path: `${args.path}.js`,
          external: true,
        }));
        builder.onResolve({ filter: /^@openmaic\// }, (args) => ({
          path: fileURLToPath(import.meta.resolve(args.path)),
          external: false,
        }));
        builder.onLoad({ filter: /\.js$/ }, async (args) => {
          if (!args.path.includes('packages')) return;
          const source = await readFile(args.path, 'utf8');
          if (!source.includes('import.meta.url')) return;
          // Preserve module identity: a bundled library's optional CLI must not
          // mistake the maintenance executable for its own entry point.
          return {
            contents: source.replaceAll(
              'import.meta.url',
              JSON.stringify(pathToFileURL(args.path).href),
            ),
            loader: 'js',
          };
        });
      },
    },
  ],
});
