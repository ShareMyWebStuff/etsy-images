const fs = require('node:fs/promises');
const path = require('node:path');

function parseArguments(argv) {
  if (argv.includes('--help')) return { help: true, dryRun: true, limit: 5 };
  const unknown = argv.filter((value, index) => !['--run', '--dry-run', '--limit'].includes(value) && argv[index - 1] !== '--limit');
  if (unknown.length || (argv.includes('--run') && argv.includes('--dry-run'))) throw new Error('Use --dry-run or --run, optionally --limit 1..5.');
  const index = argv.indexOf('--limit');
  const limit = index < 0 ? 5 : Number(argv[index + 1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('The publication limit must be between 1 and 5.');
  return { help: false, dryRun: !argv.includes('--run'), limit };
}

async function runPublisher({ argv = process.argv.slice(2), projectRoot = path.resolve(__dirname, '..'), createRuntime } = {}) {
  const options = parseArguments(argv);
  if (options.help) return { help: true, usage: 'node --env-file=.env --env-file-if-exists=.env.local scripts/pinterest-publisher.cjs [--dry-run | --run] [--limit 1..5]' };
  if (process.env.PINTEREST_ENVIRONMENT !== 'production') throw new Error('The automatic Pinterest publisher only runs in production.');
  process.chdir(projectRoot);
  const factory = createRuntime ?? (await import('vite')).createServer;
  // SSR loading runs the existing server modules without opening a listening port.
  const runtime = await factory({ configFile: false, root: projectRoot, appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, resolve: { alias: { '@': projectRoot.replaceAll('\\', '/') } },
  });
  let prisma;
  try {
    ({ prisma } = await runtime.ssrLoadModule('/lib/prisma.ts'));
    const { processDuePins } = await runtime.ssrLoadModule('/lib/pinterest/pins.ts');
    const results = await processDuePins(options.limit, { dryRun: options.dryRun });
    const summary = {
      checkedAt: new Date().toISOString(), mode: options.dryRun ? 'dry-run' : 'run',
      considered: results.length, published: results.filter((item) => item.ok && !item.skipped).length,
      skipped: results.filter((item) => item.skipped).length,
      deferred: results.filter((item) => item.deferred).length,
      reviewRequired: results.filter((item) => item.reviewRequired).length,
      failed: results.filter((item) => !item.ok && !item.deferred && !item.reviewRequired).length,
      pinIds: results.map((item) => item.id),
    };
    const directory = path.join(projectRoot, '.tmp', 'pinterest-publisher');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'last-run.json'), JSON.stringify(summary, null, 2));
    await fs.appendFile(path.join(directory, 'history.jsonl'), `${JSON.stringify(summary)}\n`);
    return summary;
  } finally {
    if (prisma) await prisma.$disconnect();
    await runtime.close();
  }
}

module.exports = { parseArguments, runPublisher };
if (require.main === module) runPublisher().then((summary) => {
  console.log(JSON.stringify(summary));
}).catch(() => {
  // API/DB errors can contain connection details. Keep unattended logs free of credentials.
  console.error('Pinterest publisher failed. Check production configuration, database availability and the Pinterest connection.');
  process.exitCode = 1;
});
