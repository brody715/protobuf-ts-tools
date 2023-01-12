import {Command} from "commander";
import {
  MockManager,
  MockServer,
  validateDefineMockOptions,
  withReload,
} from "./mocks/server";
import colors from "picocolors";

import jiti from "jiti";
import chokidar from "chokidar";
import * as nodePath from "path";
import {createLogger} from "./mocks/logger";
import {debounce} from "./mocks/utils";

async function handleMock(opt: {
  filePrefix: string;
  expressLog?: boolean;
  dir: string;
  port: number;
  prefix: string;
  host?: boolean;
}) {
  const logger = createLogger();

  logger.info(`opts=${JSON.stringify(opt)}`);

  if (!opt.filePrefix) {
    throw new Error(`invalid opts=${JSON.stringify(opt)}`);
  }

  const watchDir = opt.dir;
  const jitiBaseDir = process.cwd();

  const jitiFn = jiti(jitiBaseDir, {
    cache: true,
  });

  const manager = new MockManager(logger);
  const reloader = withReload(() => {
    const server = new MockServer(
      logger,
      {
        host: opt.host ? "0.0.0.0" : undefined,
        port: opt.port,
        prefix: opt.prefix,
        expressLog: opt.expressLog,
      },
      manager.getServices()
    );

    return {
      run: (p) =>
        server.start({
          logStart: p.firstRun,
        }),
      close: () => server.close(),
    };
  });

  const createReload = () => {
    const ctx = {
      paths: new Set() as Set<string>,
    };

    const reloadFn = debounce(
      async () => {
        const paths = ctx.paths;
        ctx.paths = new Set();

        const pathStr = Array.from(paths.values()).join(", ");
        logger.info(`${colors.green("reload")}: ${colors.gray(pathStr)}`, {
          clear: true,
        });
        await reloader.reload();
      },
      {
        wait: 500,
      }
    );

    return (path: string) => {
      ctx.paths.add(path);
      reloadFn();
    };
  };

  // TODO: add debounce
  const reload = createReload();

  const patterns: string[] = ["ts", "js"].map((v) => `.${opt.filePrefix}.${v}`);
  const matchPattern = (path: string): boolean => {
    for (const pattern of patterns) {
      if (path.endsWith(pattern)) {
        return true;
      }
    }
    return false;
  };

  logger.info(`watching on ${watchDir}, pattern=${patterns.join(",")}`);
  chokidar.watch(watchDir).on("all", async (event, path) => {
    if (event === "addDir") return;

    if (event === "unlinkDir") {
      let hasChanged = false;
      for (const [, modId] of Object.keys(jitiFn.cache).entries()) {
        if (modId.startsWith(watchDir)) {
          manager.removeMock(modId);
          hasChanged = true;
        }
      }

      if (hasChanged) {
        reload(path);
      }
      return;
    }

    // handle file changes
    if (!matchPattern(path)) return;

    // logger.info(`file changes, event=${event}, path=${path}`);

    const relPath = "." + nodePath.sep + nodePath.relative(jitiBaseDir, path);

    if (event === "add" || event === "change") {
      try {
        const moduleId = jitiFn.resolve(relPath);
        manager.removeMock(moduleId);

        jitiFn.cache[moduleId] = undefined;

        const mockOptions = validateDefineMockOptions(jitiFn(moduleId).default);
        manager.addMock(moduleId, mockOptions);
        reload(path);
      } catch (e) {
        logger.error(`failed to add mock, path=${path}, error=${e}`, e);
      }
    }
  });

  await reloader.runForever();
}

export function main(args: string[]) {
  const program = new Command("pb-tools");
  program.showHelpAfterError().showSuggestionAfterError();

  program
    .command("mock")
    .description("start mock server")
    .requiredOption("--dir [string]", "mock watch dir")
    .option("-p, --port [number]", "port", "18877")
    .option("--prefix [string]", "prefix of api", "/")
    .option("--host", "use host to expose to 0.0.0.0")
    .option(
      "--file-prefix",
      "file prefix, like mock ('file.mock.ts' will be matched)",
      "mock"
    )
    .option("--express-log", "option to enable express requests logs")
    .action(async (params) => {
      await handleMock(params);
    });

  program.parse(args);
}

main(process.argv);
